// Minimal SSE-over-POST client (no external deps)
// Usage: postSSE(url, { body, headers, signal, onEvent })

export async function postSSE(url, { body, headers = {}, signal, onEvent }) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...headers,
    },
    body: body != null ? JSON.stringify(body) : undefined,
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(text || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }

  if (!res.body) throw new Error('ReadableStream not supported');

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');

  let buffer = '';
  let eventName = '';
  let dataLines = [];

  const flushEvent = () => {
    if (!dataLines.length) return;
    const dataStr = dataLines.join('\n');
    const evt = { event: eventName || 'message', data: dataStr };
    eventName = '';
    dataLines = [];
    onEvent?.(evt);
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      let line = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);

      if (line === '') {
        flushEvent();
        continue;
      }

      if (line.startsWith('event:')) {
        eventName = line.slice('event:'.length).trim();
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice('data:'.length).trimStart());
      }
    }
  }

  // flush trailing
  flushEvent();
}
