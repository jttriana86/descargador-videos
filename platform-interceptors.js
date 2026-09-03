// platform-interceptors.js — Interceptores específicos por plataforma
// Detecta y extrae URLs reales de video en plataformas privadas con autenticación.
//
// Cargado desde background.js con: importScripts('platform-interceptors.js')
// Expone el global: PLATFORM_INTERCEPTORS  (Array)
//
// Formato de cada interceptor:
//   {
//     nombre:      string   — identificador legible
//     urlPattern:  RegExp   — se testea contra details.url en onHeadersReceived
//     extractVideoInfo(details): Promise<VideoInfo|null>
//   }
//
// VideoInfo: { url, tipo, nombre, plataforma, extraHeaders }
//   url          — URL real del stream (m3u8, mpd, mp4)
//   tipo         — 'HLS' | 'DASH' | 'MP4'
//   nombre       — nombre legible del video
//   plataforma   — nombre de la plataforma origen
//   extraHeaders — { headerName: value } para adjuntar a la descarga
//
// ─────────────────────────────────────────────
// INTEGRACIÓN EN background.js (agregar al final del archivo):
//
//   importScripts('platform-interceptors.js');
//
//   chrome.webRequest.onHeadersReceived.addListener(
//     (details) => {
//       for (const interceptor of PLATFORM_INTERCEPTORS) {
//         if (interceptor.urlPattern.test(details.url)) {
//           interceptor.extractVideoInfo(details)
//             .then(info => {
//               if (!info || details.tabId < 0) return;
//               getHeaders(new URL(info.url).hostname)
//                 .then(records => {
//                   const authSaved = Object.assign({}, ...records.map(r => r.headers));
//                   const headersFinales = { ...authSaved, ...info.extraHeaders };
//                   agregarVideoPlataforma(details.tabId, info, headersFinales);
//                 })
//                 .catch(() => {});
//             })
//             .catch(() => {});
//           break; // Solo un interceptor por request
//         }
//       }
//     },
//     {
//       urls: [
//         '*://*.hotmart.com/*',
//         '*://*.wistia.com/*',
//         '*://fast.wistia.net/*',
//         '*://player.vimeo.com/*',
//         '*://*.spool.video/*'
//       ]
//     },
//     ['responseHeaders']
//   );
//
// También agregar en background.js la función agregarVideoPlataforma:
//
//   async function agregarVideoPlataforma(tabId, info, headers) {
//     if (tabId < 0) return;
//     if (!info.url.startsWith('http')) return;
//     const { videos, titulo } = await getVideos(tabId);
//     const urlNorm = normalizarURL(info.url);
//     if (videos.some(v => normalizarURL(v.url) === urlNorm)) return;
//     videos.push({
//       url: info.url,
//       tipo: info.tipo,
//       nombre: info.nombre,
//       plataforma: info.plataforma,
//       headers,
//       timestamp: Date.now()
//     });
//     await saveVideos(tabId, videos, titulo);
//     chrome.action.setBadgeText({ text: String(videos.length), tabId });
//     chrome.action.setBadgeBackgroundColor({ color: '#e94560', tabId });
//   }
// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
// HELPERS INTERNOS
// ─────────────────────────────────────────────

/**
 * Hace fetch de una URL pasando las cookies de sesión del navegador.
 * Funciona porque el service worker tiene host_permissions: <all_urls>.
 */
