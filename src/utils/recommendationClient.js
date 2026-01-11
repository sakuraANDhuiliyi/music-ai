import { apiUrl } from '../config/apiBase.js';

const getToken = () => {
  try {
    return localStorage.getItem('token');
  } catch {
    return null;
  }
};

const normalizeDurationSec = (value) => {
  const num = Number(value) || 0;
  if (num >= 1000) return Math.round(num / 1000);
  return Math.max(0, num);
};

const buildNeteaseItem = (song, extraTags = []) => {
  const id = String(song?.id || '').trim();
  if (!id) return null;
  const title = String(song?.name || '').trim();
  const artistName =
    String(song?.ar?.[0]?.name || '') ||
    String(song?.artists?.[0]?.name || '') ||
    '';
  const coverUrl =
    song?.al?.picUrl ||
    song?.album?.picUrl ||
    song?.album?.artist?.img1v1Url ||
    '';
  const durationSec = normalizeDurationSec(song?.dt ?? song?.duration ?? 0);
  const styleTags = Array.isArray(extraTags) ? extraTags.map((t) => String(t || '').trim()).filter(Boolean) : [];

  return {
    sourceId: id,
    title,
    artistName,
    coverUrl,
    durationSec,
    styleTags,
  };
};

const postBatch = async (items) => {
  if (!items.length) return;
  const token = getToken();
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  await fetch(apiUrl('/api/recommendation-items/batch'), {
    method: 'POST',
    headers,
    body: JSON.stringify({ source: 'netease', items }),
  });
};

export const upsertNeteaseCandidates = async (songs, extraTags = []) => {
  const list = Array.isArray(songs) ? songs : [];
  if (!list.length) return;
  const items = list.map((song) => buildNeteaseItem(song, extraTags)).filter(Boolean);
  if (!items.length) return;

  const chunkSize = 120;
  for (let i = 0; i < items.length; i += chunkSize) {
    const slice = items.slice(i, i + chunkSize);
    try {
      await postBatch(slice);
    } catch {
      // ignore
    }
  }
};

