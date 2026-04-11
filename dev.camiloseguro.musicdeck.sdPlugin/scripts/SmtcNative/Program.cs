/**
 * SmtcNative — Windows System Media Transport Controls reader/controller.
 *
 * Modes:
 *   SmtcNative.exe                                    → loop (JSON por segundo)
 *   SmtcNative.exe lyrics <title> <artist> <album> <dur> → busca letras en LRCLib
 *   SmtcNative.exe play|pause|togglePlay|next|previous   → control SMTC
 */

using System.IO;
using System.Net.Http;
using System.Text.Json;
using System.Text.Json.Serialization;
using Windows.Media.Control;

// ── Dispatch de modo ─────────────────────────────────────────────────────────

File.AppendAllText("C:\\Windows\\Temp\\smtc_startup.txt", $"[{DateTime.UtcNow:o}] startup args={args.Length}\n");
Console.Error.WriteLine("[SMTC] startup");

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

// ── Loop mode ────────────────────────────────────────────────────────────────

var thumbCache = new Dictionary<string, string?>();
int[] dbgTick = [0];

while (true)
{
    try
    {
        var json = await GetMediaJsonAsync(thumbCache, dbgTick);
        Console.WriteLine(json);
    }
    catch (Exception ex)
    {
        Console.WriteLine($"{{\"status\":\"error\",\"error\":{JsonSerializer.Serialize(ex.Message)}}}");
    }
    await Task.Delay(200);   // 5 Hz → posición fresca cada 200 ms
}

// ── Media reader ─────────────────────────────────────────────────────────────

// Apps de navegador — menor prioridad que apps nativas de música
static bool IsBrowser(string source)
{
    HashSet<string> browserSources = new(StringComparer.OrdinalIgnoreCase)
    {
        "chrome.exe", "msedge.exe", "firefox.exe", "opera.exe", "brave.exe",
        "chromium.exe", "iexplore.exe", "360chrome.exe"
    };
    return browserSources.Contains(System.IO.Path.GetFileName(source).ToLowerInvariant())
        || source.Contains("chrome", StringComparison.OrdinalIgnoreCase)
        || source.Contains("edge", StringComparison.OrdinalIgnoreCase)
        || source.Contains("firefox", StringComparison.OrdinalIgnoreCase);
}

static GlobalSystemMediaTransportControlsSession? PickBestSession(
    IReadOnlyList<GlobalSystemMediaTransportControlsSession> sessions,
    GlobalSystemMediaTransportControlsSession? current)
{
    // 1. App nativa reproduciendo (no navegador)
    foreach (var s in sessions)
    {
        try {
            if (s.GetPlaybackInfo()?.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing
                && !IsBrowser(s.SourceAppUserModelId ?? ""))
                return s;
        } catch { }
    }

    // 2. Navegador reproduciendo (YouTube, etc.)
    foreach (var s in sessions)
    {
        try {
            if (s.GetPlaybackInfo()?.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing)
                return s;
        } catch { }
    }

    // 3. App nativa en pausa (SMTC "current session")
    if (current != null && !IsBrowser(current.SourceAppUserModelId ?? "")) return current;

    // 4. Cualquier sesión actual (puede ser navegador en pausa)
    return current;
}

