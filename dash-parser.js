// dash-parser.js — Parser MPEG-DASH (MPD) para la extensión
// Corre como importScript en el service worker (MV3).
// Depende de funciones del scope compartido: _buildFetchHeaders, _limpiarNombre
// (definidas en downloader-engine.js, cargado antes que este archivo).

// ─────────────────────────────────────────────
// PARSER DE MPD
// ─────────────────────────────────────────────

/**
 * Parsea un archivo MPD y devuelve la lista ordenada de segmentos del stream
 * de video con mayor resolución (o bandwidth).
 *
 * Soporta: SegmentList, SegmentTemplate con SegmentTimeline, SegmentTemplate con $Number$.
 *
 * @param {string} mpdUrl         URL del archivo .mpd
 * @param {Object} authHeaders    Headers de autenticación { Authorization?, Cookie?, ... }
 * @param {AbortSignal} signal
 * @returns {Promise<Array<{url: string, duration: number, isInit?: boolean}>>}
 */
async function parseMPD(mpdUrl, authHeaders, signal) {
  const resp = await fetch(mpdUrl, {
    headers: authHeaders,
    credentials: 'include',
    signal
  });

  if (!resp.ok) {
    throw new Error(`No se pudo acceder al manifiesto DASH (HTTP ${resp.status})`);
  }

  const xmlText = await resp.text();
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');

  if (doc.querySelector('parsererror')) {
    throw new Error('Error al parsear el MPD: XML inválido');
  }

  const baseUrl = mpdUrl.substring(0, mpdUrl.lastIndexOf('/') + 1);

  // ── Seleccionar AdaptationSet de video ───────
  const allAdapt = Array.from(doc.querySelectorAll('AdaptationSet'));

  const videoSets = allAdapt.filter(as => {
    const ct   = (as.getAttribute('contentType') || '').toLowerCase();
    const mime = (as.getAttribute('mimeType')    || '').toLowerCase();
    return ct === 'video' || mime.startsWith('video/');
  });

  // Si no hay atributos explícitos de tipo, usar todos (filtraremos por width/bandwidth)
  const candidates = videoSets.length > 0 ? videoSets : allAdapt;

  // ── Elegir Representation con mayor width × bandwidth ──
  let bestRep   = null;
  let bestAdapt = null;
  let bestScore = -1;

  for (const adapt of candidates) {
    for (const rep of adapt.querySelectorAll('Representation')) {
      const bandwidth = parseInt(rep.getAttribute('bandwidth') || '0', 10);
      const width     = parseInt(rep.getAttribute('width')     || '0', 10);
      const score = width > 0 ? width * 10000 + bandwidth : bandwidth;
      if (score > bestScore) {
        bestScore = score;
        bestRep   = rep;
        bestAdapt = adapt;
      }
    }
  }

  if (!bestRep || !bestAdapt) {
    throw new Error('No se encontró ninguna representación de video en el MPD');
  }

  const resolvedBase = _resolveBase(doc, bestAdapt, bestRep, baseUrl);
  return _extractSegments(bestAdapt, bestRep, resolvedBase);
}

// ─────────────────────────────────────────────
// HELPERS INTERNOS DEL PARSER
// ─────────────────────────────────────────────

/** Resuelve la BaseURL efectiva: Representation > AdaptationSet > Period > MPD. */
function _resolveBase(doc, adaptSet, rep, fallbackBase) {
  const sources = [rep, adaptSet, adaptSet.parentElement, doc.documentElement];
  for (const el of sources) {
    if (!el) continue;
    const buEl = Array.from(el.children).find(c => c.tagName === 'BaseURL');
    if (buEl) {
      const bu = buEl.textContent.trim();
      return bu.startsWith('http') ? bu : fallbackBase + bu;
    }
  }
  return fallbackBase;
}

