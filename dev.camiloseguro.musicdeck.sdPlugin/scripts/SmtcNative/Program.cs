/**
 * SmtcNative — Windows System Media Transport Controls reader/controller.
 *
 * Modos:
 *   SmtcNative.exe                                         → loop (JSON cada 200ms)
 *       Protocolo 2: la primera línea es {"status":"hello","protocol":2}; la portada
 *       solo se manda cuando cambia (thumbChanged); acepta comandos por stdin
 *       (play|pause|togglePlay|next|previous, uno por línea).
 *   SmtcNative.exe lyrics <title> <artist> <album> <dur>  → busca letras en LRCLib
 *   SmtcNative.exe play|pause|togglePlay|next|previous    → control SMTC
 *
 * Arquitectura del threading:
 *   - [STAThread] en Main para COM/WinRT
 *   - DispatcherQueueController.CreateOnCurrentThread() crea una cola de mensajes
 *     WinRT en el hilo STA actual
 *   - Bomba de mensajes Win32 (GetMessage loop) permite que WinRT entregue
 *     los callbacks de RequestAsync sin deadlock
 */

using System.IO;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Threading;
using Windows.Media.Control;

class Program
{
    // ── Win32 message pump (P/Invoke) ─────────────────────────────────────────────

    [StructLayout(LayoutKind.Sequential)]
    struct MSG { IntPtr hwnd; uint message; IntPtr wParam; IntPtr lParam; uint time; int x; int y; }

    [DllImport("user32.dll")] static extern bool PeekMessage(out MSG msg, IntPtr hWnd, uint min, uint max, uint remove);
    [DllImport("user32.dll")] static extern bool TranslateMessage(ref MSG msg);
    [DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref MSG msg);
    // Espera hasta que haya mensajes o timeout (evita busy-wait)
    [DllImport("user32.dll")] static extern uint MsgWaitForMultipleObjectsEx(uint nCount, IntPtr[] pHandles, uint dwMs, uint dwWakeMask, uint dwFlags);

    // ── Entry point ───────────────────────────────────────────────────────────────

    [STAThread]
    static void Main(string[] cmdArgs)
    {
        Console.Error.WriteLine("[SMTC] startup (STA + PeekMessage pump)");

        // Lanzamos la lógica async en un ThreadPool thread (MTA).
        // El hilo STA principal bombea mensajes para que WinRT pueda
        // entregar los callbacks de RequestAsync sin deadlock.
        var task = Task.Run(() => RunAsync(cmdArgs));

        // Bomba de mensajes Win32: procesa COM/WinRT callbacks en el hilo STA
        const uint QS_ALLINPUT  = 0x04FF;
        const uint MWMO_INPUTAVAILABLE = 0x0004;
        const uint PM_REMOVE    = 0x0001;

        while (!task.IsCompleted)
        {
            // Esperar hasta que llegue un mensaje (o 50 ms de timeout)
            MsgWaitForMultipleObjectsEx(0, Array.Empty<IntPtr>(), 50, QS_ALLINPUT, MWMO_INPUTAVAILABLE);

            // Procesar todos los mensajes pendientes
            while (PeekMessage(out var msg, IntPtr.Zero, 0, 0, PM_REMOVE))
            {
                TranslateMessage(ref msg);
                DispatchMessage(ref msg);
            }
        }

        task.GetAwaiter().GetResult(); // re-lanza excepciones si hubo
    }

    // ── Lógica principal ──────────────────────────────────────────────────────────

