# Descargador de Videos — yaweb.co

¿Te gusta? Invítame un café: [☕ PayPal](https://www.paypal.com/paypalme/jttriana86?locale.x=es_XC&country.x=CO)

Extensión para Chrome, Edge y Opera que detecta y descarga cualquier video que se reproduzca en tu navegador. Sin límites, sin cuentas, sin suscripciones.

---

## 🚀 Qué puede descargar

- Videos MP4, WEBM, MOV directos
- Streams HLS (.m3u8) — cursos de Udemy, Teachable, Hotmart, Kajabi, conferencias y similares
- Streams DASH (.mpd)
- Detección automática con miniaturas, duración y títulos reales de sesiones
- Edición rápida de nombres de archivo antes de descargar
- Descarga individual o en lote

---

## 💻 Requisitos previos (si vas a usarlo en un computador nuevo)

Para que la extensión funcione con videos protegidos, cursos y streams HLS/DASH, requiere el **Companion App** local. En cualquier PC nuevo solo necesitas:

### 1. Python (versión 3.8 o superior)
- Descárgalo desde [python.org/downloads](https://www.python.org/downloads/).
- ⚠️ **Importante al instalar:** Marca la casilla **`Add python.exe to PATH`** en la pantalla inicial del instalador.

### 2. FFmpeg (para ensamblar audio y video de streams)
En Windows, abre PowerShell y ejecuta:
```powershell
winget install Gyan.FFmpeg
```

---

## 📦 Instalación paso a paso

### Paso 1: Instalar la extensión en el navegador
1. Descarga o clona este repositorio:
   ```bash
   git clone https://github.com/jttriana86/descargador-videos.git
   ```
2. Abre tu navegador y ve a:
   - **Chrome:** `chrome://extensions`
   - **Edge:** `edge://extensions`
   - **Opera:** `opera://extensions`
3. Activa el interruptor **"Modo desarrollador"** (arriba a la derecha).
4. Haz clic en **"Cargar extensión descomprimida"** (o *"Cargar desempaquetada"*).
5. Selecciona la carpeta del proyecto.
6. ¡Listo! El ícono aparecerá en tu barra de herramientas.

### Paso 2: Activar el Companion (una sola vez)
1. Abre la carpeta `companion/` del proyecto.
2. Haz doble clic en **`instalar.bat`** (instala `yt-dlp` automáticamente).
3. Haz doble clic en **`iniciar-silencioso.vbs`** (inicia el servidor en segundo plano sin ventanas molestas).
4. Abre la extensión: verás el indicador en verde **`Companion activo · v2.0.0`**.

> **Para detener el companion cuando quieras:** Haz doble clic en `detener.bat`.  
> **Para iniciarlo viendo la consola (debug):** Haz doble clic en `iniciar.bat`.

---

## 🎯 Cómo usar la extensión

1. Abre la página donde esté el video o las sesiones que deseas bajar.
2. **Reproduce el video** (unos pocos segundos son suficientes para que el detector lo capture).
3. Haz clic en el ícono de la extensión en tu barra de extensiones.
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
└── companion/               — Servidor local nativo (Python + yt-dlp + FFmpeg)
    ├── companion.py         — Servidor HTTP local (puerto 7823)
    ├── instalar.bat         — Script instalador de dependencias
    ├── iniciar-silencioso.vbs — Inicio silencioso en segundo plano
    ├── iniciar.bat          — Inicio con consola visible
    ├── detener.bat          — Detener el servidor
    └── README.md            — Documentación del companion
```

---

## Hecho con ❤️ por [yaweb.co](https://yaweb.co)