/** Extrae segmentos eligiendo entre SegmentList, SegmentTemplate o URL única. */
function _extractSegments(adaptSet, rep, baseUrl) {
  const segList = rep.querySelector('SegmentList') || adaptSet.querySelector('SegmentList');
  if (segList) return _fromSegmentList(segList, baseUrl);

  const segTpl = rep.querySelector('SegmentTemplate') || adaptSet.querySelector('SegmentTemplate');
  if (segTpl) return _fromSegmentTemplate(segTpl, rep, baseUrl);

  // Fallback: el stream es un único archivo (BaseURL)
  return [{ url: baseUrl, duration: 0 }];
}

function _fromSegmentList(segList, baseUrl) {
  const timescale  = parseInt(segList.getAttribute('timescale') || '1', 10);
  const duration   = parseInt(segList.getAttribute('duration')  || '0', 10);
  const segDur     = duration > 0 ? duration / timescale : 0;
  const segments   = [];

  const init = segList.querySelector('Initialization');
  if (init) {
    const src = init.getAttribute('sourceURL') || '';
    if (src) segments.push({ url: src.startsWith('http') ? src : baseUrl + src, duration: 0, isInit: true });
  }

  for (const su of segList.querySelectorAll('SegmentURL')) {
    const media = su.getAttribute('media') || '';
    if (!media) continue;
    segments.push({ url: media.startsWith('http') ? media : baseUrl + media, duration: segDur });
  }

  return segments;
}

function _fromSegmentTemplate(segTpl, rep, baseUrl) {
  const timescale     = parseInt(segTpl.getAttribute('timescale')    || '1', 10);
  const startNumber   = parseInt(segTpl.getAttribute('startNumber')  || '1', 10);
  const mediaTemplate = segTpl.getAttribute('media')                 || '';
  const initTemplate  = segTpl.getAttribute('initialization')        || '';
  const repId         = rep.getAttribute('id')                       || '';
  const bandwidth     = rep.getAttribute('bandwidth')                || '';
  const segments      = [];

  // Segmento de inicialización
  if (initTemplate) {
    const initUrl = _applyTemplate(initTemplate, repId, bandwidth, 0, 0, baseUrl);
    segments.push({ url: initUrl, duration: 0, isInit: true });
  }

  // SegmentTimeline (lista explícita de segmentos con tiempos)
  const timeline = segTpl.querySelector('SegmentTimeline');
  if (timeline) {
    let number = startNumber;
    let t = 0;
    for (const s of timeline.querySelectorAll('S')) {
      const sT = s.getAttribute('t');
      if (sT !== null) t = parseInt(sT, 10);
      const d = parseInt(s.getAttribute('d') || '0', 10);
      const r = parseInt(s.getAttribute('r') || '0', 10); // repeticiones adicionales

      for (let i = 0; i <= r; i++) {
        if (mediaTemplate) {
          segments.push({
            url: _applyTemplate(mediaTemplate, repId, bandwidth, number, t, baseUrl),
            duration: d / timescale
          });
        }
        t += d;
        number++;
      }
    }
    return segments;
  }

  // $Number$ sin timeline: calcular desde la duración total del Period/MPD
  const segDuration = parseInt(segTpl.getAttribute('duration') || '0', 10);
  if (segDuration > 0) {
    const period       = rep.closest('Period') || rep.parentElement?.parentElement;
    const totalSeconds = _getPeriodDuration(period);
    const totalSegs    = totalSeconds > 0 ? Math.ceil(totalSeconds * timescale / segDuration) : 0;

    for (let n = 0; n < totalSegs; n++) {
      segments.push({
        url: _applyTemplate(mediaTemplate, repId, bandwidth, startNumber + n, n * segDuration, baseUrl),
        duration: segDuration / timescale
      });
    }
  }

  return segments;
}

/**
 * Sustituye variables DASH en un template de URL:
 * $RepresentationID$, $Bandwidth$, $Number[%0Nd]$, $Time[%0Nd]$
 */
