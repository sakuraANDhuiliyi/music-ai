// Debug script: reads SSE from /api/ai-creator and prints raw chunks + parsed events.
// Run: node tools/debug_ai_creator.mjs

const url = 'http://localhost:3000/api/ai-creator';
const prompt = process.argv.slice(2).join(' ') || '浮游感的和弦进行';

function parseSseChunk(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  const events = [];
  let eventName = '';
  let dataLines = [];

  const flush = () => {
    if (!dataLines.length) return;
    events.push({ event: eventName || 'message', data: dataLines.join('\n') });
    eventName = '';
    dataLines = [];
  };

  for (const line of lines) {
    if (line === '') {
      flush();
      continue;
    }
    if (line.startsWith('event:')) eventName = line.slice(6).trim();
    if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
  }

  return events;
}

(async () => {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    body: JSON.stringify({ prompt }),
  });

  console.log('status', res.status, res.headers.get('content-type'));
  if (!res.ok) {
    console.log(await res.text().catch(() => ''));
    process.exit(1);
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder('utf-8');

  let raw = '';
  const start = Date.now();

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    const chunk = dec.decode(value, { stream: true });
    raw += chunk;

    const events = parseSseChunk(chunk);
    for (const evt of events) {
      let payload;
      try {
        payload = JSON.parse(evt.data);
      } catch {
        payload = evt.data;
      }
      console.log('event', evt.event, payload);
    }

    if (Date.now() - start > 12000) {
      console.log('timeout: 12s');
      break;
    }
  }

  console.log('\n--- raw (first 2KB) ---');
  console.log(raw.replace(/\r/g, '').slice(0, 2048));
})();
