/**
 * SystemVolume — volumen maestro de la salida de audio por defecto (Core Audio).
 */

using NAudio.CoreAudioApi;

static class SystemVolume
{
    /** Suma `delta` (−1…1) al volumen, quita el mute si sube, y devuelve el nivel nuevo (0–1). */
    public static float ChangeBy(float delta)
    {
        using var enumerator = new MMDeviceEnumerator();
        using var device     = enumerator.GetDefaultAudioEndpoint(DataFlow.Render, Role.Multimedia);
        var endpoint = device.AudioEndpointVolume;

        float level = Math.Clamp(endpoint.MasterVolumeLevelScalar + delta, 0f, 1f);
        endpoint.MasterVolumeLevelScalar = level;
        if (delta > 0 && endpoint.Mute) endpoint.Mute = false;
        return level;
    }
}