async function _fetchJSON(url, extraHeaders = {}) {
  const resp = await fetch(url, {
    credentials: 'include',
    headers: {
      'Accept': 'application/json, */*;q=0.9',
      ...extraHeaders
    }
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} al obtener ${url}`);
  return resp.json();
}

/**
 * Lee un header de respuesta por nombre (case-insensitive).
 * @param {object} details — objeto de onHeadersReceived
 * @param {string} name
 * @returns {string|null}
 */
function _getResponseHeader(details, name) {
  const lower = name.toLowerCase();
  return details.responseHeaders?.find(h => h.name.toLowerCase() === lower)?.value ?? null;
}

// ─────────────────────────────────────────────
// INTERCEPTOR 1 — HOTMART
//
// Hotmart embebe videos con Cloudflare Stream a través de:
//   - cf-embed.hotmart.com  (reproductor embebido en páginas de terceros)
//   - player.hotmart.com    (reproductor propio en la plataforma)
//
// El endpoint de configuración del player responde JSON con la URL del stream.
// El token de acceso viaja como query param (token= o hdnts=).
// ─────────────────────────────────────────────
const interceptorHotmart = {
  nombre: 'Hotmart',
  urlPattern: /https?:\/\/(cf-embed|player)\.hotmart\.com\//,

  async extractVideoInfo(details) {
    try {
      const parsedUrl = new URL(details.url);

      // Solo procesar endpoints de configuración del player, no recursos estáticos
      const esConfigEndpoint = /\/(video|embed\/video|player|config|media)/.test(parsedUrl.pathname)
                            || parsedUrl.pathname.endsWith('.json');
      if (!esConfigEndpoint) return null;

      // El token de acceso puede venir en varios parámetros
      const token = parsedUrl.searchParams.get('token')
                 || parsedUrl.searchParams.get('hdnts')
                 || parsedUrl.searchParams.get('t')
                 || '';

      const json = await _fetchJSON(details.url, {
        'Referer': 'https://hotmart.com/'
      });

      // Hotmart puede devolver el stream en distintas estructuras según la versión del player
      const streamUrl = json?.mediaAssets?.[0]?.src
                     || json?.dash?.url
                     || json?.hls?.url
                     || json?.video?.url
                     || json?.src
                     || json?.url;

      if (!streamUrl || !streamUrl.startsWith('http')) return null;

      const urlLower = streamUrl.toLowerCase();
      const tipo = urlLower.includes('.m3u8') ? 'HLS'
                 : urlLower.includes('.mpd')  ? 'DASH'
                 : 'MP4';

      const extraHeaders = { 'Referer': 'https://player.hotmart.com/' };
      if (token) extraHeaders['X-Hotmart-Token'] = token;

      return {
        url: streamUrl,
        tipo,
        nombre: json?.title || json?.name || 'hotmart-video',
        plataforma: 'Hotmart',
        extraHeaders
      };
    } catch {
      return null;
    }
  }
};

// ─────────────────────────────────────────────
// INTERCEPTOR 2 — WISTIA (Teachable / Kajabi / Thinkific)
//
// Wistia es el CDN de video más usado en plataformas de cursos privados.
// Expone un endpoint JSON público (pero protegido por token en el hash):
//   fast.wistia.net/embed/medias/{hash}.json
//
// Este JSON contiene todos los assets: HLS, MP4 a distintas calidades, etc.
// ─────────────────────────────────────────────
const interceptorWistia = {
  nombre: 'Wistia',
  urlPattern: /https?:\/\/(fast\.wistia\.net|wistia\.com)\/embed\/medias\/[a-z0-9]+\.json/,

  async extractVideoInfo(details) {
    try {
      const json = await _fetchJSON(details.url, {
        'Referer': details.initiator || 'https://fast.wistia.net/'
      });

      // Estructura Wistia: { media: { name, assets: [{ type, url, width, height }] } }
      const assets = json?.media?.assets ?? [];

      // Prioridad: HLS > MP4 original de mayor resolución
      const hlsAsset = assets.find(a =>
        a.type === 'hls_video' || (a.url && a.url.toLowerCase().includes('.m3u8'))
      );

      const mp4Assets = assets
        .filter(a => a.type === 'original' || a.type === 'mp4_video')
        .sort((a, b) => (b.width || 0) - (a.width || 0));

      const asset = hlsAsset || mp4Assets[0];
      if (!asset?.url) return null;

      const urlLower = asset.url.toLowerCase();
      const tipo = urlLower.includes('.m3u8') ? 'HLS' : 'MP4';
      const nombre = json?.media?.name || 'wistia-video';

      return {
        url: asset.url,
        tipo,
        nombre,
        plataforma: 'Wistia',
        extraHeaders: {
          'Referer': 'https://fast.wistia.net/',
          'Origin': 'https://fast.wistia.net'
        }
      };
    } catch {
      return null;
    }
  }
};

// ─────────────────────────────────────────────
// INTERCEPTOR 3 — VIMEO EMBEDS
//
// El endpoint player.vimeo.com/video/{id}/config responde JSON con:
//   request.files.hls.cdns.{cdn}.url  — URL HLS con token de acceso
//   request.files.progressive[n].url  — MP4 fallback
//   video.title                        — título del video
//
// Este endpoint requiere las cookies de sesión de Vimeo para videos privados,
// por eso usamos fetch con credentials: 'include'.
// ─────────────────────────────────────────────
const interceptorVimeo = {
  nombre: 'Vimeo',
  urlPattern: /https?:\/\/player\.vimeo\.com\/video\/\d+\/config/,

  async extractVideoInfo(details) {
    try {
      // Preservar query params del config (contienen el token de acceso privado)
      const json = await _fetchJSON(details.url, {
        'Referer': details.initiator || 'https://vimeo.com/'
      });

      // ── Intentar HLS primero ──
      const hls = json?.request?.files?.hls;
      if (hls) {
        const cdn = hls.default_cdn;
        const hlsUrl = hls.cdns?.[cdn]?.url
                    ?? Object.values(hls.cdns ?? {})[0]?.url;

        if (hlsUrl) {
          return {
            url: hlsUrl,
            tipo: 'HLS',
            nombre: json?.video?.title || 'vimeo-video',
            plataforma: 'Vimeo',
            extraHeaders: {
              'Referer': 'https://player.vimeo.com/',
              'Origin': 'https://player.vimeo.com'
            }
          };
        }
      }

      // ── Fallback: MP4 progresivo de mayor resolución ──
      const progressive = json?.request?.files?.progressive ?? [];
      if (progressive.length) {
        const mejor = [...progressive].sort((a, b) => (b.width || 0) - (a.width || 0))[0];
        return {
          url: mejor.url,
          tipo: 'MP4',
          nombre: json?.video?.title || 'vimeo-video',
          plataforma: 'Vimeo',
          extraHeaders: {
            'Referer': 'https://player.vimeo.com/'
          }
        };
      }

      return null;
    } catch {
      return null;
    }
  }
};

// ─────────────────────────────────────────────
// INTERCEPTOR 4 — SPOOL
//
// Spool es una plataforma de video para creadores de cursos. Sirve HLS/DASH
// desde su CDN con tokens de autenticación en los query params.
// Patrones de URL: *.spool.video/*.m3u8?token=...&Policy=...
//
// A diferencia de Wistia/Vimeo, aquí no necesitamos parsear JSON:
// la URL interceptada ES el manifest. Solo capturamos y enriquecemos.
// ─────────────────────────────────────────────
const interceptorSpool = {
  nombre: 'Spool',
  urlPattern: /https?:\/\/([^/]*\.)?spool\.video\//,

  async extractVideoInfo(details) {
    try {
      const parsedUrl = new URL(details.url);
      const pathname  = parsedUrl.pathname.toLowerCase();

      // Solo manifests, no segmentos de video
      const esManifest = pathname.endsWith('.m3u8') || pathname.endsWith('.mpd');
      if (!esManifest) return null;

      // Verificar que hay tokens de autenticación (evita capturar manifests públicos)
      const AUTH_PARAMS = ['token', 'auth', 'hdnts', 'Policy', 'Signature', 'Key-Pair-Id', 't'];
      const tieneAuth = AUTH_PARAMS.some(p => parsedUrl.searchParams.has(p));
      if (!tieneAuth) return null;

      const tipo = pathname.endsWith('.mpd') ? 'DASH' : 'HLS';

      // Nombre a partir del path (ej: /videos/abc123/master.m3u8 → abc123)
      const segmentos = pathname.split('/').filter(Boolean);
      const nombre = segmentos.length >= 2
        ? segmentos[segmentos.length - 2]   // carpeta padre suele ser el ID del video
        : segmentos.pop()?.replace(/\.[^.]+$/, '') || 'spool-video';

      return {
        url: details.url,   // URL completa con tokens en query params
        tipo,
        nombre,
        plataforma: 'Spool',
        extraHeaders: {
          'Referer': details.initiator || 'https://app.spool.video/',
          // El query string con los tokens se preserva en la URL, no hace
          // falta duplicarlo en headers — el downloader usará la URL tal cual
        }
      };
    } catch {
      return null;
    }
  }
};

// ─────────────────────────────────────────────
// EXPORT GLOBAL — Array de interceptores para background.js
// ─────────────────────────────────────────────
const PLATFORM_INTERCEPTORS = [
  interceptorHotmart,
  interceptorWistia,
  interceptorVimeo,
  interceptorSpool
];

// Exponer en globalThis para que background.js lo consuma vía importScripts()
// En service workers MV3, las constantes de scripts importados no se
// propagan automáticamente — hay que asignarlas explícitamente a self/globalThis.
globalThis.PLATFORM_INTERCEPTORS = PLATFORM_INTERCEPTORS;
