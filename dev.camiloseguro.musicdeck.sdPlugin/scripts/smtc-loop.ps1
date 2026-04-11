# smtc-loop.ps1
# Proceso persistente: lee SMTC cada segundo y escribe JSON a stdout.
# Usa C# inline para llamar correctamente las APIs WinRT async.

$ErrorActionPreference = 'SilentlyContinue'

$csharp = @'
using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading.Tasks;
using Windows.Media.Control;
using Windows.Storage.Streams;

public static class SmtcReader
{
    public static async Task<string> GetMediaJsonAsync()
    {
        try
        {
            var manager = await GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
            if (manager == null) return "{\"status\":\"no_media\"}";

            var sessions = manager.GetSessions();
            GlobalSystemMediaTransportControlsSession session = null;

            // Prioridad 1: sesion reproduciendo activamente
            foreach (var s in sessions)
            {
                try
                {
                    var pb = s.GetPlaybackInfo();
                    if (pb?.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing)
                    {
                        session = s;
                        break;
                    }
                }
                catch { }
            }

            // Prioridad 2: sesion actual (puede estar en pausa)
            if (session == null)
                session = manager.GetCurrentSession();

            if (session == null) return "{\"status\":\"no_media\"}";

            var props = await session.TryGetMediaPropertiesAsync();
            if (props == null) return "{\"status\":\"no_media\"}";

            var timeline = session.GetTimelineProperties();
            var playback = session.GetPlaybackInfo();

            bool isPlaying = playback?.PlaybackStatus ==
                GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing;

            string title  = props.Title  ?? "";
            string artist = props.Artist ?? "";
            string album  = props.AlbumTitle ?? "";
            string source = session.SourceAppUserModelId ?? "";
            double position = timeline?.Position.TotalSeconds ?? 0;
            double duration  = timeline?.EndTime.TotalSeconds  ?? 0;

            string thumbnail = null;
            try
            {
                if (props.Thumbnail != null)
                {
                    using (var stream = await props.Thumbnail.OpenReadAsync())
                    using (var netStream = stream.AsStreamForRead())
                    using (var ms = new MemoryStream())
                    {
                        await netStream.CopyToAsync(ms);
                        thumbnail = Convert.ToBase64String(ms.ToArray());
                    }
                }
            }
            catch { }

            string thumbJson = thumbnail != null
                ? "\"" + thumbnail + "\""
                : "null";

            string titleEsc  = EscapeJson(title);
            string artistEsc = EscapeJson(artist);
            string albumEsc  = EscapeJson(album);
            string sourceEsc = EscapeJson(source);

            return "{\"status\":\"ok\","
                + "\"title\":\""  + titleEsc  + "\","
                + "\"artist\":\"" + artistEsc + "\","
                + "\"album\":\""  + albumEsc  + "\","
                + "\"thumbnail\":" + thumbJson + ","
                + "\"isPlaying\":" + (isPlaying ? "true" : "false") + ","
                + "\"position\":" + position.ToString(System.Globalization.CultureInfo.InvariantCulture) + ","
                + "\"duration\":" + duration.ToString(System.Globalization.CultureInfo.InvariantCulture)  + ","
                + "\"source\":\""  + sourceEsc  + "\"}";
        }
        catch (Exception ex)
        {
            return "{\"status\":\"error\",\"error\":\"" + EscapeJson(ex.Message) + "\"}";
        }
    }

    private static string EscapeJson(string s)
    {
        if (s == null) return "";
        var sb = new StringBuilder(s.Length);
        foreach (char c in s)
        {
            switch (c)
            {
                case '"':  sb.Append("\\\""); break;
                case '\\': sb.Append("\\\\"); break;
                case '\n': sb.Append("\\n");  break;
                case '\r': sb.Append("\\r");  break;
                case '\t': sb.Append("\\t");  break;
                default:
                    if (c < 0x20)
                        sb.Append(string.Format("\\u{0:x4}", (int)c));
                    else
                        sb.Append(c);
                    break;
            }
        }
        return sb.ToString();
    }
}
'@

