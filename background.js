// background.js — Service worker.
// Detects media requests, keeps a per-tab list of detected videos, captures the
// request headers the CDN expects, and hands downloads to downloader-engine.js.
// State lives in chrome.storage.session so it survives service worker restarts.

importScripts('downloader-engine.js');
importScripts('platform-interceptors.js');

// ─────────────────────────────────────────────
// DETECTION RULES
// ─────────────────────────────────────────────
const PATRON_VIDEO = /\.(mp4|webm|ogv|mov|m4v|m3u8|mpd|flv|mkv)(\?|#|$)/i;

// Individual fragments of a stream: never list them, the manifest is what we want.
const PATRON_SEGMENTO = /\.(ts|m4s|aac|vtt)(\?|#|$)|[/_-](seg|segment|chunk|frag|fragment)[_-]?\d+|[/_-]init(\.mp4|\.m4s|[_-])|\/range\/\d+-\d+|[?&]range=\d+-\d+|\/parcel\/(audio|video)\/|\/audio\/[^/?#]*\.(m3u8|m4s)(\?|#|$)/i;

const TIPOS_VIDEO = [
  'video/', 'application/x-mpegurl', 'application/vnd.apple.mpegurl',
  'application/dash+xml', 'audio/mpegurl', 'audio/x-mpegurl'
];
const TIPOS_SEGMENTO = ['video/mp2t', 'video/iso.segment', 'video/vnd.mpeg.dash.mpd+segment'];

const PATRON_UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const NOMBRE_GENERICO = /^(playlist|index|manifest|master|video|stream|hls|dash|media|main|primary|chunklist|prog_index|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{16,}|\d+)$/i;

// Playlist file names are almost never a title: quality labels (1080p, v720),
// track names (audio_es, video_2), hashes, or master/index variants.
const NOMBRE_GENERICO_MANIFIESTO = /^(\d{3,4}p?|[a-z]{0,3}\d{3,4}p?([_-]?\d+k?)?|(audio|video|sub|chunklist|playlist|index|stream|track|rendition|variant)[a-z0-9_-]*|av|[a-z0-9]{8,}|[a-z0-9_-]*(hd|sd|high|low|med|medium|mobile|main|master)[a-z0-9_-]*)$/i;

function esNombreGenerico(nombre, tipo) {
  if (!nombre) return true;
  if (NOMBRE_GENERICO.test(nombre)) return true;
  return esManifiesto(tipo) && NOMBRE_GENERICO_MANIFIESTO.test(nombre);
}

// Name confidence stored on each video as `nivelNombre`. A higher level always
// overwrites a lower one, so a late-arriving real title fixes an auto name.
//   0 = auto: page title + counter, or a generic file name
//   1 = non-generic file name taken from the URL
//   2 = <title> of the iframe the request came from
//   3 = title from the page DOM or a platform interceptor
//   4 = typed by the user
const NIVEL_AUTO = 0, NIVEL_ARCHIVO = 1, NIVEL_FRAME = 2, NIVEL_DOM = 3, NIVEL_USUARIO = 4;

// Request headers worth replaying from the companion.
const HEADERS_CAPTURADOS = new Set(['referer', 'origin', 'authorization', 'user-agent']);

// ─────────────────────────────────────────────
// SESSION STORAGE HELPERS
// ─────────────────────────────────────────────
async function getTabState(tabId) {
  const key = `tab:${tabId}`;
  const data = await chrome.storage.session.get(key);
  return data[key] || { videos: [], titulo: '', pageUrl: '' };
}

async function setTabState(tabId, state) {
  await chrome.storage.session.set({ [`tab:${tabId}`]: state });
}

async function clearTabState(tabId) {
  await chrome.storage.session.remove(`tab:${tabId}`);
  chrome.action.setBadgeText({ text: '', tabId }).catch(() => {});
}

const _headersCache = new Map(); // hostname → headers (in-memory mirror)

async function saveHeaders(hostname, headers) {
  const prev = _headersCache.get(hostname);
  const next = { ...(prev || {}), ...headers };
  if (prev && JSON.stringify(prev) === JSON.stringify(next)) return;
  _headersCache.set(hostname, next);
  await chrome.storage.session.set({ [`hdr:${hostname}`]: next });
}

async function getHeadersFor(url) {
  try {
    const host = new URL(url).hostname;
    if (_headersCache.has(host)) return _headersCache.get(host);
    const data = await chrome.storage.session.get(`hdr:${host}`);
    return data[`hdr:${host}`] || {};
  } catch {
    return {};
  }
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
function detectarTipo(url, contentType = '') {
  const u = url.toLowerCase().split(/[?#]/)[0];
  const ct = contentType.toLowerCase();
  if (u.endsWith('.m3u8') || ct.includes('mpegurl')) return 'HLS';
  if (u.endsWith('.mpd') || ct.includes('dash+xml')) return 'DASH';
  if (u.endsWith('.mp4') || u.endsWith('.m4v')) return 'MP4';
  if (u.endsWith('.webm')) return 'WEBM';
  if (u.endsWith('.mov')) return 'MOV';
  if (u.endsWith('.mkv')) return 'MKV';
  if (u.endsWith('.flv')) return 'FLV';
  return 'VIDEO';
}

function extraerNombre(url) {
  try {
    const archivo = new URL(url).pathname.split('/').filter(Boolean).pop() || '';
    return decodeURIComponent(archivo.replace(/\.[^/.]+$/, '')) || '';
  } catch {
    return '';
  }
}

function claveDedup(url) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname;
  } catch {
    return url;
  }
}

function directorio(url) {
  try {
    const u = new URL(url);
    return u.origin + u.pathname.replace(/[^/]*$/, '');
  } catch {
    return url;
  }
}

// Streams whose path carries a UUID (Vimeo, Mux, Cloudflare Stream...) belong to
// the same video when the UUID matches, whatever the CDN host or sub-folder.
function claveGrupo(url) {
  try {
    const m = new URL(url).pathname.match(PATRON_UUID);
    return m ? m[0].toLowerCase() : null;
  } catch {
    return null;
  }
}

function profundidad(url) {
  try {
    return new URL(url).pathname.split('/').filter(Boolean).length;
  } catch {
    return 0;
  }
}

function esManifiesto(tipo) {
  return tipo === 'HLS' || tipo === 'DASH';
}

function encontrarDuplicado(videos, url, tipo) {
  const clave = claveDedup(url);
  const exact = videos.find(v => claveDedup(v.url) === clave);
  if (exact) return exact;
  if (!esManifiesto(tipo)) return null;

  const grupo = claveGrupo(url);
  if (grupo) {
    const g = videos.find(v => esManifiesto(v.tipo) && claveGrupo(v.url) === grupo);
    if (g) return g;
  }

  // Master and variant playlists live in nested folders; match in both
  // directions so it works whichever one the player requested first.
  const dir = directorio(url);
  return videos.find(v => {
    if (v.tipo !== tipo) return false;
    const dirV = directorio(v.url);
    return dir.startsWith(dirV) || dirV.startsWith(dir);
  });
}

// Auto-named videos follow the page title: generic names, or names derived
// from a previous (stale) title, get renumbered when the title changes.
function sigueTitulo(v, anterior) {
  if ((v.nivelNombre ?? NIVEL_AUTO) !== NIVEL_AUTO) return false;
  if (esNombreGenerico(v.nombre, v.tipo)) return true;
  return !!anterior && !!v.nombre && v.nombre.startsWith(anterior);
}

function aplicarTituloPagina(state, titulo) {
  const anterior = state.titulo;
  state.titulo = titulo;
  if (!titulo || titulo === anterior) return;
  let n = state.videos.filter(v => !sigueTitulo(v, anterior) && v.nombre && v.nombre.startsWith(titulo)).length;
  for (const v of state.videos) {
    if (!sigueTitulo(v, anterior)) continue;
    n++;
    v.nombre = n === 1 ? titulo : `${titulo} (${n})`;
  }
}

// Per-tab lock. Listeners fire concurrently and each one does a
// read-modify-write on the tab state; without serialising them, two requests
// of the same stream arriving together would both create an entry.
const _locks = new Map();
function conLockTab(tabId, fn) {
  const prev = _locks.get(tabId) || Promise.resolve();
  const next = prev.catch(() => {}).then(fn);
  _locks.set(tabId, next);
  next.finally(() => { if (_locks.get(tabId) === next) _locks.delete(tabId); }).catch(() => {});
  return next;
}

function agregarVideo(tabId, url, opts) {
  return conLockTab(tabId, () => _agregarVideo(tabId, url, opts));
}

// `urlFija` marks a URL handed to us by a platform config (the real master
// playlist); it is never swapped for a variant the player happened to request.
async function _agregarVideo(tabId, url, { tipo, nombre, nivelNombre, plataforma, poster, duracion, frameId, urlFija } = {}) {
  if (tabId < 0 || !/^https?:/.test(url)) return;
  if (PATRON_SEGMENTO.test(url)) return;

  const state = await getTabState(tabId);
  tipo = tipo || detectarTipo(url);
  const nivel = nombre ? (nivelNombre ?? NIVEL_DOM) : NIVEL_AUTO;

  const dup = encontrarDuplicado(state.videos, url, tipo);
  if (dup) {
    let mod = false;
    if (nombre && nivel > (dup.nivelNombre ?? NIVEL_AUTO)) {
      dup.nombre = nombre;
      dup.nivelNombre = nivel;
      mod = true;
    }
    if (claveDedup(dup.url) !== claveDedup(url) && !dup.urlFija) {
      // Prefer the master playlist (shallower path) over a quality variant.
      if (urlFija || profundidad(url) < profundidad(dup.url)) {
        dup.url = url;
        dup.urlFija = !!urlFija;
        mod = true;
      }
    }
    if (plataforma && !dup.plataforma) {
      dup.plataforma = plataforma;
      mod = true;
    }
    if (poster && !dup.poster) {
      dup.poster = poster;
      mod = true;
    }
    if (duracion && !dup.duracion) {
      dup.duracion = duracion;
      mod = true;
    }
    if (mod) await setTabState(tabId, state);
    return;
  }

  const nombreArchivo = extraerNombre(url);
  const tituloFrame = frameId > 0 ? (state.frames?.[frameId] || '') : '';
  let nombreFinal, nivelFinal;
  if (nombre) {
    nombreFinal = nombre;
    nivelFinal = nivel;
  } else if (!esNombreGenerico(nombreArchivo, tipo)) {
    nombreFinal = nombreArchivo;
    nivelFinal = NIVEL_ARCHIVO;
  } else if (tituloFrame) {
    nombreFinal = tituloFrame;
    nivelFinal = NIVEL_FRAME;
  } else if (state.titulo) {
    const cuentaSimilares = state.videos.filter(v => v.nombre && v.nombre.startsWith(state.titulo)).length;
    nombreFinal = cuentaSimilares === 0 ? state.titulo : `${state.titulo} (${cuentaSimilares + 1})`;
    nivelFinal = NIVEL_AUTO;
  } else {
    nombreFinal = nombreArchivo || 'Video';
    nivelFinal = NIVEL_AUTO;
  }

  state.videos.push({
    url,
    tipo,
    nombre: nombreFinal,
    nivelNombre: nivelFinal,
    urlFija: !!urlFija,
    frameId: frameId ?? 0,
    plataforma: plataforma || null,
    poster: poster || null,
    duracion: duracion || null,
    timestamp: Date.now()
  });
  await setTabState(tabId, state);

  chrome.action.setBadgeText({ text: String(state.videos.length), tabId }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ color: '#3ccf91', tabId }).catch(() => {});
}

// ─────────────────────────────────────────────
// WEB REQUEST LISTENERS
// ─────────────────────────────────────────────

// Capture the headers the page used for media requests, keyed by hostname.
chrome.webRequest.onBeforeSendHeaders.addListener(
  (d) => {
    if (d.tabId < 0) return;
    if (!PATRON_VIDEO.test(d.url) && !PATRON_SEGMENTO.test(d.url) && d.type !== 'media') return;
    const capturados = {};
    for (const h of d.requestHeaders || []) {
      const n = h.name.toLowerCase();
      if (HEADERS_CAPTURADOS.has(n)) capturados[n === 'user-agent' ? 'User-Agent' : n[0].toUpperCase() + n.slice(1)] = h.value;
    }
    if (Object.keys(capturados).length === 0) return;
    try { saveHeaders(new URL(d.url).hostname, capturados).catch(() => {}); } catch { /* invalid url */ }
  },
  { urls: ['<all_urls>'] },
  ['requestHeaders']
);

// Detect by file extension in the URL.
chrome.webRequest.onBeforeRequest.addListener(
  (d) => {
    if (PATRON_VIDEO.test(d.url)) agregarVideo(d.tabId, d.url, { frameId: d.frameId }).catch(() => {});
  },
  { urls: ['<all_urls>'] }
);

// Detect by Content-Type, for streams without an extension (/api/stream?id=1, /playlist?token=...).
chrome.webRequest.onHeadersReceived.addListener(
  (d) => {
    if (PATRON_VIDEO.test(d.url)) return;
    const ct = (d.responseHeaders?.find(h => h.name.toLowerCase() === 'content-type')?.value || '').toLowerCase();
    if (!ct || TIPOS_SEGMENTO.some(t => ct.includes(t))) return;
    if (!TIPOS_VIDEO.some(t => ct.includes(t))) return;
    agregarVideo(d.tabId, d.url, { tipo: detectarTipo(d.url, ct), frameId: d.frameId }).catch(() => {});
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders']
);

// Catch-all for <video>/<audio> element requests (resourceType "media"): a
// progressive file served without extension and with a generic Content-Type
// (application/octet-stream is common) passes both filters above. If a media
// element asked for it, it IS playable media — list it whatever it looks like.
chrome.webRequest.onHeadersReceived.addListener(
  (d) => {
    if (d.type !== 'media') return;
    if (PATRON_VIDEO.test(d.url) || PATRON_SEGMENTO.test(d.url)) return; // already handled / fragment
    const ct = (d.responseHeaders?.find(h => h.name.toLowerCase() === 'content-type')?.value || '').toLowerCase();
    if (TIPOS_VIDEO.some(t => ct.includes(t)) || TIPOS_SEGMENTO.some(t => ct.includes(t))) return;
    if (ct.startsWith('audio/')) return; // background music, not the lesson
    // Skip tiny responses (probes, moov atoms): need total size when available.
    const range = d.responseHeaders?.find(h => h.name.toLowerCase() === 'content-range')?.value || '';
    const total = +(range.split('/')[1] || d.responseHeaders?.find(h => h.name.toLowerCase() === 'content-length')?.value || 0);
    if (total > 0 && total < 500 * 1024) return;
    agregarVideo(d.tabId, d.url, { tipo: 'MP4', frameId: d.frameId }).catch(() => {});
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders']
);

// Platform-specific interceptors (Vimeo, Wistia, Hotmart, Spool) resolve config
// endpoints into the real stream URL.
chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    for (const interceptor of PLATFORM_INTERCEPTORS) {
      if (!interceptor.urlPattern.test(details.url)) continue;
      interceptor.extractVideoInfo(details)
        .then(info => {
          if (!info || details.tabId < 0) return;
          return agregarVideo(details.tabId, info.url, {
            tipo: info.tipo, nombre: info.nombre, nivelNombre: NIVEL_DOM, plataforma: info.plataforma,
            frameId: details.frameId, urlFija: true
          });
        })
        .catch(() => {});
      break;
    }
  },
  { urls: ['*://*.hotmart.com/*', '*://fast.wistia.net/*', '*://player.vimeo.com/*', '*://*.spool.video/*'] },
  ['responseHeaders']
);

// ─────────────────────────────────────────────
// TAB LIFECYCLE
// ─────────────────────────────────────────────
chrome.tabs.onUpdated.addListener((tabId, cambio, tab) => {
  if (cambio.status === 'loading' && cambio.url) {
    // Real navigation (not a hash change or a SPA route): start fresh.
    clearTabState(tabId).then(() => setTabState(tabId, { videos: [], titulo: tab?.title || '', pageUrl: cambio.url })).catch(() => {});
  } else if (cambio.title) {
    conLockTab(tabId, async () => {
      const state = await getTabState(tabId);
      state.pageUrl = state.pageUrl || tab?.url || '';
      aplicarTituloPagina(state, cambio.title);
      await setTabState(tabId, state);
    }).catch(() => {});
  }
});

chrome.tabs.onRemoved.addListener((tabId) => { clearTabState(tabId).catch(() => {}); });

// ─────────────────────────────────────────────
// MESSAGES
// ─────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, responder) => {
  (async () => {
    switch (msg.tipo) {
      case 'OBTENER_VIDEOS': {
        const state = await getTabState(msg.tabId);
        if (!state.pageUrl) {
          try { const tab = await chrome.tabs.get(msg.tabId); state.pageUrl = tab.url || ''; state.titulo = state.titulo || tab.title || ''; } catch { /* closed */ }
        }
        return { videos: state.videos, titulo: state.titulo, pageUrl: state.pageUrl };
      }

      case 'VIDEO_DOM':
        if (sender.tab?.id) {
          await agregarVideo(sender.tab.id, msg.url, {
            tipo: msg.tipoStream,
            nombre: msg.titulo,
            nivelNombre: NIVEL_DOM,
            plataforma: msg.plataforma,
            poster: msg.poster,
            duracion: msg.duracion,
            frameId: sender.frameId,
            urlFija: !!msg.urlFija
          });
        }
        return { ok: true };

      // <title> of an iframe (a Vimeo/Wistia embed, a course player...). Streams
      // requested from that frame borrow it when their own name is generic.
      case 'TITULO_FRAME':
        if (sender.tab?.id && sender.frameId > 0 && msg.titulo) {
          await conLockTab(sender.tab.id, async () => {
            const state = await getTabState(sender.tab.id);
            state.frames = state.frames || {};
            state.frames[sender.frameId] = msg.titulo;
            for (const v of state.videos) {
              if (v.frameId === sender.frameId && (v.nivelNombre ?? NIVEL_AUTO) === NIVEL_AUTO) {
                v.nombre = msg.titulo;
                v.nivelNombre = NIVEL_FRAME;
              }
            }
            await setTabState(sender.tab.id, state);
          });
        }
        return { ok: true };

      case 'RENOMBRAR_VIDEO': {
        const state = await getTabState(msg.tabId);
        const v = state.videos.find(x => x.url === msg.url);
        if (v) {
          v.nombre = msg.nuevoNombre;
          v.nivelNombre = NIVEL_USUARIO;
          await setTabState(msg.tabId, state);
        }
        return { ok: true };
      }

      case 'ELIMINAR_VIDEO': {
        const state = await getTabState(msg.tabId);
        state.videos = state.videos.filter(x => x.url !== msg.url);
        await setTabState(msg.tabId, state);
        chrome.action.setBadgeText({ text: state.videos.length ? String(state.videos.length) : '', tabId: msg.tabId }).catch(() => {});
        return { ok: true };
      }

      case 'LIMPIAR_DESCARGAS': {
        const all = await chrome.storage.session.get(null);
        const toRemove = [];
        for (const [k, v] of Object.entries(all)) {
          if (k.startsWith('task:') && (v.status === 'done' || v.status === 'error' || v.status === 'cancelled')) {
            toRemove.push(k);
          }
        }
        if (toRemove.length > 0) {
          await chrome.storage.session.remove(toRemove);
        }
        return { ok: true };
      }

      case 'ELIMINAR_TAREA': {
        if (msg.taskId) {
          await chrome.storage.session.remove(`task:${msg.taskId}`);
        }
        return { ok: true };
      }

      case 'TITULO_PAGINA':
        if (sender.tab?.id && msg.titulo) {
          await conLockTab(sender.tab.id, async () => {
            const state = await getTabState(sender.tab.id);
            state.pageUrl = state.pageUrl || sender.tab.url || '';
            aplicarTituloPagina(state, msg.titulo);
            await setTabState(sender.tab.id, state);
          });
        }
        return { ok: true };

      case 'LIMPIAR_VIDEOS':
        await clearTabState(msg.tabId);
        return { ok: true };

      case 'ESTADO_COMPANION':
        return await checkCompanion();

      case 'INICIAR_DESCARGA': {
        const taskId = await startDownload({
          video: msg.video || null,
          pageUrl: msg.pageUrl,
          titulo: msg.titulo,
          tabId: msg.tabId,
          mode: msg.mode || (msg.video ? 'stream' : 'page')
        });
        return { taskId };
      }

      case 'CANCELAR_DESCARGA':
        return { ok: await cancelDownload(msg.taskId) };

      case 'OBTENER_DESCARGAS_ACTIVAS':
        return { tareas: await listDownloads(msg.tabId) };

      case 'ABRIR_CARPETA':
        return await openDownloadsFolder();

      default:
        return { error: 'mensaje desconocido' };
    }
  })()
    .then(responder)
    .catch(err => responder({ error: err?.message || String(err) }));
  return true;
});
