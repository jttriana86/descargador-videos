// popup.js — Vista avanzada con tarjetas, miniaturas, edición de nombres y limpieza de historial.

let tabActual = null;
let paginaActual = { pageUrl: '', titulo: '' };
let companion = { activo: false };
const tareas = new Map(); // taskId → task
let videosDetectados = [];

const $ = (id) => document.getElementById(id);

function enviar(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (r) => resolve(chrome.runtime.lastError ? { error: chrome.runtime.lastError.message } : r));
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) {
    tabActual = tab.id;
    paginaActual = { pageUrl: tab.url || '', titulo: tab.title || '' };
  }

  // Event listeners globales
  $('btn-pagina')?.addEventListener('click', descargarPagina);
  $('btn-carpeta')?.addEventListener('click', () => enviar({ tipo: 'ABRIR_CARPETA' }));
  $('btn-pie-carpeta')?.addEventListener('click', () => enviar({ tipo: 'ABRIR_CARPETA' }));
  
  $('btn-limpiar')?.addEventListener('click', async () => {
    await enviar({ tipo: 'LIMPIAR_VIDEOS', tabId: tabActual });
    videosDetectados = [];
    renderizarVideos([]);
  });

  $('btn-limpiar-descargas')?.addEventListener('click', limpiarDescargasTerminadas);
  $('btn-pie-limpiar')?.addEventListener('click', limpiarDescargasTerminadas);

  $('btn-descargar-todos')?.addEventListener('click', descargarTodosLosVideos);

  await Promise.all([actualizarCompanion(), cargarVideos(), cargarTareas()]);
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type !== 'progress') return;
  const t = tareas.get(msg.taskId);
  if (!t) return;
  Object.assign(t, msg);
  renderizarTareas();
});

// ─────────────────────────────────────────────
// COMPANION
// ─────────────────────────────────────────────
async function actualizarCompanion() {
  companion = await enviar({ tipo: 'ESTADO_COMPANION' }) || { activo: false };
  const el = $('companion-estado');
  const texto = el.querySelector('.companion-texto');
  el.classList.remove('comprobando', 'activo', 'inactivo', 'aviso');

  if (!companion.activo) {
    el.classList.add('inactivo');
    texto.textContent = 'Companion apagado';
    $('aviso-companion').hidden = false;
    $('btn-carpeta').hidden = true;
    $('btn-pagina').disabled = true;
  } else if (!companion.ffmpeg || !companion.ytdlp || companion.desactualizado) {
    el.classList.add('aviso');
    texto.textContent = companion.desactualizado ? `Companion v${companion.version}: actualízalo` : 'Companion sin FFmpeg o yt-dlp';
    $('aviso-companion').hidden = true;
    $('btn-pagina').disabled = true;
  } else {
    el.classList.add('activo');
    texto.textContent = `Companion activo · v${companion.version}`;
    $('aviso-companion').hidden = true;
    $('btn-carpeta').hidden = false;
    $('btn-pagina').disabled = false;
  }
  $('pagina-titulo').textContent = paginaActual.titulo || paginaActual.pageUrl;
}

// ─────────────────────────────────────────────
// HISTORIAL Y TAREAS DE DESCARGA
// ─────────────────────────────────────────────
async function descargarPagina() {
  const r = await enviar({
    tipo: 'INICIAR_DESCARGA', mode: 'page', video: null,
    pageUrl: paginaActual.pageUrl, titulo: paginaActual.titulo, tabId: tabActual
  });
  if (r?.taskId) {
    registrarTarea(r.taskId, { nombre: paginaActual.titulo || paginaActual.pageUrl, status: 'starting', percent: 0 });
  }
}

async function descargarStream(video) {
  const r = await enviar({
    tipo: 'INICIAR_DESCARGA', mode: 'stream', video,
    pageUrl: paginaActual.pageUrl, titulo: video.nombre, tabId: tabActual
  });
  if (r?.taskId) {
    registrarTarea(r.taskId, { nombre: video.nombre, videoUrl: video.url, status: 'starting', percent: 0 });
  }
}

async function descargarTodosLosVideos() {
  if (!videosDetectados.length) return;
  const btn = $('btn-descargar-todos');
  btn.disabled = true;
  btn.textContent = '⏳ Iniciando cola…';

  for (const v of videosDetectados) {
    await descargarStream(v);
    await new Promise(r => setTimeout(r, 600));
  }

  setTimeout(() => {
    btn.disabled = false;
    btn.textContent = '⬇ Descargar todos';
  }, 2000);
}

function registrarTarea(taskId, datos) {
  tareas.set(taskId, { taskId, ...datos });
  renderizarTareas();
}

async function cargarTareas() {
  const r = await enviar({ tipo: 'OBTENER_DESCARGAS_ACTIVAS', tabId: tabActual });
  tareas.clear();
  for (const t of r?.tareas || []) tareas.set(t.taskId, t);
  renderizarTareas();
}

