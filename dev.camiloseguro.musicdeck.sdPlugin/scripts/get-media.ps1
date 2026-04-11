# get-media.ps1
# Consulta la sesión SMTC activa y devuelve JSON con info del media actual.
# Funciona con: Apple Music, Spotify, Chrome, Edge, y cualquier app SMTC en Windows.

param()
$ErrorActionPreference = 'Stop'

# Cargar ensamblados WinRT necesarios
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,
         Windows.Media.Control, ContentType=WindowsRuntime]
$null = [Windows.Storage.Streams.DataReader,
         Windows.Storage.Streams, ContentType=WindowsRuntime]
$null = [System.IO.WindowsRuntimeStreamExtensions]

# Helper para convertir IAsyncOperation<T> en un Task<T> invocable sincrónicamente
function Await {
    param([object]$AsyncOp)

    # Buscar el método genérico AsTask de WindowsRuntimeSystemExtensions
    $ext = [System.WindowsRuntimeSystemExtensions]
    $asTaskMethod = $ext.GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and
        $_.IsGenericMethod -and
        $_.GetParameters().Count -eq 1
    } | Select-Object -First 1

    if ($null -eq $asTaskMethod) {
        # Fallback: si el objeto ya expone .GetAwaiter().GetResult()
        return $AsyncOp.GetAwaiter().GetResult()
    }

    $resultType = $AsyncOp.GetType().GetGenericArguments() | Select-Object -First 1
    if ($null -eq $resultType) {
        return $AsyncOp.GetAwaiter().GetResult()
    }

    $genericMethod = $asTaskMethod.MakeGenericMethod($resultType)
    $task = $genericMethod.Invoke($null, @($AsyncOp))
    $task.Wait()
    return $task.Result
}

try {
    # Obtener el SessionManager
    $manager = Await([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync())
    $session  = $manager.GetCurrentSession()

    if ($null -eq $session) {
        '{"status":"no_media"}' | Write-Output
        exit 0
    }

    # Propiedades de la canción
    $props    = Await($session.TryGetMediaPropertiesAsync())
    $timeline = $session.GetTimelineProperties()
    $playback = $session.GetPlaybackInfo()

    # Estado de reproducción
    $playStatus = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionPlaybackStatus]
    $isPlaying  = ($playback.PlaybackStatus -eq $playStatus::Playing)

    # Leer thumbnail como base64 (JPEG/PNG según la app)
    $thumbBase64 = $null
    if ($null -ne $props.Thumbnail) {
        try {
            $stream    = Await($props.Thumbnail.OpenReadAsync())
            $netStream = [System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($stream)
            $ms        = [System.IO.MemoryStream]::new()
            $netStream.CopyTo($ms)
            $thumbBase64 = [System.Convert]::ToBase64String($ms.ToArray())
        }
        catch { $thumbBase64 = $null }
    }

    # Construir respuesta JSON
    [ordered]@{
        status    = 'ok'
        title     = [string]$props.Title
        artist    = [string]$props.Artist
        album     = [string]$props.AlbumTitle
        thumbnail = $thumbBase64
        isPlaying = $isPlaying
        position  = [double]$timeline.Position.TotalSeconds
        duration  = [double]$timeline.EndTime.TotalSeconds
        source    = [string]$session.SourceAppUserModelId
    } | ConvertTo-Json -Compress
}
catch {
    [ordered]@{
        status = 'error'
        error  = $_.Exception.Message
    } | ConvertTo-Json -Compress
}
