const scheduleIdle = (cb) => {
  if (typeof requestIdleCallback === 'function') {
    return requestIdleCallback(cb, { timeout: 120 });
  }
  return window.setTimeout(() => cb({ timeRemaining: () => 0, didTimeout: true }), 0);
};

/**
 * Compute min/max waveform peaks from an AudioBuffer in a non-blocking way.
 *
 * Notes:
 * - Returns data suitable for quick canvas rendering.
 * - Uses requestIdleCallback when available; falls back to time-sliced setTimeout.
 *
 * @param {AudioBuffer} audioBuffer
 * @param {{
 *  maxPoints?: number,
 *  minPoints?: number,
 *  timeSliceMs?: number,
 * }=} options
 * @returns {Promise<{
 *  kind: 'minmax',
 *  points: number,
 *  channels: number,
 *  sampleRate: number,
 *  samplesPerPeak: number,
 *  duration: number,
 *  min: Float32Array,
 *  max: Float32Array,
 * }>}
 */
export function computePeaks(audioBuffer, options = {}) {
  const maxPoints = Math.max(256, Number(options.maxPoints) || 4096);
  const minPoints = Math.max(128, Math.min(maxPoints, Number(options.minPoints) || 1024));
  const timeSliceMs = Math.max(4, Number(options.timeSliceMs) || 10);

  if (!audioBuffer) {
    return Promise.reject(new Error('computePeaks: missing AudioBuffer'));
  }

  const channels = Math.max(1, Number(audioBuffer.numberOfChannels || 1));
  const length = Math.max(0, Number(audioBuffer.length || 0));
  const sampleRate = Math.max(1, Number(audioBuffer.sampleRate || 44100));
  const duration = Math.max(0, Number(audioBuffer.duration || 0));

  const targetPoints = Math.max(minPoints, Math.min(maxPoints, Math.ceil(length / 2048)));
  const samplesPerPeak = Math.max(1, Math.ceil(length / targetPoints));
  const points = Math.max(1, Math.ceil(length / samplesPerPeak));

  const min = new Float32Array(points);
  const max = new Float32Array(points);
  min.fill(1);
  max.fill(-1);

  const channelData = Array.from({ length: channels }, (_, ch) => audioBuffer.getChannelData(ch));

  return new Promise((resolve) => {
    let peakIndex = 0;

    const computeOne = (idx) => {
      const start = idx * samplesPerPeak;
      const end = Math.min(length, start + samplesPerPeak);
      let mn = 1;
      let mx = -1;
      for (let ch = 0; ch < channels; ch += 1) {
        const data = channelData[ch];
        for (let i = start; i < end; i += 1) {
          const v = data[i] || 0;
          if (v < mn) mn = v;
          if (v > mx) mx = v;
        }
      }
      min[idx] = mn;
      max[idx] = mx;
    };

    const work = (deadline) => {
      const startTs = performance.now();

      while (peakIndex < points) {
        computeOne(peakIndex);
        peakIndex += 1;

        const remaining = typeof deadline?.timeRemaining === 'function' ? deadline.timeRemaining() : 0;
        const timeBudgetExceeded = performance.now() - startTs >= timeSliceMs;
        if (timeBudgetExceeded || (!deadline?.didTimeout && remaining <= 1)) break;
      }

      if (peakIndex < points) {
        scheduleIdle(work);
        return;
      }

      resolve({
        kind: 'minmax',
        points,
        channels,
        sampleRate,
        samplesPerPeak,
        duration,
        min,
        max,
      });
    };

    scheduleIdle(work);
  });
}