static async Task<string> GetMediaJsonAsync(Dictionary<string, string?> thumbCache, int[] dbgTick)
{
    Console.Error.WriteLine("[SMTC] before RequestAsync");
    var manager = await GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
    Console.Error.WriteLine($"[SMTC] after RequestAsync manager={manager != null}");
    if (manager == null) return "{\"status\":\"no_media\"}";

    // Debug: log all sessions every ~5 s
    if (++dbgTick[0] % 25 == 1)
    {
        var sessions = manager.GetSessions();
        Console.Error.WriteLine($"[SMTC-DBG] sessions={sessions.Count} current={manager.GetCurrentSession()?.SourceAppUserModelId ?? "null"}");
        foreach (var s in sessions)
        {
            try { Console.Error.WriteLine($"[SMTC-DBG]  src={s.SourceAppUserModelId} status={s.GetPlaybackInfo()?.PlaybackStatus}"); } catch { }
        }
    }

    var session = PickBestSession(manager.GetSessions(), manager.GetCurrentSession());
    if (session == null) return "{\"status\":\"no_media\"}";

    var props    = await session.TryGetMediaPropertiesAsync();
    if (props == null) return "{\"status\":\"no_media\"}";

    var timeline = session.GetTimelineProperties();
    var playback = session.GetPlaybackInfo();

    bool   isPlaying = playback?.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing;
    string title     = props.Title      ?? "";
    string artist    = props.Artist     ?? "";
    string album     = props.AlbumTitle ?? "";
    string source    = session.SourceAppUserModelId ?? "";
    double position  = timeline?.Position.TotalSeconds ?? 0;
    double duration  = timeline?.EndTime.TotalSeconds  ?? 0;

    // Algunos apps reportan "Artista — Álbum" en el campo Artist con AlbumTitle vacío
    if (string.IsNullOrEmpty(album) && artist.Contains('\u2014'))
    {
        var parts = artist.Split('\u2014', 2);
        artist = parts[0].Trim();
        album  = parts[1].Trim();
    }

    string cacheKey = $"{title}|{artist}";
    if (!thumbCache.ContainsKey(cacheKey))
    {
        thumbCache.Clear();
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
        thumbCache[cacheKey] = thumb;
    }

    string? thumbnail = thumbCache.GetValueOrDefault(cacheKey);

    // positionTs: milisegundos UTC cuando se leyó la posición,
    // permite al cliente interpolar en tiempo real sin depender del delay del pipe.
    long positionTs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();

    return JsonSerializer.Serialize(new MediaPayload(
        "ok", title, artist, album, thumbnail,
        isPlaying, position, duration, source, positionTs
    ));
}

// ── Lyrics fetcher (LRCLib) ───────────────────────────────────────────────────

static async Task<string> FetchLyricsJsonAsync(HttpClient http, string title, string artist, string album, int duration)
{
    // Variaciones del título: quitar "(feat. X)", "[X]", "(X Remix)", etc.
    var titles  = TitleVariants(title);
    var artists = ArtistVariants(artist);

    foreach (var t in titles)
    {
        foreach (var a in artists)
        {
            // Con álbum y duración
            var lines = await TryGetLrc(http, t, a, album, duration.ToString());
            if (lines != null) return JsonSerializer.Serialize(lines);

            // Sin álbum ni duración
            lines = await TryGetLrc(http, t, a, "", "");
            if (lines != null) return JsonSerializer.Serialize(lines);
        }
    }

    // Búsqueda libre con el título original
    foreach (var t in titles)
    {
        var lines = await TrySearchLrc(http, t, artists[0]);
        if (lines != null) return JsonSerializer.Serialize(lines);
    }

    return "[]";
}

static string[] TitleVariants(string title)
{
    var variants = new System.Collections.Generic.List<string> { title };

    // Quitar todo lo que esté entre paréntesis o corchetes
    var clean = System.Text.RegularExpressions.Regex.Replace(title, @"\s*[\(\[][^)\]]*[\)\]]", "").Trim();
    if (clean != title && !string.IsNullOrEmpty(clean)) variants.Add(clean);

    // Quitar solo el feat. manteniendo el resto
    var noFeat = System.Text.RegularExpressions.Regex.Replace(title, @"\s*[\(\[]?feat\..*?[\)\]]?", "", System.Text.RegularExpressions.RegexOptions.IgnoreCase).Trim().TrimEnd('-').Trim();
    if (noFeat != title && !string.IsNullOrEmpty(noFeat) && !variants.Contains(noFeat)) variants.Add(noFeat);

    return variants.ToArray();
}

static string[] ArtistVariants(string artist)
{
    var variants = new System.Collections.Generic.List<string> { artist };

    // Si hay coma o & o "ft." tomar solo el primero
    var primary = System.Text.RegularExpressions.Regex.Split(artist, @",|&|\bft\.|\bfeat\.|\bx\b", System.Text.RegularExpressions.RegexOptions.IgnoreCase)[0].Trim();
    if (primary != artist && !string.IsNullOrEmpty(primary)) variants.Add(primary);

    return variants.ToArray();
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
        if (data?.SyncedLyrics != null)
        {
            var parsed = ParseLrc(data.SyncedLyrics);
            if (parsed.Length > 0) return parsed;
        }
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
        if (results == null) return null;
        foreach (var r in results)
        {
            if (r.SyncedLyrics != null)
            {
                var parsed = ParseLrc(r.SyncedLyrics);
                if (parsed.Length > 0) return parsed;
            }
        }
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

static async Task SendControlAsync(string action)
{
    var manager = await GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
    if (manager == null) return;

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