# Cargar ensamblados WinRT necesarios
try {
    [void][System.Reflection.Assembly]::LoadWithPartialName('System.Runtime.WindowsRuntime')
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,
             Windows.Media.Control, ContentType=WindowsRuntime]
    $null = [Windows.Storage.Streams.IRandomAccessStreamReference,
             Windows.Storage.Streams, ContentType=WindowsRuntime]
} catch {}

# Referencias necesarias para compilar el C#
$refs = @(
    [System.Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory() + 'System.dll',
    [System.Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory() + 'System.Core.dll',
    [System.Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory() + 'System.Runtime.dll'
)

# Buscar ensamblados WinRT en el GAC / runtime
$winrtAssemblies = @()
$smtcAsm = [AppDomain]::CurrentDomain.GetAssemblies() |
    Where-Object { $_.FullName -like '*Windows.Media.Control*' } |
    Select-Object -First 1
if ($smtcAsm) { $winrtAssemblies += $smtcAsm.Location }

$streamsAsm = [AppDomain]::CurrentDomain.GetAssemblies() |
    Where-Object { $_.FullName -like '*Windows.Storage.Streams*' } |
    Select-Object -First 1
if ($streamsAsm) { $winrtAssemblies += $streamsAsm.Location }

$runtimeAsm = [AppDomain]::CurrentDomain.GetAssemblies() |
    Where-Object { $_.FullName -like '*System.Runtime.WindowsRuntime*' -and $_.FullName -notlike '*Interop*' } |
    Select-Object -First 1
if ($runtimeAsm) { $winrtAssemblies += $runtimeAsm.Location }

$interopAsm = [AppDomain]::CurrentDomain.GetAssemblies() |
    Where-Object { $_.FullName -like '*System.Runtime.InteropServices.WindowsRuntime*' } |
    Select-Object -First 1
if ($interopAsm) { $winrtAssemblies += $interopAsm.Location }

# Agregar Windows.winmd si existe
$winmd = 'C:\Windows\System32\WinMetadata\Windows.Media.Control.winmd'
if (Test-Path $winmd) { $winrtAssemblies += $winmd }

$allRefs = ($refs + $winrtAssemblies) | Where-Object { $_ -and (Test-Path $_) } | Sort-Object -Unique

try {
    Add-Type -TypeDefinition $csharp -ReferencedAssemblies $allRefs -Language CSharp
} catch {
    # Si falla la compilacion, salir para que Node.js lo detecte
    Write-Output "{`"status`":`"error`",`"error`":`"csharp_compile_failed: $($_.Exception.Message.Replace('"','`"'))`"}"
    [Console]::Out.Flush()
    exit 1
}

# Cache de thumbnail para no re-leerlo en cada tick
$thumbCache = @{}   # "title|artist" -> base64

while ($true) {
    try {
        $task = [SmtcReader]::GetMediaJsonAsync()
        $task.Wait(3000) | Out-Null
        $json = $task.Result

        # Inyectar thumbnail cacheado si el JSON lo trae null para la misma cancion
        # (evitar re-leer el thumbnail en cada tick cuando la cancion no cambia)
        try {
            $parsed = $json | ConvertFrom-Json
            if ($parsed.status -eq 'ok') {
                $cacheKey = "$($parsed.title)|$($parsed.artist)"
                if ($null -eq $parsed.thumbnail -and $thumbCache.ContainsKey($cacheKey)) {
                    # No hacemos nada: el C# ya lee el thumbnail correctamente
                }
                if ($null -ne $parsed.thumbnail) {
                    $thumbCache[$cacheKey] = $parsed.thumbnail
                } elseif ($thumbCache.ContainsKey($cacheKey)) {
                    # Reinjectar el thumbnail cacheado en el JSON
                    $thumbB64 = $thumbCache[$cacheKey]
                    $json = $json -replace '"thumbnail":null', "`"thumbnail`":`"$thumbB64`""
                }
            }
        } catch {}

        $json | Write-Output
        [Console]::Out.Flush()
    } catch {
        "{`"status`":`"error`",`"error`":`"loop_exception`"}" | Write-Output
        [Console]::Out.Flush()
    }

    Start-Sleep -Milliseconds 1000
}
