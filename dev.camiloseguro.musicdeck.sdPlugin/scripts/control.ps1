# control.ps1
# Envía comandos de control a la sesión SMTC activa usando C# inline.
# Uso: control.ps1 -Action <play|pause|togglePlay|next|previous>

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet('play','pause','togglePlay','next','previous')]
    [string]$Action
)
$ErrorActionPreference = 'SilentlyContinue'

$csharp = @'
using System;
using System.Threading.Tasks;
using Windows.Media.Control;

public static class SmtcControl
{
    public static async Task SendActionAsync(string action)
    {
        var manager = await GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
        if (manager == null) return;

        // Prioridad: sesion reproduciendo; si no, sesion actual
        var sessions = manager.GetSessions();
        GlobalSystemMediaTransportControlsSession session = null;

        foreach (var s in sessions)
        {
            try
            {
                var pb = s.GetPlaybackInfo();
                if (pb?.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing)
                { session = s; break; }
            }
            catch { }
        }
        if (session == null) session = manager.GetCurrentSession();
        if (session == null) return;

        switch (action)
        {
            case "play":       await session.TryPlayAsync();             break;
            case "pause":      await session.TryPauseAsync();            break;
            case "togglePlay": await session.TryTogglePlayPauseAsync();  break;
            case "next":       await session.TrySkipNextAsync();         break;
            case "previous":   await session.TrySkipPreviousAsync();     break;
        }
    }
}
'@

# Cargar ensamblados WinRT
try {
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,
             Windows.Media.Control, ContentType=WindowsRuntime]
} catch {}

$refs = @(
    [System.Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory() + 'System.dll',
    [System.Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory() + 'System.Core.dll',
    [System.Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory() + 'System.Runtime.dll'
)

$winrtAssemblies = @()
foreach ($pattern in @('*Windows.Media.Control*','*System.Runtime.WindowsRuntime*')) {
    $asm = [AppDomain]::CurrentDomain.GetAssemblies() |
        Where-Object { $_.FullName -like $pattern } | Select-Object -First 1
    if ($asm) { $winrtAssemblies += $asm.Location }
}

$allRefs = ($refs + $winrtAssemblies) | Where-Object { $_ -and (Test-Path $_) } | Sort-Object -Unique

try {
    Add-Type -TypeDefinition $csharp -ReferencedAssemblies $allRefs -Language CSharp
} catch {
    exit 1
}

try {
    $task = [SmtcControl]::SendActionAsync($Action)
    $task.Wait(4000) | Out-Null
} catch {}
exit 0