async function limpiarDescargasTerminadas() {
  await enviar({ tipo: 'LIMPIAR_DESCARGAS' });
  for (const [id, t] of tareas.entries()) {
    if (t.status === 'done' || t.status === 'error' || t.status === 'cancelled') {
      tareas.delete(id);
    }
  }
  renderizarTareas();
}

async function eliminarTarea(taskId) {
  await enviar({ tipo: 'ELIMINAR_TAREA', taskId });
  tareas.delete(taskId);
  renderizarTareas();
}

function textoEstado(t) {
  switch (t.status) {
    case 'starting': return 'Preparando…';
    case 'running': return `${Math.round(t.percent || 0)}%${t.eta ? ` · ETA ${t.eta}` : ''}${t.speed ? ` · ${t.speed}` : ''}`;
    case 'done': return '✓ Guardado en Descargas';
    case 'cancelled': return 'Cancelada';
    case 'error': return '✕ Falló';
    default: return t.status;
  }
}

function textoError(err) {
  if (!err) return '';
  if (err === 'COMPANION_REQUERIDO') return 'Este video necesita el companion. Enciéndelo y vuelve a intentar.';
  if (err === 'COMPANION_INCOMPLETO') return 'Al companion le falta FFmpeg o yt-dlp. Ejecuta instalar.bat.';
  if (/Unsupported URL/i.test(err)) return 'La URL directa de esta página no es compatible con yt-dlp. En páginas con varios videos (como conferencias o cursos), usa los botones "Descargar" de la lista de abajo.';
  if (/HTTP Error 403|Forbidden/i.test(err)) return 'El servidor rechazó la descarga (403). Suele ser un token temporal: dale play al video en la página y reintenta enseguida.';
  if (/HTTP Error 401|login|sign in|private/i.test(err)) return 'Esta página o video requiere sesión. Para sitios con múltiples videos, descarga cada video individualmente desde la lista de abajo.';
  if (/DRM|Widevine|encrypted/i.test(err)) return 'Este video tiene protección DRM comercial y no puede ser grabado directamente.';
  return err;
}

function renderizarTareas() {
  const cont = $('lista-descargas');
  const sec = $('descargas');
  const lista = [...tareas.values()].sort((a, b) => (b.taskId > a.taskId ? 1 : -1));
  sec.hidden = lista.length === 0;
  cont.innerHTML = '';

  for (const t of lista) {
    const div = document.createElement('div');
    div.className = `tarea ${t.status}`;
    const pct = Math.min(100, Math.max(0, t.percent || 0));

    div.innerHTML = `
      <div class="tarea-cab">
        <span class="tarea-nombre" title="${t.nombre || ''}">${t.nombre || t.videoUrl || 'Video'}</span>
        <span class="tarea-estado">${textoEstado(t)}</span>
        <button class="btn-cerrar-item" title="Descartar de la lista">✕</button>
      </div>
      <div class="barra-progreso"><div class="barra-fill" style="width:${pct}%"></div></div>
      <div class="tarea-pie">
        <span class="tarea-ruta">${t.status === 'done' && t.filepath ? t.filepath.split(/[\\/]/).pop() : ''}</span>
        <div class="tarea-botones"></div>
      </div>
      <div class="tarea-error" hidden></div>
      <pre class="tarea-log" hidden></pre>
    `;

    // Botón descartar
    div.querySelector('.btn-cerrar-item').addEventListener('click', () => eliminarTarea(t.taskId));

    const botones = div.querySelector('.tarea-botones');
    if (t.status === 'running' || t.status === 'starting') {
      const b = document.createElement('button');
      b.className = 'btn-detalle';
      b.textContent = 'Cancelar';
      b.addEventListener('click', () => enviar({ tipo: 'CANCELAR_DESCARGA', taskId: t.taskId }));
      botones.appendChild(b);
    }

    if (t.status === 'error') {
      const errEl = div.querySelector('.tarea-error');
      errEl.hidden = false;
      errEl.textContent = textoError(t.error);

      if (t.log?.length) {
        const b = document.createElement('button');
        b.className = 'btn-detalle';
        b.textContent = 'Ver detalle';
        const log = div.querySelector('.tarea-log');
        log.textContent = t.log.join('\n');
        b.addEventListener('click', () => {
          log.hidden = !log.hidden;
          b.textContent = log.hidden ? 'Ver detalle' : 'Ocultar detalle';
        });
        botones.appendChild(b);
      }
    }

    if (t.status === 'done' && companion.activo) {
      const b = document.createElement('button');
      b.className = 'btn-detalle';
      b.textContent = '📂 Abrir archivo';
      b.addEventListener('click', () => enviar({ tipo: 'ABRIR_CARPETA' }));
      botones.appendChild(b);
    }

    cont.appendChild(div);
  }
}

// ─────────────────────────────────────────────
// VIDEOS Y STREAMS DETECTADOS
// ─────────────────────────────────────────────
async function cargarVideos() {
  const r = await enviar({ tipo: 'OBTENER_VIDEOS', tabId: tabActual });
  if (r?.pageUrl) paginaActual.pageUrl = r.pageUrl;
  if (r?.titulo) paginaActual.titulo = r.titulo;
  $('pagina-titulo').textContent = paginaActual.titulo || paginaActual.pageUrl;
  videosDetectados = r?.videos || [];
  renderizarVideos(videosDetectados);
}

