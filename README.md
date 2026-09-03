# Descargador de Videos — yaweb.co

¿Te gusta? Invítame un café: [☕ PayPal](https://www.paypal.com/paypalme/jttriana86?locale.x=es_XC&country.x=CO)

Extensión para Chrome, Edge y Opera que detecta y descarga cualquier video que se reproduzca en tu navegador. Sin límites, sin cuentas, sin suscripciones.

---

## Qué puede descargar

- Videos MP4, WEBM, MOV directos
- Streams HLS (.m3u8) — cursos de Udemy, Teachable, Hotmart, Kajabi y similares
- Streams DASH (.mpd)
- Cualquier video que el navegador pueda reproducir

> YouTube no es compatible por sus restricciones técnicas y de términos de servicio.

---

## Instalación

> La extensión no está en la Chrome Web Store. Se instala en modo desarrollador en segundos.

### Chrome
1. Descarga o clona este repositorio
2. Abre Chrome y ve a `chrome://extensions`
3. Activa **"Modo desarrollador"** (toggle arriba a la derecha)
4. Haz clic en **"Cargar extensión descomprimida"**
5. Selecciona la carpeta del proyecto
6. Listo — el ícono aparece en tu barra de extensiones

### Microsoft Edge
1. Ve a `edge://extensions`
2. Activa **"Modo de desarrollador"**
3. Clic en **"Cargar desempaquetada"** → selecciona la carpeta

### Opera
1. Ve a `opera://extensions`
2. Activa **"Modo de desarrollador"**
3. Clic en **"Cargar extensión descomprimida"** → selecciona la carpeta

---

## Cómo usar

1. Abre la página del video que quieres descargar
2. **Reproduce el video** (aunque sea unos segundos)
3. Haz clic en el ícono de la extensión en tu barra
4. Verás los videos detectados con un botón **"Descargar"** en cada uno
5. Haz clic en descargar — el archivo se guarda en tu carpeta de Descargas

### Cola de descargas
Si haces clic en varios videos a la vez, se agregan a una cola automática y se descargan uno por uno.

### Formato del archivo
- Los videos directos (MP4, WEBM) se guardan en su formato original
- Los streams HLS se guardan como `.mp4`

---

## Estructura del proyecto

```
video-downloader/
├── manifest.json      — Configuración de la extensión (permisos, versión)
├── background.js      — Service worker: intercepta requests de red en segundo plano
├── content.js         — Se inyecta en cada página y detecta elementos <video>
├── popup.html         — Interfaz del popup
├── popup.css          — Estilos
├── popup.js           — Lógica del popup y motor de descargas
└── icons/             — Íconos de la extensión
```

---

## Hecho con ❤️ por [yaweb.co](https://yaweb.co)
