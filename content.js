// content.js — Script de contenido avanzado
// Detecta videos, extrae títulos contextuales de tarjetas/páginas, thumbnails y duraciones.

function formatearSegundos(seg) {
  if (!seg || isNaN(seg) || !isFinite(seg) || seg <= 0) return '';
  const h = Math.floor(seg / 3600);
  const m = Math.floor((seg % 3600) / 60);
  const s = Math.floor(seg % 60);
  const ss = s < 10 ? '0' + s : s;
  if (h > 0) {
    const mm = m < 10 ? '0' + m : m;
    return `${h}:${mm}:${ss}`;
  }
  return `${m}:${ss}`;
}

function buscarTituloCercano(el) {
  if (!el) return '';
  
  // 1. Atributos directos
  const attrTitle = el.getAttribute('title') || el.getAttribute('aria-label');
  if (attrTitle && attrTitle.length > 2 && attrTitle.length < 120) return attrTitle.trim();

  // 2. Buscar en tarjeta o contenedor padre (hasta 6 niveles)
  let actual = el;
  for (let i = 0; i < 6 && actual && actual !== document.body; i++) {
    actual = actual.parentElement;
    if (!actual) break;

    // Buscar encabezados o clases de título en este contenedor
    const titulos = actual.querySelectorAll('h1, h2, h3, h4, h5, [class*="title" i], [class*="titulo" i], [class*="heading" i], [class*="session" i], [class*="name" i]');
    for (const t of titulos) {
      const texto = (t.innerText || t.textContent || '').trim();
      if (texto.length >= 3 && texto.length <= 140 && !/^\d+$/.test(texto) && !/reproducir|play|pause|video/i.test(texto)) {
        return texto;
      }
    }
  }

  // 3. Buscar hermanos previos
  let hermano = el.parentElement;
  while (hermano && hermano !== document.body) {
    let prev = hermano.previousElementSibling;
    while (prev) {
      if (/^H[1-6]$/i.test(prev.tagName) || prev.querySelector('h1, h2, h3, h4')) {
        const h = /^H[1-6]$/i.test(prev.tagName) ? prev : prev.querySelector('h1, h2, h3, h4');
        const txt = (h?.innerText || h?.textContent || '').trim();
        if (txt.length >= 3 && txt.length <= 140) return txt;
      }
      prev = prev.previousElementSibling;
    }
    hermano = hermano.parentElement;
  }

  return '';
}

function buscarPosterCercano(el) {
  if (!el) return '';
  if (el.poster && el.poster.startsWith('http')) return el.poster;
  const attrPoster = el.getAttribute('poster');
  if (attrPoster && attrPoster.startsWith('http')) return attrPoster;

  // Buscar imagen en el contenedor padre
  let actual = el;
  for (let i = 0; i < 5 && actual && actual !== document.body; i++) {
    actual = actual.parentElement;
    if (!actual) break;
    const img = actual.querySelector('img[src^="http"], img[data-src^="http"]');
    if (img) {
      const src = img.currentSrc || img.src || img.getAttribute('data-src');
      if (src && !src.includes('avatar') && !src.includes('logo') && !src.includes('icon')) {
        return src;
      }
    }
  }
  return '';
}

