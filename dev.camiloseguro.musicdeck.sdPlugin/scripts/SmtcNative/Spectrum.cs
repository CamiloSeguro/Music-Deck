/**
 * Spectrum — captura lo que suena en el sistema (WASAPI loopback) y emite
 * BANDS bandas de frecuencia (0–1, escala logarítmica 50 Hz–12 kHz) cada
 * EMIT_MS como una línea JSON: {"status":"spectrum","bands":[...]}.
 *
 * Solo corre mientras el plugin lo pide ("spectrum on"/"spectrum off" por stdin),
 * así no se captura audio si no hay ningún visualizador en pantalla.
 */

using System.Globalization;
using System.Text;
using NAudio.Dsp;
using NAudio.Wave;

sealed class Spectrum : IDisposable
{
    public const int Bands = 24;

    const double WindowS  = 0.04;      // ~40 ms de audio por FFT, sea cual sea el sample rate
    const int    EmitMs   = 50;
    const double MinFreq  = 50;
    const double MaxFreq  = 12_000;   // por encima casi no hay energía en audio comprimido
    const double FloorDb  = -72;       // silencio → 0
    const double RangeDb  = 62;        // FloorDb + RangeDb → 1
    const double TiltDb   = 0.5;       // dB extra por banda: compensa que los agudos tienen menos energía

    readonly WasapiLoopbackCapture capture;
    readonly Timer   timer;
    readonly object  gate = new();
    readonly int     fftSize;          // potencia de 2: 2048 a 48 kHz, 8192 a 192 kHz
    readonly int     fftLog2;
    readonly float[] ring;
    int  ringPos;
    long lastDataMs;

    public Spectrum()
    {
        capture = new WasapiLoopbackCapture();
        fftLog2 = (int)Math.Ceiling(Math.Log2(capture.WaveFormat.SampleRate * WindowS));
        fftSize = 1 << fftLog2;
        ring    = new float[fftSize];
        capture.DataAvailable += OnData;
        capture.StartRecording();
        timer = new Timer(_ => Emit(), null, EmitMs, EmitMs);
        Console.Error.WriteLine($"[SMTC] spectrum on ({capture.WaveFormat}, FFT {fftSize})");
    }

    void OnData(object? sender, WaveInEventArgs e)
    {
        var wf       = capture.WaveFormat;
        int bytes    = wf.BitsPerSample / 8;
        int channels = wf.Channels;
        int frame    = bytes * channels;
        if (frame == 0) return;

        lock (gate)
        {
            for (int i = 0; i + frame <= e.BytesRecorded; i += frame)
            {
                // Mezcla a mono. Loopback suele ser float de 32 bits; si no, PCM de 16.
                float sum = 0;
                for (int c = 0; c < channels; c++)
                {
                    sum += bytes == 4
                        ? BitConverter.ToSingle(e.Buffer, i + c * 4)
                        : BitConverter.ToInt16(e.Buffer, i + c * 2) / 32768f;
                }
                ring[ringPos] = sum / channels;
                ringPos = (ringPos + 1) % fftSize;
            }
            lastDataMs = Environment.TickCount64;
        }
    }

    void Emit()
    {
        try
        {
            int sampleRate = capture.WaveFormat.SampleRate;
            var buf = new Complex[fftSize];
            lock (gate)
            {
                // Sin datos hace rato (nada suena: WASAPI no entrega buffers) → silencio
                bool stale = Environment.TickCount64 - lastDataMs > 250;
                for (int i = 0; i < fftSize; i++)
                {
                    float x = stale ? 0 : ring[(ringPos + i) % fftSize];
                    buf[i].X = (float)(x * FastFourierTransform.HannWindow(i, fftSize));
                    buf[i].Y = 0;
                }
            }
            FastFourierTransform.FFT(true, fftLog2, buf);

            var sb = new StringBuilder("{\"status\":\"spectrum\",\"bands\":[");
            for (int b = 0; b < Bands; b++)
            {
                double f0 = MinFreq * Math.Pow(MaxFreq / MinFreq, b / (double)Bands);
                double f1 = MinFreq * Math.Pow(MaxFreq / MinFreq, (b + 1) / (double)Bands);
                int i0 = Math.Max(1, (int)(f0 * fftSize / sampleRate));
                int i1 = Math.Min(fftSize / 2, Math.Max(i0 + 1, (int)(f1 * fftSize / sampleRate)));

                double peak = 0;
                for (int i = i0; i < i1; i++)
                    peak = Math.Max(peak, Math.Sqrt(buf[i].X * buf[i].X + buf[i].Y * buf[i].Y));

                double db    = 20 * Math.Log10(peak + 1e-9) + b * TiltDb;
                double level = Math.Clamp((db - FloorDb) / RangeDb, 0, 1);
                if (b > 0) sb.Append(',');
                sb.Append(level.ToString("0.00", CultureInfo.InvariantCulture));
            }
            sb.Append("]}");
            Console.WriteLine(sb.ToString());
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"[SMTC] spectrum error: {ex.Message}");
        }
    }

    public void Dispose()
    {
        timer.Dispose();
        try { capture.StopRecording(); } catch { }
        capture.Dispose();
        Console.Error.WriteLine("[SMTC] spectrum off");
    }
}
