export const getMusicBridge = () => {
  if (typeof window === 'undefined') return null;
  return window.__museaiMusic || null;
};

export const playNeteaseTrack = (trackId) => {
  const id = String(trackId || '').trim();
  if (!id) return false;
  const bridge = getMusicBridge();
  const setters = bridge?.setters;
  if (!setters) return false;
  try {
    setters.setIsShow(true);
  } catch {}
  try {
    setters.setMusicInfo(id);
  } catch {
    return false;
  }
  return true;
};

