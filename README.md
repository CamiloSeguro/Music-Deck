# Music Deck

Plugin de [HotSpot StreamDock](https://www.hotspot-tech.com/) que muestra la portada, controles e información de la canción que estás escuchando, con letras sincronizadas y un visualizador animado.

Soporta **Apple Music**, **Spotify**, **Chrome/Edge** y cualquier app compatible con SMTC en Windows, o Apple Music/Spotify en macOS.

## Funcionalidad

- **Portada del álbum** dividida en 4 botones (cuadrícula 2×2) para formar una sola imagen grande sobre el Stream Deck.
- **Controles**: play/pause, siguiente, anterior.
- **Información de la canción**: título, artista, y posición/duración.
- **Letras sincronizadas** vía [LRCLIB](https://lrclib.net/).
- **Visualizador de barras** animado mientras se reproduce música.

### Fuentes de reproducción

| Plataforma | Fuente | Cómo se obtiene |
|---|---|---|
| Windows | Cualquier app con SMTC (Spotify, Apple Music, Chrome, Edge...) | Proceso nativo persistente (`SmtcNative.exe`, .NET) que lee la API `Windows.Media.Control` |
| macOS | Apple Music | AppleScript (`osascript`) |
| macOS | Spotify | AppleScript (`osascript`) |

En macOS, si Apple Music no está reproduciendo, se prueba automáticamente con Spotify.

## Estructura del proyecto

```
Music-Deck/
├── src/                              # Código fuente TypeScript del plugin (compila a bin/)
│   ├── plugin.ts                     # Punto de entrada: eventos StreamDock y loop de render
│   ├── streamdock.ts                 # Cliente WebSocket del protocolo StreamDock
│   ├── types.ts                      # Tipos compartidos (MediaInfo, LyricLine, etc.)
│   ├── actions/                      # Handlers de cada acción del Stream Deck
│   ├── providers/                    # Integraciones por plataforma/app
│   │   ├── smtc-windows.ts           # Windows: lee el caché de SmtcNative.exe
│   │   ├── apple-music-mac.ts        # macOS: Apple Music vía AppleScript
│   │   ├── spotify-mac.ts            # macOS: Spotify vía AppleScript
│   │   └── media-manager.ts          # Unifica providers y notifica cambios
│   ├── lyrics/
│   │   ├── lrclib.ts                 # Búsqueda de letras en LRCLIB
│   │   └── sync.ts                   # Cálculo de línea activa según posición
│   └── ui/
│       ├── canvas-renderer.ts        # Genera las imágenes PNG de cada botón (144×144)
│       └── visualizer.ts             # Estado del visualizador de barras animado
│
└── dev.camiloseguro.musicdeck.sdPlugin/   # Paquete del plugin (.sdPlugin) para StreamDock
    ├── manifest.json                 # Definición de acciones, íconos y requisitos
    ├── layouts/                      # Layouts de Stream Deck+ (encoder)
    ├── imgs/                         # Íconos del plugin
    ├── bin/                          # Salida compilada (generada, no versionada)
    └── scripts/
        ├── SmtcNative/               # App .NET: lee/controla SMTC y busca letras (Windows)
        ├── get-media.ps1             # Script PowerShell auxiliar (consulta SMTC)
        ├── control.ps1               # Script PowerShell auxiliar (control SMTC)
        └── smtc-loop.ps1             # Loop de PowerShell (alternativa al binario .NET)
```

## Requisitos

- [Node.js](https://nodejs.org/) 20+
- [HotSpot StreamDock](https://www.hotspot-tech.com/) instalado
- En Windows: [.NET SDK](https://dotnet.microsoft.com/) 8/10 para compilar `SmtcNative`
- En macOS: permisos de Automatización para que StreamDock controle Apple Music/Spotify vía AppleScript

## Instalación y build

```bash
# Instala dependencias del proyecto raíz y del paquete del plugin
npm run setup

# Compila el TypeScript (src/ → dev.camiloseguro.musicdeck.sdPlugin/bin/)
npm run build

# Recompila automáticamente al guardar cambios
npm run watch
```

En Windows, además hay que compilar el binario nativo que lee SMTC y busca letras:

```bash
cd dev.camiloseguro.musicdeck.sdPlugin/scripts/SmtcNative
dotnet build -c Release
```

### Cargar el plugin en StreamDock

Copia (o enlaza) la carpeta `dev.camiloseguro.musicdeck.sdPlugin/` dentro del directorio de plugins de StreamDock:

- **Windows**: `%AppData%\HotSpot\StreamDock\plugins\`
- **macOS**: `~/Library/Application Support/HotSpot/StreamDock/plugins/`

## Licencia

Uso personal / sin licencia especificada.
