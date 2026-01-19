const impulseCache = new Map();
const urlBufferCache = new Map();

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

const buildImpulseKey = ({ seconds, decay, reverse, sampleRate }) => {
  return `${Number(seconds).toFixed(3)}:${Number(decay).toFixed(3)}:${reverse ? 'r' : 'n'}:${Math.round(sampleRate)}`;
};

const generateImpulseData = (seconds, decay, reverse, sampleRate) => {
  const len = Math.max(1, Math.ceil(seconds * sampleRate));
  const left = new Float32Array(len);
  const right = new Float32Array(len);
  for (let i = 0; i < len; i += 1) {
    const idx = reverse ? len - i - 1 : i;
    const value = (Math.random() * 2 - 1) * Math.pow(1 - idx / len, decay);
    left[i] = value;
    right[i] = value;
  }
  return { left, right };
};

export async function getIrBuffer(ctx, options = {}) {
  const sampleRate = ctx?.sampleRate || 44100;
  const url = String(options.url || '').trim();
  if (url) {
    let raw = urlBufferCache.get(url);
    if (!raw) {
      const res = await fetch(url);
      if (!res.ok) throw new Error('IR 加载失败');
      raw = await res.arrayBuffer();
      urlBufferCache.set(url, raw);
    }
    const input = raw?.slice ? raw.slice(0) : raw;
    return await ctx.decodeAudioData(input);
  }

  const seconds = clamp(Number(options.seconds ?? 1.6), 0.2, 8);
  const decay = clamp(Number(options.decay ?? 2.2), 0.1, 10);
  const reverse = Boolean(options.reverse);
  const key = buildImpulseKey({ seconds, decay, reverse, sampleRate });

  let cached = impulseCache.get(key);
  if (!cached) {
    cached = generateImpulseData(seconds, decay, reverse, sampleRate);
    impulseCache.set(key, cached);
  }

  const buffer = ctx.createBuffer(2, cached.left.length, sampleRate);
  buffer.getChannelData(0).set(cached.left);
  buffer.getChannelData(1).set(cached.right);
  return buffer;
}

export function clearIrCache() {
  impulseCache.clear();
  urlBufferCache.clear();
}
