// downloader-engine.js — Runs inside the service worker (loaded by background.js).
//
// Streams (HLS/DASH) and anything behind a login go to the local companion
// (yt-dlp + FFmpeg). Direct files (.mp4/.webm) fall back to chrome.downloads
// when the companion is not running. The companion is the source of truth for
// progress: if this worker is restarted mid-download, the popup reconnects
// through listDownloads().
//
// Expects getHeadersFor(url) from background.js.

const COMPANION_URL = 'http://127.0.0.1:7823';
const COMPANION_MIN_VERSION = 2;
const TIPOS_DIRECTOS = new Set(['MP4', 'WEBM', 'MOV', 'MKV', 'FLV']);

// taskId → { status, percent, eta, speed, error, filepath, videoUrl, pageUrl, tabId, nombre, companionId, chromeId }
const _descargas = new Map();

// ─────────────────────────────────────────────
// COMPANION
// ─────────────────────────────────────────────
async function checkCompanion() {
  try {
    const resp = await fetch(`${COMPANION_URL}/health`, { signal: AbortSignal.timeout(1500) });
    if (!resp.ok) return { activo: false };
    const info = await resp.json();
    const major = parseInt(String(info.version || '0').split('.')[0], 10);
    return {
      activo: true,
      version: info.version,
      desactualizado: major < COMPANION_MIN_VERSION,
      ytdlp: !!info.ytdlp,
      ffmpeg: !!info.ffmpeg,
      downloadsDir: info.downloadsDir
    };
  } catch {
    return { activo: false };
  }
}

async function openDownloadsFolder() {
  try {
    const resp = await fetch(`${COMPANION_URL}/open-folder`, { method: 'POST' });
    return { ok: resp.ok };
  } catch {
    return { ok: false };
  }
}

// Every cookie the site or its CDN may need: page host, stream host, and their
// parent domains. Partitioned cookies (players inside iframes) are included too.
async function collectCookies(urls, pageUrl) {
  const dominios = new Set();
  for (const u of urls) {
    try {
      const partes = new URL(u).hostname.split('.');
      for (let i = 0; i <= partes.length - 2; i++) dominios.add(partes.slice(i).join('.'));
    } catch { /* invalid url */ }
  }

  const vistas = new Map();
  const guardar = (c) => vistas.set(`${c.domain}|${c.path}|${c.name}|${c.partitionKey?.topLevelSite || ''}`, c);

  let topLevelSite = null;
  try { topLevelSite = new URL(pageUrl).origin; } catch { /* no page */ }

  for (const domain of dominios) {
    try { (await chrome.cookies.getAll({ domain })).forEach(guardar); } catch { /* ignore */ }
    if (topLevelSite) {
      try { (await chrome.cookies.getAll({ domain, partitionKey: { topLevelSite } })).forEach(guardar); } catch { /* older Chrome */ }
    }
  }

  return [...vistas.values()].map(c => ({
    domain: c.domain, path: c.path, name: c.name, value: c.value,
    secure: c.secure, httpOnly: c.httpOnly, hostOnly: c.hostOnly, expirationDate: c.expirationDate
  }));
}

async function buildHeaders(streamUrl, pageUrl) {
  const capturados = streamUrl ? await getHeadersFor(streamUrl) : {};
  const headers = { 'User-Agent': navigator.userAgent, ...capturados };
  if (!headers.Referer && pageUrl) headers.Referer = pageUrl;
  return headers;
}

