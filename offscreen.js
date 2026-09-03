// offscreen.js — Offscreen Document para descargas de archivos ensamblados
//
// Propósito: Los service workers (MV3) no pueden crear blob URLs descargables
// directamente. Este documento invisible vive en el contexto de la extensión
// (donde blob URLs y clicks en <a> funcionan normalmente) y se encarga de
// materializar la descarga cuando recibe el buffer ensamblado.

// Usar BroadcastChannel para recibir ArrayBuffers grandes sin límite de 64MB
const canal = new BroadcastChannel('navi-downloads');

canal.onmessage = (event) => {
  if (event.data?.type !== 'TRIGGER_DOWNLOAD') return;

  const { buffer, filename, mimeType } = event.data;

  // Crear Blob desde el ArrayBuffer recibido
  const blob = new Blob([buffer], { type: mimeType });
  const blobUrl = URL.createObjectURL(blob);

  // Disparar la descarga mediante un click sintético en un <a>
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  // Liberar la memoria del blob URL tras 5 segundos
  setTimeout(() => URL.revokeObjectURL(blobUrl), 5_000);
};
