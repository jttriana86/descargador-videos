# Descargador de Videos — yaweb.co

¿Te gusta? Invítame un café: [☕ PayPal](https://www.paypal.com/paypalme/jttriana86?locale.x=es_XC&country.x=CO)

Extensión para Chrome, Edge, Brave, Opera y Arc que detecta y descarga cualquier video que se reproduzca en tu navegador. Sin límites, sin cuentas, sin suscripciones.

---

## 🚀 Qué puede descargar

- Videos MP4, WEBM, MOV directos
- Streams HLS (.m3u8) — cursos de Udemy, Teachable, Hotmart, Kajabi, conferencias y similares
- Streams DASH (.mpd)
- Detección automática con miniaturas, duración y títulos reales de sesiones
- Edición rápida de nombres de archivo antes de descargar
- Descarga individual o en lote

---

## 💻 Requisitos previos (en un computador nuevo)

Para que la extensión descargue streams HLS/DASH y cursos protegidos con la mejor calidad, requiere el **Companion App** local nativo.

### 🪟 En Windows:
1. **Python (versión 3.8 o superior):**
   - Descárgalo desde [python.org/downloads](https://www.python.org/downloads/).
   - ⚠️ **Importante al instalar:** Marca la casilla **`Add python.exe to PATH`** en la pantalla inicial del instalador.
2. **FFmpeg:**
   - Abre PowerShell y escribe:
     ```powershell
     winget install Gyan.FFmpeg
     ```

### 🍎 En Mac (macOS):
1. Si tienes [Homebrew](https://brew.sh), abre la Terminal y ejecuta en un solo paso:
   ```bash
   brew install python ffmpeg
   ```
2. *(Opcional)* Si no usas Homebrew:
   - Descarga el instalador de Python desde [python.org/downloads/macos](https://www.python.org/downloads/macos/).
   - Instala FFmpeg mediante Homebrew o descarga el binario estático desde [osxexperts.net](https://www.osxexperts.net/) / [evermeet.cx/ffmpeg/](https://evermeet.cx/ffmpeg/).

---

## 📦 Instalación paso a paso

### Paso 1: Instalar la extensión en el navegador
1. Descarga o clona este repositorio:
   ```bash
   git clone https://github.com/jttriana86/descargador-videos.git
   ```
2. Abre tu navegador (Chrome, Edge, Brave, Opera, Arc) y ve a:
   - **Chrome / Brave / Arc:** `chrome://extensions`
   - **Edge:** `edge://extensions`
   - **Opera:** `opera://extensions`
3. Activa el interruptor **"Modo desarrollador"** (arriba a la derecha).
4. Haz clic en **"Cargar extensión descomprimida"** (o *"Cargar desempaquetada"*).
5. Selecciona la carpeta del proyecto.
6. ¡Listo! El ícono aparecerá en tu barra de extensiones.

---

### Paso 2: Activar el Companion

#### 🪟 En Windows:
1. Abre la carpeta `companion/`.
2. Doble clic en **`instalar.bat`** (instala `yt-dlp` automáticamente).
3. Doble clic en **`iniciar-silencioso.vbs`** (inicia el servidor en segundo plano sin consolas).
4. *(Para detenerlo cuando quieras: doble clic en `detener.bat`)*.

#### 🍎 En Mac (macOS):
1. Abre la **Terminal** y entra a la carpeta `companion` del proyecto:
   ```bash
   cd ruta/a/descargador-videos/companion
   ```
2. Da permisos de ejecución e instala dependencias (solo la primera vez):
   ```bash
   chmod +x *.sh
   ./instalar.sh
   ```
3. Inicia el servidor en segundo plano:
   ```bash
   ./iniciar.sh
   ```
   *(Para detenerlo cuando quieras: `./detener.sh`)*.

Al abrir el popup de la extensión verás el punto en verde: **`Companion activo · v2.0.0`**.

---

## 🎯 Cómo usar la extensión

1. Abre la página donde esté el video o las sesiones que deseas bajar.
2. **Reproduce el video** (unos pocos segundos son suficientes para que el detector capture el stream).
3. Haz clic en el ícono de la extensión en tu barra de navegación.
4. Verás la lista de videos detectados con su **portada**, **título real** y **duración**.
5. Puedes hacer clic en **✏️ Editar** si quieres personalizar el nombre del archivo.
6. Haz clic en **⬇ Descargar** (o en *"Descargar todos"* si hay varias sesiones en la página).
7. Los archivos se guardan automáticamente en tu carpeta de **Descargas**.
8. Usa **🗑️ Limpiar historial** para mantener tu lista ordenada.

---

## 📁 Estructura del proyecto

```
descargador-videos/
├── manifest.json            — Configuración de la extensión (Manifest V3)
├── background.js            — Service worker: captura headers, cookies y requests
├── content.js               — Script de contenido: extrae títulos de tarjetas, duraciones y posters
├── downloader-engine.js     — Motor de enlace con el companion y fallback de Chrome
├── dash-parser.js           — Parser de manifests DASH
├── platform-interceptors.js — Interceptores de plataformas específicas
├── popup.html               — Interfaz visual moderna tipo tarjetas
├── popup.css                — Estilos modernos con modo oscuro
├── popup.js                 — Lógica interactiva del popup
├── icons/                   — Íconos de la extensión
└── companion/               — Servidor local nativo multiplataforma
    ├── companion.py         — Servidor HTTP local (puerto 7823, Windows / Mac / Linux)
    ├── instalar.bat         — Script instalador para Windows
    ├── iniciar-silencioso.vbs — Inicio silencioso en segundo plano para Windows
    ├── iniciar.bat          — Inicio visible para Windows
    ├── detener.bat          — Detener en Windows
    ├── instalar.sh          — Script instalador para macOS / Linux
    ├── iniciar.sh           — Inicio en segundo plano para macOS / Linux
    ├── detener.sh           — Detener en macOS / Linux
    └── README.md            — Documentación técnica del companion
```

---

## Hecho con ❤️ por [yaweb.co](https://yaweb.co)