// ─────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────
async function startDownload({ video, pageUrl, titulo, tabId, mode }) {
  const taskId = `t_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const task = {
    status: 'starting', percent: 0, eta: '', speed: '', error: null, filepath: null,
    videoUrl: video?.url || '', pageUrl: pageUrl || '', tabId, mode,
    nombre: video?.nombre || titulo || '', companionId: null, chromeId: null, log: []
  };
  _descargas.set(taskId, task);
  await persistTask(taskId, task);

  _run(taskId, task, video).catch(err => _fail(taskId, err?.message || String(err)));
  return taskId;
}

async function cancelDownload(taskId) {
  const task = _descargas.get(taskId) || (await loadTask(taskId));
  if (!task) return false;
  if (task.companionId) {
    fetch(`${COMPANION_URL}/cancel/${task.companionId}`, { method: 'DELETE' }).catch(() => {});
  }
  if (task.chromeId) chrome.downloads.cancel(task.chromeId).catch(() => {});
  task.status = 'cancelled';
  _descargas.set(taskId, task);
  await persistTask(taskId, task);
  _emit(taskId, task);
  return true;
}

// Active + recent tasks for a tab. Re-syncs with the companion so a restarted
// service worker still reports the truth.
async function listDownloads(tabId) {
  const all = await chrome.storage.session.get(null);
  const tareas = [];
  let jobs = null;
  for (const [key, task] of Object.entries(all)) {
    if (!key.startsWith('task:')) continue;
    if (tabId !== undefined && task.tabId !== tabId) continue;
    const taskId = key.slice(5);
    if (task.companionId && task.status !== 'done' && task.status !== 'error' && task.status !== 'cancelled') {
      if (jobs === null) {
        try { jobs = (await (await fetch(`${COMPANION_URL}/jobs`)).json()).jobs || []; } catch { jobs = []; }
      }
      const job = jobs.find(j => j.id === task.companionId);
      if (job) _applyJob(task, job);
      else if (jobs.length >= 0 && !_descargas.has(taskId)) { task.status = 'error'; task.error = 'El companion se reinició durante la descarga'; }
      _descargas.set(taskId, task);
      await persistTask(taskId, task);
    }
    tareas.push({ taskId, ...task });
  }
  return tareas;
}

// ─────────────────────────────────────────────
// INTERNALS
// ─────────────────────────────────────────────
async function _run(taskId, task, video) {
  const companion = await checkCompanion();

  if (!companion.activo) {
    if (video && TIPOS_DIRECTOS.has(video.tipo)) return _downloadDirect(taskId, task, video);
    throw new Error('COMPANION_REQUERIDO');
  }
  if (!companion.ffmpeg || !companion.ytdlp) throw new Error('COMPANION_INCOMPLETO');

  const streamUrl = video?.url || '';
  const [cookies, headers] = await Promise.all([
    collectCookies([task.pageUrl, streamUrl].filter(Boolean), task.pageUrl),
    buildHeaders(streamUrl, task.pageUrl)
  ]);

  const resp = await fetch(`${COMPANION_URL}/download`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      pageUrl: task.pageUrl,
      streamUrl,
      headers,
      cookies,
      filename: task.mode === 'stream' ? task.nombre : '',
      mode: task.mode
    })
  });
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    throw new Error(body.error || `Companion respondió ${resp.status}`);
  }
  const { id } = await resp.json();
  task.companionId = id;
  task.status = 'running';
  await persistTask(taskId, task);
  _emit(taskId, task);

  while (task.status === 'running') {
    await new Promise(r => setTimeout(r, 1000));
    let job;
    try {
      job = await (await fetch(`${COMPANION_URL}/status/${id}`)).json();
    } catch {
      throw new Error('Se perdió la conexión con el companion');
    }
    if (job.error && job.status === 'error') { _applyJob(task, job); break; }
    _applyJob(task, job);
    // storage.set is an extension API call: it also keeps the worker alive while polling.
    await persistTask(taskId, task);
    _emit(taskId, task);
  }
  await persistTask(taskId, task);
  _emit(taskId, task);
}

function _applyJob(task, job) {
  if (task.status === 'cancelled') return;
  task.percent = job.percent ?? task.percent;
  task.eta = job.eta || '';
  task.speed = job.speed || '';
  task.log = job.log || [];
  task.filepath = job.filepath || task.filepath;
  if (job.status === 'done') { task.status = 'done'; task.percent = 100; }
  else if (job.status === 'error') { task.status = 'error'; task.error = job.error || 'Error en el companion'; }
  else if (job.status === 'cancelled') { task.status = 'cancelled'; }
}

async function _downloadDirect(taskId, task, video) {
  const ext = (video.url.split(/[?#]/)[0].match(/\.([a-z0-9]+)$/i) || [])[1] || 'mp4';
  const nombre = (task.nombre || 'video').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 150);
  task.status = 'running';
  task.percent = 10;
  _emit(taskId, task);

  const chromeId = await chrome.downloads.download({ url: video.url, filename: `${nombre}.${ext}`, saveAs: false });
  task.chromeId = chromeId;
  await persistTask(taskId, task);

  await new Promise((resolve) => {
    const listener = (delta) => {
      if (delta.id !== chromeId) return;
      if (delta.state?.current === 'complete') { task.status = 'done'; task.percent = 100; }
      else if (delta.state?.current === 'interrupted') { task.status = 'error'; task.error = 'Chrome interrumpió la descarga'; }
      else return;
      chrome.downloads.onChanged.removeListener(listener);
      resolve();
    };
    chrome.downloads.onChanged.addListener(listener);
    // Progress for direct downloads: chrome.downloads manages the file; we report coarse state.
    const tick = setInterval(async () => {
      if (task.status !== 'running') return clearInterval(tick);
      const [item] = await chrome.downloads.search({ id: chromeId }).catch(() => []);
      if (item?.totalBytes > 0) {
        task.percent = Math.min(99, Math.round((item.bytesReceived / item.totalBytes) * 100));
        await persistTask(taskId, task);
        _emit(taskId, task);
      }
    }, 1000);
  });
  await persistTask(taskId, task);
  _emit(taskId, task);
}

function _fail(taskId, message) {
  const task = _descargas.get(taskId);
  if (!task) return;
  task.status = 'error';
  task.error = message;
  persistTask(taskId, task).catch(() => {});
  _emit(taskId, task);
}

function _emit(taskId, task) {
  chrome.runtime.sendMessage({
    type: 'progress', taskId, status: task.status, percent: task.percent,
    eta: task.eta, speed: task.speed, error: task.error, filepath: task.filepath, log: task.log
  }).catch(() => {});
}

async function persistTask(taskId, task) {
  await chrome.storage.session.set({ [`task:${taskId}`]: task });
}

async function loadTask(taskId) {
  const data = await chrome.storage.session.get(`task:${taskId}`);
  return data[`task:${taskId}`] || null;
}