function _applyTemplate(template, repId, bandwidth, number, time, baseUrl) {
  const url = template
    .replace('$RepresentationID$', repId)
    .replace('$Bandwidth$',        bandwidth)
    .replace(/\$Number(?:%0(\d+)d)?\$/, (_, pad) =>
      pad ? String(number).padStart(parseInt(pad, 10), '0') : String(number)
    )
    .replace(/\$Time(?:%0(\d+)d)?\$/, (_, pad) =>
      pad ? String(time).padStart(parseInt(pad, 10), '0') : String(time)
    );
  return url.startsWith('http') ? url : baseUrl + url;
}

/** Duración en segundos del Period. Cae hacia mediaPresentationDuration del MPD si hace falta. */
function _getPeriodDuration(period) {
  if (!period) return 0;
  const dur = period.getAttribute('duration');
  if (dur) return _parseISODuration(dur);
  const mpdDur = period.ownerDocument?.documentElement?.getAttribute('mediaPresentationDuration');
  return mpdDur ? _parseISODuration(mpdDur) : 0;
}

/** Convierte ISO 8601 duration (PT1H2M3.4S) → segundos. */
function _parseISODuration(str) {
  const m = str.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?/);
  if (!m) return 0;
  return (parseInt(m[1] || 0, 10) * 3600)
       + (parseInt(m[2] || 0, 10) * 60)
       + parseFloat(m[3] || 0);
}

// ─────────────────────────────────────────────
// DESCARGA DASH
// ─────────────────────────────────────────────

/**
 * Descarga un stream DASH completo: parsea el MPD, descarga cada segmento
 * en orden, los concatena en un único ArrayBuffer y dispara
 * chrome.downloads.download con un blob URL.
 *
 * @param {string}   taskId
 * @param {{ url: string, tipo: string, nombre: string }} videoObj
 * @param {Object}   authHeaders    Headers del dominio del MPD
 * @param {AbortSignal} signal
 * @param {function(number): void} onProgress  Recibe porcentaje 0-100
 */
async function downloadDASH(taskId, videoObj, authHeaders, signal, onProgress) {
  onProgress(2);

  // Paso 1: parsear el MPD y obtener lista de segmentos
  const segmentos = await parseMPD(videoObj.url, authHeaders, signal);

  if (!segmentos || segmentos.length === 0) {
    throw new Error('No se encontraron segmentos en el manifiesto DASH.');
  }

  // Separar init segments (van primero) y media segments (cuentan para el progreso)
  const initSegs  = segmentos.filter(s =>  s.isInit);
  const mediaSegs = segmentos.filter(s => !s.isInit);
  const allSegs   = [...initSegs, ...mediaSegs];

  // Paso 2: descargar segmentos en orden con sus propios auth headers
  const buffers = [];

  for (let i = 0; i < allSegs.length; i++) {
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');

    const seg        = allSegs[i];
    const segHeaders = await _buildFetchHeaders(seg.url);

    const resp = await fetch(seg.url, {
      headers: segHeaders,
      credentials: 'include',
      signal
    });

    if (!resp.ok) {
      throw new Error(`Segmento DASH ${i + 1}/${allSegs.length} falló: HTTP ${resp.status}`);
    }

    buffers.push(await resp.arrayBuffer());

    // Progreso 5 % → 95 % solo durante media segments
    if (!seg.isInit) {
      const mediaIdx = i - initSegs.length;
      const pct = Math.round(5 + ((mediaIdx + 1) / mediaSegs.length) * 90);
      onProgress(Math.min(pct, 95));
    }
  }

  // Paso 3: concatenar todos los buffers
  onProgress(96);
  const totalBytes = buffers.reduce((sum, b) => sum + b.byteLength, 0);
  const unido      = new Uint8Array(totalBytes);
  let offset       = 0;
  for (const buffer of buffers) {
    unido.set(new Uint8Array(buffer), offset);
    offset += buffer.byteLength;
  }

  // Paso 4: crear blob y disparar descarga
  onProgress(97);
  const blob    = new Blob([unido], { type: 'video/mp4' });
  const blobUrl = URL.createObjectURL(blob);
  const filename = `${_limpiarNombre(videoObj.nombre)}.mp4`;

  await chrome.downloads.download({ url: blobUrl, filename, saveAs: false });

  // Liberar memoria tras 60 segundos
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
}