function renderizarVideos(videos) {
  const cont = $('videos-container');
  const vacio = $('estado-vacio');
  const contador = $('contador-texto');
  const contadorSub = $('contador-sub');
  const btnTodos = $('btn-descargar-todos');

  cont.innerHTML = '';
  vacio.hidden = videos.length > 0;
  btnTodos.hidden = videos.length <= 1;

  if (videos.length === 0) {
    contador.textContent = 'Videos detectados';
    contadorSub.textContent = 'Dale play al video en la página para capturarlo';
  } else if (videos.length === 1) {
    contador.textContent = '1 video detectado';
    contadorSub.textContent = 'Listo para descargar con su mejor calidad';
  } else {
    contador.textContent = `${videos.length} videos detectados`;
    contadorSub.textContent = 'Descarga individual o todo el lote de sesiones';
  }

  videos.forEach((video, idx) => {
    const card = document.createElement('div');
    card.className = 'video-card';

    // Miniatura
    const tienePoster = !!video.poster;
    const duracionHtml = video.duracion ? `<div class="card-duracion-badge">${video.duracion}</div>` : '';

    const thumbHtml = `
      <div class="card-thumb-wrap">
        ${tienePoster ? `<img src="${video.poster}" class="card-thumb-img" alt="">` : `<div class="card-thumb-placeholder">🎬</div>`}
        ${duracionHtml}
      </div>
    `;

    // Nombre legible con extensión sugerida
    let nombreMostrar = video.nombre || `Video ${idx + 1}`;
    if (!nombreMostrar.toLowerCase().endsWith('.mp4')) {
      nombreMostrar += '.mp4';
    }

    const tipoBadge = (video.tipo || 'HLS').toUpperCase();
    const tipoClass = tipoBadge.toLowerCase();

    card.innerHTML = `
      ${thumbHtml}
      <div class="card-body">
        <div class="card-top-row">
          <span class="tag-stream ${tipoClass}">${tipoBadge}</span>
          <span class="card-title-text" title="${nombreMostrar}">${nombreMostrar}</span>
          <input type="text" class="card-title-input" value="${nombreMostrar.replace(/\.mp4$/i, '')}" hidden>
          <button class="card-btn-dismiss" title="Eliminar de la lista">✕</button>
        </div>
        <div class="card-bottom-row">
          <div class="card-tools">
            <button class="btn-editar-nombre" title="Renombrar video">✏️ Editar</button>
            <span class="pill-calidad">MP4 1080p</span>
          </div>
          <button class="btn-descargar-azul">⬇ Descargar</button>
        </div>
      </div>
    `;

    // 1. Eliminar video de la lista
    card.querySelector('.card-btn-dismiss').addEventListener('click', async () => {
      await enviar({ tipo: 'ELIMINAR_VIDEO', tabId: tabActual, url: video.url });
      videosDetectados = videosDetectados.filter(v => v.url !== video.url);
      renderizarVideos(videosDetectados);
    });

    // 2. Renombrar video
    const titleText = card.querySelector('.card-title-text');
    const titleInput = card.querySelector('.card-title-input');
    const btnEditar = card.querySelector('.btn-editar-nombre');

    btnEditar.addEventListener('click', () => {
      if (titleInput.hidden) {
        titleText.hidden = true;
        titleInput.hidden = false;
        titleInput.focus();
        titleInput.select();
        btnEditar.textContent = '💾 Guardar';
      } else {
        guardarNuevoNombre();
      }
    });

    titleInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') guardarNuevoNombre();
      if (e.key === 'Escape') {
        titleInput.hidden = true;
        titleText.hidden = false;
        btnEditar.textContent = '✏️ Editar';
      }
    });

    async function guardarNuevoNombre() {
      const nuevo = (titleInput.value || '').trim();
      if (nuevo) {
        video.nombre = nuevo;
        const nombreConExt = nuevo.endsWith('.mp4') ? nuevo : `${nuevo}.mp4`;
        titleText.textContent = nombreConExt;
        titleText.title = nombreConExt;
        await enviar({ tipo: 'RENOMBRAR_VIDEO', tabId: tabActual, url: video.url, nuevoNombre: nuevo });
      }
      titleInput.hidden = true;
      titleText.hidden = false;
      btnEditar.textContent = '✏️ Editar';
    }

    // 3. Descargar video
    const btnDescargar = card.querySelector('.btn-descargar-azul');
    btnDescargar.addEventListener('click', async () => {
      btnDescargar.disabled = true;
      btnDescargar.textContent = '⏳ Enviando…';
      await descargarStream(video);
      setTimeout(() => {
        btnDescargar.disabled = false;
        btnDescargar.textContent = '⬇ Descargar';
      }, 2500);
    });

    cont.appendChild(card);
  });
}