    static async Task RunAsync(string[] args)
    {
        var http = new HttpClient
        {
            Timeout = TimeSpan.FromSeconds(8),
            DefaultRequestHeaders = { { "User-Agent", "MusicDeck/1.0" } }
        };

        if (args.Length > 0 && args[0] == "lyrics")
        {
            string lTitle  = args.Length > 1 ? args[1] : "";
            string lArtist = args.Length > 2 ? args[2] : "";
            string lAlbum  = args.Length > 3 ? args[3] : "";
            int    lDur    = args.Length > 4 && int.TryParse(args[4], out var d) ? d : 0;
            Console.WriteLine(await FetchLyricsJsonAsync(http, lTitle, lArtist, lAlbum, lDur));
            return;
        }

        if (args.Length > 0)
        {
            await SendControlAsync(args[0]);
            return;
        }

        // ── Loop mode ──────────────────────────────────────────────────────────────

        Console.Error.WriteLine("[SMTC] calling RequestAsync...");
        var manager = await GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
        Console.Error.WriteLine($"[SMTC] manager ready sessions={manager?.GetSessions().Count ?? -1}");

        if (manager == null)
        {
            Console.Error.WriteLine("[SMTC] manager is null — exiting");
            return;
        }

        Console.WriteLine("{\"status\":\"hello\",\"protocol\":2}");
        _ = Task.Run(() => ReadCommandsAsync(manager));

        var thumbs      = new ThumbState();
        string lastDbg  = "";

        while (true)
        {
            try
            {
                // Log de sesiones solo cuando cambian (antes: cada 5 s, para siempre)
                var sessions = manager.GetSessions();
                var dbg = $"sessions={sessions.Count} current={manager.GetCurrentSession()?.SourceAppUserModelId ?? "null"}";
                foreach (var s in sessions)
                {
                    try { dbg += $" | {s.SourceAppUserModelId}={s.GetPlaybackInfo()?.PlaybackStatus}"; } catch { }
                }
                if (dbg != lastDbg)
                {
                    Console.Error.WriteLine($"[SMTC-DBG] {dbg}");
                    lastDbg = dbg;
                }

                var json = await GetMediaJsonAsync(manager, thumbs);
                Console.WriteLine(json);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"{{\"status\":\"error\",\"error\":{JsonSerializer.Serialize(ex.Message)}}}");
            }
            await Task.Delay(200);
        }
    }

    // ── Media reader ──────────────────────────────────────────────────────────────

    static bool IsBrowser(string source)
    {
        var name = Path.GetFileName(source).ToLowerInvariant();
        if (name is "chrome.exe" or "msedge.exe" or "firefox.exe" or "opera.exe"
                 or "brave.exe" or "chromium.exe" or "iexplore.exe" or "360chrome.exe")
            return true;
        return source.Contains("chrome",  StringComparison.OrdinalIgnoreCase)
            || source.Contains("edge",    StringComparison.OrdinalIgnoreCase)
            || source.Contains("firefox", StringComparison.OrdinalIgnoreCase);
    }

    static GlobalSystemMediaTransportControlsSession? PickBestSession(
        IReadOnlyList<GlobalSystemMediaTransportControlsSession> sessions,
        GlobalSystemMediaTransportControlsSession? current)
    {
        foreach (var s in sessions)
        {
            try {
                if (s.GetPlaybackInfo()?.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing
                    && !IsBrowser(s.SourceAppUserModelId ?? ""))
                    return s;
            } catch { }
        }
        foreach (var s in sessions)
        {
            try {
                if (s.GetPlaybackInfo()?.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing)
                    return s;
            } catch { }
        }
        return current;
    }

    // Portada de la canción actual y si ya se le mandó al plugin
    class ThumbState
    {
        public string  Key   = "";
        public string? Thumb;
        public bool    Sent;
    }

    static async Task<string> GetMediaJsonAsync(
        GlobalSystemMediaTransportControlsSessionManager manager,
        ThumbState thumbs)
    {
        var session = PickBestSession(manager.GetSessions(), manager.GetCurrentSession());
        if (session == null) return "{\"status\":\"no_media\"}";

        var props = await session.TryGetMediaPropertiesAsync();
        if (props == null) return "{\"status\":\"no_media\"}";

        var timeline  = session.GetTimelineProperties();
        var playback  = session.GetPlaybackInfo();
        bool isPlaying = playback?.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing;
        string title   = props.Title      ?? "";
        string artist  = props.Artist     ?? "";
        string album   = props.AlbumTitle ?? "";
        string source  = session.SourceAppUserModelId ?? "";
        double position = timeline?.Position.TotalSeconds ?? 0;
        double duration = timeline?.EndTime.TotalSeconds  ?? 0;

        if (string.IsNullOrEmpty(album) && artist.Contains('\u2014'))
        {
            var parts = artist.Split('\u2014', 2);
            artist = parts[0].Trim();
            album  = parts[1].Trim();
        }

        string cacheKey = $"{title}|{artist}";
        if (thumbs.Key != cacheKey)
        {
            string? thumb = null;
            try
            {
                if (props.Thumbnail != null)
                {
                    using var stream    = await props.Thumbnail.OpenReadAsync();
                    using var netStream = stream.AsStreamForRead();
                    using var ms        = new MemoryStream();
                    await netStream.CopyToAsync(ms);
                    thumb = Convert.ToBase64String(ms.ToArray());
                }
            }
            catch { }
            thumbs.Key   = cacheKey;
            thumbs.Thumb = thumb;
            thumbs.Sent  = false;
        }

        // La portada (~200 KB en base64) solo viaja una vez por canción
        bool thumbChanged = !thumbs.Sent;
        thumbs.Sent = true;

        long positionTs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        return JsonSerializer.Serialize(new MediaPayload(
            "ok", title, artist, album, thumbChanged ? thumbs.Thumb : null, thumbChanged,
            isPlaying, position, duration, source, positionTs
        ));
    }

    // ── Lyrics ────────────────────────────────────────────────────────────────────

    static async Task<string> FetchLyricsJsonAsync(HttpClient http, string title, string artist, string album, int duration)
    {
        var titles  = TitleVariants(title);
        var artists = ArtistVariants(artist);

        foreach (var t in titles)
        {
            foreach (var a in artists)
            {
                var lines = await TryGetLrc(http, t, a, album, duration.ToString());
                if (lines != null) return JsonSerializer.Serialize(lines);
                lines = await TryGetLrc(http, t, a, "", "");
                if (lines != null) return JsonSerializer.Serialize(lines);
            }
        }
        foreach (var t in titles)
        {
            var lines = await TrySearchLrc(http, t, artists[0]);
            if (lines != null) return JsonSerializer.Serialize(lines);
        }
        return "[]";
    }

    static string[] TitleVariants(string title)
    {
        var v = new List<string> { title };
        var clean = System.Text.RegularExpressions.Regex.Replace(title, @"\s*[\(\[][^)\]]*[\)\]]", "").Trim();
        if (clean != title && !string.IsNullOrEmpty(clean)) v.Add(clean);
        var noFeat = System.Text.RegularExpressions.Regex.Replace(title, @"\s*[\(\[]?feat\..*?[\)\]]?", "", System.Text.RegularExpressions.RegexOptions.IgnoreCase).Trim().TrimEnd('-').Trim();
        if (noFeat != title && !string.IsNullOrEmpty(noFeat) && !v.Contains(noFeat)) v.Add(noFeat);
        return v.ToArray();
    }

    static string[] ArtistVariants(string artist)
    {
        var v = new List<string> { artist };
        var primary = System.Text.RegularExpressions.Regex.Split(artist, @",|&|\bft\.|\bfeat\.|\bx\b", System.Text.RegularExpressions.RegexOptions.IgnoreCase)[0].Trim();
        if (primary != artist && !string.IsNullOrEmpty(primary)) v.Add(primary);
        return v.ToArray();
    }

    static async Task<LyricLine[]?> TryGetLrc(HttpClient http, string title, string artist, string album, string duration)
    {
        try
        {
            var q = $"track_name={Uri.EscapeDataString(title)}&artist_name={Uri.EscapeDataString(artist)}";
            if (!string.IsNullOrEmpty(album))    q += $"&album_name={Uri.EscapeDataString(album)}";
            if (!string.IsNullOrEmpty(duration)) q += $"&duration={duration}";
            var raw  = await http.GetStringAsync($"https://lrclib.net/api/get?{q}");
            var data = JsonSerializer.Deserialize<LrcLibResponse>(raw);
            if (data?.SyncedLyrics != null) { var p = ParseLrc(data.SyncedLyrics); if (p.Length > 0) return p; }
        }
        catch { }
        return null;
    }

    static async Task<LyricLine[]?> TrySearchLrc(HttpClient http, string title, string artist)
    {
        try
        {
            var q       = $"track_name={Uri.EscapeDataString(title)}&artist_name={Uri.EscapeDataString(artist)}";
            var raw     = await http.GetStringAsync($"https://lrclib.net/api/search?{q}");
            var results = JsonSerializer.Deserialize<LrcLibResponse[]>(raw);
            if (results != null)
                foreach (var r in results)
                    if (r.SyncedLyrics != null) { var p = ParseLrc(r.SyncedLyrics); if (p.Length > 0) return p; }
        }
        catch { }
        return null;
    }

    static LyricLine[] ParseLrc(string lrc)
    {
        var lines = new List<LyricLine>();
        foreach (var raw in lrc.Split('\n'))
        {
            var m = System.Text.RegularExpressions.Regex.Match(raw, @"\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)");
            if (!m.Success) continue;
            var text = m.Groups[4].Value.Trim();
            if (string.IsNullOrEmpty(text)) continue;
            var ms   = m.Groups[3].Value.Length == 3 ? int.Parse(m.Groups[3].Value) : int.Parse(m.Groups[3].Value) * 10;
            var time = int.Parse(m.Groups[1].Value) * 60 + int.Parse(m.Groups[2].Value) + ms / 1000.0;
            lines.Add(new LyricLine(time, text));
        }
        lines.Sort((a, b) => a.Time.CompareTo(b.Time));
        return lines.ToArray();
    }

    // ── Control ───────────────────────────────────────────────────────────────────

    // Loop mode: comandos de control por stdin, uno por línea (evita lanzar un proceso por tecla).
    // Si stdin se cierra, el plugin murió → salir en vez de quedar huérfano.
    static async Task ReadCommandsAsync(GlobalSystemMediaTransportControlsSessionManager manager)
    {
        string? line;
        while ((line = await Console.In.ReadLineAsync()) != null)
        {
            try { await SendControlAsync(manager, line.Trim()); }
            catch (Exception ex) { Console.Error.WriteLine($"[SMTC] control '{line}' falló: {ex.Message}"); }
        }
        Environment.Exit(0);
    }

    static async Task SendControlAsync(string action)
    {
        var manager = await GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
        if (manager == null) return;
        await SendControlAsync(manager, action);
    }

    static async Task SendControlAsync(GlobalSystemMediaTransportControlsSessionManager manager, string action)
    {
        var session = PickBestSession(manager.GetSessions(), manager.GetCurrentSession());
        if (session == null) return;
        switch (action)
        {
            case "play":       await session.TryPlayAsync();            break;
            case "pause":      await session.TryPauseAsync();           break;
            case "togglePlay": await session.TryTogglePlayPauseAsync(); break;
            case "next":       await session.TrySkipNextAsync();        break;
            case "previous":   await session.TrySkipPreviousAsync();    break;
        }
    }

    // ── DTOs ──────────────────────────────────────────────────────────────────────

    record MediaPayload(
        [property: JsonPropertyName("status")]      string  Status,
        [property: JsonPropertyName("title")]       string  Title,
        [property: JsonPropertyName("artist")]      string  Artist,
        [property: JsonPropertyName("album")]       string  Album,
        [property: JsonPropertyName("thumbnail")]   string? Thumbnail,
        [property: JsonPropertyName("thumbChanged")] bool   ThumbChanged,
        [property: JsonPropertyName("isPlaying")]   bool    IsPlaying,
        [property: JsonPropertyName("position")]    double  Position,
        [property: JsonPropertyName("duration")]    double  Duration,
        [property: JsonPropertyName("source")]      string  Source,
        [property: JsonPropertyName("positionTs")]  long    PositionTs
    );

    record LyricLine(
        [property: JsonPropertyName("time")] double Time,
        [property: JsonPropertyName("text")] string Text
    );

    class LrcLibResponse
    {
        [JsonPropertyName("syncedLyrics")] public string? SyncedLyrics { get; set; }
        [JsonPropertyName("plainLyrics")]  public string? PlainLyrics  { get; set; }
    }
}
