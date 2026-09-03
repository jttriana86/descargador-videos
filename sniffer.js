// sniffer.js — Corre en el MAIN world de cada página y frame (document_start).
// Última red de detección: hay players (GoHighLevel/ClientClub, Skool, muchos
// LMS) que bajan el manifest HLS/DASH por fetch/XHR con una URL sin extensión
// y un Content-Type genérico (octet-stream, text/plain, json). Ni la URL ni los
// headers delatan que es un video — pero el CUERPO sí: un HLS empieza con
// #EXTM3U y un DASH contiene <MPD. Aquí envolvemos fetch y XMLHttpRequest,
// miramos el cuerpo de las respuestas pequeñas y reportamos los manifests al
// content script vía postMessage (el MAIN world no tiene chrome.runtime).
//
// Reglas para no romper ni ralentizar la página:
//  - Nunca tocar la respuesta original (fetch se clona; XHR se lee al terminar).
//  - Solo cuerpos pequeños (los manifests pesan KB; tope 3 MB).
//  - Una sola vez por URL.
//  - Todo dentro de try/catch: si algo falla, la página sigue como si no existiéramos.

(() => {
  'use strict';
  if (window.__dvSnifferInstalado) return;
  window.__dvSnifferInstalado = true;

  const MAX_BYTES = 3 * 1024 * 1024;
  const vistas = new Set();

  // El content script arranca en document_idle, mucho después que nosotros:
  // lo encontrado antes de su 'DV_READY' se guarda y se reenvía entonces.
  const hallazgos = [];

  function reportar(url, kind) {
    try {
      if (!url || vistas.has(url)) return;
      vistas.add(url);
      const msg = { tipo: 'DV_SNIFF', url: String(url), kind };
      hallazgos.push(msg);
      window.postMessage(msg, '*');
    } catch { /* nunca romper la página */ }
  }

  window.addEventListener('message', (event) => {
    try {
      if (event.source !== window || event.data?.tipo !== 'DV_READY') return;
      for (const msg of hallazgos) window.postMessage(msg, '*');
    } catch { /* seguir */ }
  });

  function absoluta(url) {
    try { return new URL(url, location.href).href; } catch { return null; }
  }

  // URLs de manifest incrustadas en un JSON de configuración del player.
  function escanearJSON(texto) {
    const plano = texto.replace(/\\\//g, '/'); // JSON escapa las barras: "https:\/\/cdn..."
    let m, n = 0;
    const abs = /https?:\/\/[^"'\s]+?\.(m3u8|mpd)(\?[^"'\s]*)?/gi;
    while ((m = abs.exec(plano)) && n < 5) {
      reportar(m[0], m[1].toLowerCase() === 'mpd' ? 'DASH' : 'HLS');
      n++;
    }
    // rutas relativas explícitas ("url":"/stream/master.m3u8")
    const rel = /["']([^"':\s]{1,300}?\.(m3u8|mpd)(\?[^"'\s]*)?)["']/gi;
    n = 0;
    while ((m = rel.exec(plano)) && n < 5) {
      const url = absoluta(m[1]);
      if (url) reportar(url, m[2].toLowerCase() === 'mpd' ? 'DASH' : 'HLS');
      n++;
    }
  }

  function clasificarCuerpo(texto, url) {
    const inicio = texto.slice(0, 500).trimStart();
    if (inicio.startsWith('#EXTM3U')) {
      reportar(url, 'HLS');
      return;
    }
    if (inicio.includes('<MPD') || (inicio.startsWith('<?xml') && texto.includes('<MPD'))) {
      reportar(url, 'DASH');
      return;
    }
    if (inicio.startsWith('{') || inicio.startsWith('[')) escanearJSON(texto, url);
  }

  function interesa(contentType, contentLength, url) {
    if (contentLength !== null && contentLength > MAX_BYTES) return false;
    const ct = (contentType || '').toLowerCase();
    // binarios claramente no-manifest
    if (/^(image|font|video\/mp2t)\//.test(ct) || ct.includes('wasm') || ct.includes('protobuf')) return false;
    if (url && vistas.has(url)) return false;
    return true;
  }

  // ── fetch ────────────────────────────────────────────────────────────────
  const fetchOriginal = window.fetch;
  if (typeof fetchOriginal === 'function') {
    window.fetch = function (...args) {
      const promesa = fetchOriginal.apply(this, args);
      try {
        promesa.then(resp => {
          try {
            if (!resp || !resp.ok || resp.type === 'opaque') return;
            const len = resp.headers.get('content-length');
            const url = resp.url || absoluta(typeof args[0] === 'string' ? args[0] : args[0]?.url);
            if (!interesa(resp.headers.get('content-type'), len ? +len : null, url)) return;
            resp.clone().text().then(texto => {
              if (texto && texto.length <= MAX_BYTES) clasificarCuerpo(texto, url);
            }).catch(() => {});
          } catch { /* seguir */ }
        }).catch(() => {});
      } catch { /* seguir */ }
      return promesa;
    };
  }

  // ── XMLHttpRequest ───────────────────────────────────────────────────────
  const openOriginal = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    try { this.__dvUrl = absoluta(url); } catch { /* seguir */ }
    return openOriginal.call(this, method, url, ...rest);
  };

  const sendOriginal = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    try {
      this.addEventListener('load', () => {
        try {
          if (this.status < 200 || this.status >= 300) return;
          if (this.responseType && this.responseType !== 'text') return; // no leible como texto
          const texto = this.responseText;
          if (!texto || texto.length > MAX_BYTES) return;
          if (!interesa(this.getResponseHeader('content-type'), texto.length, this.__dvUrl)) return;
          clasificarCuerpo(texto, this.__dvUrl || this.responseURL);
        } catch { /* seguir */ }
      });
    } catch { /* seguir */ }
    return sendOriginal.apply(this, args);
  };
})();
