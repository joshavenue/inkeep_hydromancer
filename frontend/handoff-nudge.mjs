// After a long conversation the assistant should hand the visitor to a person.
// This appends a fixed footer to the answer stream once the conversation has
// more than HANDOFF_AFTER_EXCHANGES user messages. Done in the gateway so it
// does not depend on the model counting turns.
export const HANDOFF_AFTER_EXCHANGES = 10;
export const HANDOFF_TEXT = "\n\nWe have covered a lot in this chat. For anything still open, the fastest route is to speak to Xeno, Hydromancer's founder, on Telegram: [@xenoflux](https://t.me/xenoflux).";

export function exchangeCount(messages) {
  return Array.isArray(messages) ? messages.filter(m => m && m.role === 'user').length : 0;
}

export function needsHandoff(messages, after = HANDOFF_AFTER_EXCHANGES) {
  return exchangeCount(messages) > after;
}

// Inserts one text block carrying HANDOFF_TEXT just before the stream's closing
// events (the completion data-operation, a finish event, or [DONE]). If none of
// those appear, the footer is appended at the end of the stream.
export function createHandoffNudge({ text = HANDOFF_TEXT } = {}) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = '';
  let done = false;
  let lastTextId = 'handoff';
  const block = () => {
    const id = `${lastTextId}-handoff`;
    return [
      `data: ${JSON.stringify({ type: 'text-start', id })}`,
      `data: ${JSON.stringify({ type: 'text-delta', id, delta: text })}`,
      `data: ${JSON.stringify({ type: 'text-end', id })}`,
    ].join('\n\n') + '\n\n';
  };
  function handleLine(line) {
    if (done || !line.startsWith('data:')) return line + '\n';
    const raw = line.slice(5).trim();
    if (raw === '[DONE]') { done = true; return block() + line + '\n'; }
    let event;
    try { event = JSON.parse(raw); } catch { return line + '\n'; }
    if (event?.type === 'text-start' && event.id) lastTextId = event.id;
    const closing = event?.type === 'finish' || (event?.type === 'data-operation' && event.data?.type === 'completion');
    if (closing) { done = true; return block() + line + '\n'; }
    return line + '\n';
  }
  return new TransformStream({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      let index, out = '';
      while ((index = buffer.indexOf('\n')) >= 0) {
        out += handleLine(buffer.slice(0, index));
        buffer = buffer.slice(index + 1);
      }
      if (out) controller.enqueue(encoder.encode(out));
    },
    flush(controller) {
      let out = buffer ? handleLine(buffer) : '';
      if (!done) { out += block(); done = true; }
      if (out) controller.enqueue(encoder.encode(out));
    },
  });
}
