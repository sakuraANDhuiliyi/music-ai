const env = import.meta.env || {};

const resolveOrigin = () => {
  if (env.VITE_API_ORIGIN) return env.VITE_API_ORIGIN;
  if (typeof window !== 'undefined' && window.location?.origin) return window.location.origin;
  return 'http://localhost:3000';
};

export const APP_CONFIG = {
  apiOrigin: resolveOrigin(),
  requestTimeoutMs: Number(env.VITE_REQUEST_TIMEOUT || 10000),
  errorReporting: {
    enabled: String(env.VITE_ERROR_REPORTING ?? 'true') !== 'false',
    endpoint: '/api/telemetry/client-error',
  },
  endpoints: {
    health: '/api/health',
    aiCreator: '/api/ai-creator',
    aiSectionEdit: '/api/ai-creator/section-edit',
    aiChords: '/api/ai-chords',
    audioToSheet: '/api/audio-to-sheet',
    upload: '/api/upload',
    projects: '/api/projects',
  },
};

export const API_ENDPOINTS = APP_CONFIG.endpoints;

export function apiUrl(pathname) {
  const p = String(pathname || '');
  if (!p) return APP_CONFIG.apiOrigin;
  if (/^https?:\/\//i.test(p)) return p;
  if (p.startsWith('/')) return `${APP_CONFIG.apiOrigin}${p}`;
  return `${APP_CONFIG.apiOrigin}/${p}`;
}

export function reportClientError(payload) {
  if (!APP_CONFIG.errorReporting.enabled) return;
  try {
    const body = {
      ...payload,
      ts: new Date().toISOString(),
      href: typeof window !== 'undefined' ? window.location?.href : '',
      userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    };
    fetch(apiUrl(APP_CONFIG.errorReporting.endpoint), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => {});
  } catch {
    // ignore
  }
}
