const baseUrl = process.env.SMOKE_BASE_URL || 'http://localhost:3000';
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS || 8000);
const email = process.env.SMOKE_EMAIL || '';
const password = process.env.SMOKE_PASSWORD || '';
const username = process.env.SMOKE_USERNAME || `smoke_${Date.now()}`;

const fetchWithTimeout = async (url, options = {}) => {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
};

const log = (label, ok, detail = '') => {
  const status = ok ? 'OK' : 'FAIL';
  console.log(`${label}: ${status}${detail ? ` (${detail})` : ''}`);
};

const readTextSafe = async (res) => {
  try {
    return await res.text();
  } catch {
    return '';
  }
};

const readJsonSafe = async (res) => {
  try {
    return await res.json();
  } catch {
    return null;
  }
};

const testHealth = async () => {
  const res = await fetchWithTimeout(`${baseUrl}/api/health`);
  const ok = res.ok;
  log('health', ok, String(res.status));
};

const testAiCreator = async () => {
  const res = await fetchWithTimeout(`${baseUrl}/api/ai-creator`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({ prompt: 'smoke test' }),
  });
  log('ai-creator', res.ok, String(res.status));
};

const loginOrRegister = async () => {
  if (!email || !password) return null;
  const loginRes = await fetchWithTimeout(`${baseUrl}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (loginRes.ok) {
    const data = await readJsonSafe(loginRes);
    return data?.token || null;
  }

  const regRes = await fetchWithTimeout(`${baseUrl}/api/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, username }),
  });
  if (!regRes.ok) return null;
  const data = await readJsonSafe(regRes);
  return data?.token || null;
};

const testProjectSave = async (token) => {
  if (!token) {
    log('projects:create', false, 'SKIP no token');
    return;
  }
  const res = await fetchWithTimeout(`${baseUrl}/api/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      title: `Smoke Project ${Date.now()}`,
      cover: 'linear-gradient(135deg,#60a5fa,#34d399)',
      tags: ['smoke'],
    }),
  });
  log('projects:create', res.ok, String(res.status));
};

const testUpload = async (token) => {
  if (!token) {
    log('upload', false, 'SKIP no token');
    return;
  }
  const fd = new FormData();
  fd.append('file', new Blob(['smoke'], { type: 'text/plain' }), 'smoke.txt');
  const res = await fetchWithTimeout(`${baseUrl}/api/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });
  log('upload', res.ok, String(res.status));
};

const testAudioToSheet = async (token) => {
  if (!token) {
    log('audio-to-sheet', false, 'SKIP no token');
    return;
  }
  const res = await fetchWithTimeout(`${baseUrl}/api/audio-to-sheet`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: new FormData(),
  });
  const text = await readTextSafe(res);
  log('audio-to-sheet', res.ok, String(res.status || text));
};

const run = async () => {
  console.log(`Smoke against ${baseUrl}`);
  await testHealth();
  await testAiCreator();

  const token = await loginOrRegister();
  if (!token) {
    log('auth', false, 'SKIP set SMOKE_EMAIL/SMOKE_PASSWORD');
    return;
  }
  log('auth', true);
  await testProjectSave(token);
  await testUpload(token);
  await testAudioToSheet(token);
};

run().catch((err) => {
  console.error('Smoke failed:', err?.message || err);
  process.exit(1);
});