function buscarDuracionCercana(el) {
  if (!el) return '';
  if (el.duration && el.duration > 0) return formatearSegundos(el.duration);

  // Buscar texto con formato de tiempo "19:29" en el contenedor
  let actual = el;
  for (let i = 0; i < 4 && actual && actual !== document.body; i++) {
    actual = actual.parentElement;
    if (!actual) break;
    const match = (actual.innerText || '').match(/\b([0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?)\b/);
    if (match) return match[1];
  }
  return '';
}

function reportarVideo(url, el) {
  if (!url || !url.startsWith('http')) return;
  const titulo = buscarTituloCercano(el);
  const poster = buscarPosterCercano(el);
  const duracion = buscarDuracionCercana(el);

  chrome.runtime.sendMessage({
    tipo: 'VIDEO_DOM',
    url,
    titulo: titulo || undefined,
    poster: poster || undefined,
    duracion: duracion || undefined
  });
}

function extraerURLs(el) {
  const urls = new Set();
  if (el.src) urls.add(el.src);
  if (el.currentSrc) urls.add(el.currentSrc);

  const dataSrc = el.getAttribute('data-src') || el.getAttribute('data-hls') || el.getAttribute('data-video-url');
  if (dataSrc) urls.add(dataSrc);

  const srcset = el.getAttribute('srcset');
  if (srcset) {
    srcset.split(',').forEach(parte => {
      const u = parte.trim().split(/\s+/)[0];
      if (u) urls.add(u);
    });
  }
  return [...urls];
}

function escanearVideos() {
  document.querySelectorAll('video').forEach(video => {
    extraerURLs(video).forEach(u => reportarVideo(u, video));
    video.querySelectorAll('source').forEach(source => {
      extraerURLs(source).forEach(u => reportarVideo(u, video));
    });
  });
}

function solicitarVideosDeIframes() {
  document.querySelectorAll('iframe').forEach(iframe => {
    try {
      iframe.contentWindow?.postMessage({ tipo: 'NAVI_SCAN_REQUEST' }, '*');
    } catch {
      // ignore
    }
  });
}

// ─────────────────────────────────────────────
// TÍTULOS DE FRAME Y CONFIG DE VIMEO
// ─────────────────────────────────────────────

// Title of an embed iframe, used to name streams requested from inside it.
// Generic player titles are dropped so they never replace a page title.
function tituloDeFrame() {
  const t = (document.title || '').trim().replace(/\s+on Vimeo$/i, '');
  if (t.length < 3 || t.length > 140) return '';
  if (/^(video|player|vimeo|youtube|wistia|loom|iframe|embed|untitled)$/i.test(t)) return '';
  if (t.toLowerCase() === location.hostname.toLowerCase()) return '';
  return t;
}

// The Vimeo player inlines its config JSON in the embed page
// (window.playerConfig = {...}). Reading it here avoids a second request to
// the config endpoint, which rejects domain-restricted embeds.
function extraerConfigVimeo() {
  if (!/(^|\.)vimeo\.com$/i.test(location.hostname)) return null;
  for (const script of document.scripts) {
    const texto = script.textContent || '';
    if (!texto.includes('"files"') || !texto.includes('"video"')) continue;
    const m = /\b(?:playerConfig|config)\s*=\s*\{/.exec(texto);
    if (!m) continue;
    const inicio = m.index + m[0].length - 1;
    let fin = texto.lastIndexOf('}');
    for (let intento = 0; intento < 5 && fin > inicio; intento++) {
      try {
        return JSON.parse(texto.slice(inicio, fin + 1));
      } catch {
        fin = texto.lastIndexOf('}', fin - 1);
      }
    }
  }
  return null;
}

let vimeoReportado = false;
function reportarVimeo() {
  if (vimeoReportado) return;
  const cfg = extraerConfigVimeo();
  if (!cfg) return;

  const files = cfg.request?.files || {};
  const hls = files.hls;
  let url = hls?.cdns?.[hls?.default_cdn]?.url || Object.values(hls?.cdns || {})[0]?.url;
  let tipoStream = 'HLS';
  if (!url && Array.isArray(files.progressive) && files.progressive.length) {
    url = [...files.progressive].sort((a, b) => (b.width || 0) - (a.width || 0))[0]?.url;
    tipoStream = 'MP4';
  }
  if (!url || !/^https?:/.test(url)) return;

  const thumbs = cfg.video?.thumbs || {};
  const titulo = (cfg.video?.title || '').trim();
  vimeoReportado = true;
  chrome.runtime.sendMessage({
    tipo: 'VIDEO_DOM',
    url,
    tipoStream,
    plataforma: 'Vimeo',
    urlFija: true,
    titulo: titulo || undefined,
    poster: thumbs['640'] || thumbs.base || undefined,
    duracion: formatearSegundos(cfg.video?.duration) || undefined
  });
}

// Enviar título de página desde el frame principal; título del iframe en los demás
if (window === window.top) {
  chrome.runtime.sendMessage({
    tipo: 'TITULO_PAGINA',
    titulo: document.title || ''
  });
} else {
  const t = tituloDeFrame();
  if (t) chrome.runtime.sendMessage({ tipo: 'TITULO_FRAME', titulo: t });
}
reportarVimeo();
window.addEventListener('load', reportarVimeo);

// Escuchar cuando el usuario reproduce un video (captura instantánea y precisa)
document.addEventListener('play', (e) => {
  if (e.target && e.target.tagName === 'VIDEO') {
    const v = e.target;
    const url = v.currentSrc || v.src;
    if (url) reportarVideo(url, v);
  }
}, true);

document.addEventListener('loadedmetadata', (e) => {
  if (e.target && e.target.tagName === 'VIDEO') {
    const v = e.target;
    const url = v.currentSrc || v.src;
    if (url) reportarVideo(url, v);
  }
}, true);

window.addEventListener('message', (event) => {
  if (event.data?.tipo === 'NAVI_SCAN_REQUEST') {
    escanearVideos();
  }
  // Manifest HLS/DASH cazado por sniffer.js (MAIN world de este mismo frame):
  // players que bajan el manifest con URL sin extensión y Content-Type genérico.
  if (event.source === window && event.data?.tipo === 'DV_SNIFF' && event.data.url) {
    chrome.runtime.sendMessage({
      tipo: 'VIDEO_DOM',
      url: event.data.url,
      tipoStream: event.data.kind === 'DASH' ? 'DASH' : 'HLS'
    });
  }
});

// Escaneo inicial y observador de mutaciones
escanearVideos();
solicitarVideosDeIframes();

// Avisar a sniffer.js (MAIN world) que ya escuchamos: reenvía lo que cazó
// entre document_start y ahora.
window.postMessage({ tipo: 'DV_READY' }, '*');

const observador = new MutationObserver(() => {
  escanearVideos();
});
observador.observe(document.documentElement, { childList: true, subtree: true });
