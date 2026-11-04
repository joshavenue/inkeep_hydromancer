// Drops the model's narration before tool calls ("I'll check the docs...") from the
// UI message stream, and the blank lines it leaves behind, without changing anything
// else about the SSE events. Text is held back only until it is clear whether a tool
// call follows: a text block is released as soon as it exceeds HOLD_CHARS (a real
// answer gets there within a few hundred milliseconds) or when the stream ends.
export const HOLD_CHARS = 240;

export function createAnswerFilter({ holdChars = HOLD_CHARS } = {}) {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let pending = '';          // undecided SSE lines of the current text block
  let pendingChars = 0;      // delta characters held in `pending`
  let holding = false;       // inside a text block that has not been released
  let released = false;      // the current text block has been passed through
  let buffer = '';           // partial SSE line carried between chunks

  const encode = text => encoder.encode(text);

  function handleLine(line) {
    if (!line.startsWith('data:')) return holding ? (pending += line + '\n', '') : line + '\n';
    let event;
    try { event = JSON.parse(line.slice(5).trim()); } catch { return holding ? (pending += line + '\n', '') : line + '\n'; }
    const type = event?.type;
    if (type === 'text-start') {
      holding = true; released = false; pending = line + '\n'; pendingChars = 0;
      return '';
    }
    if (type === 'text-delta' && holding) {
      pending += line + '\n'; pendingChars += (event.delta ?? '').length;
      if (pendingChars > holdChars) { holding = false; released = true; const out = pending; pending = ''; return out; }
      return '';
    }
    if (type === 'text-end' && holding) {
      // Undecided block ended; keep holding until we see what comes next.
      pending += line + '\n';
      return '';
    }
    if (holding && (type === 'tool-input-start' || type === 'tool-input-available' || type === 'tool-input-delta' || type === 'tool-output-available')) {
      // A tool call followed the short text block: that text was narration. Drop it.
      pending = ''; pendingChars = 0; holding = false;
      return line + '\n';
    }
    if (holding) {
      // Any other event after a short text block (finish, data-operation completion,
      // another text-start): the block was a real short answer. Release it.
      const out = pending + line + '\n'; pending = ''; pendingChars = 0; holding = false;
      return out;
    }
    return line + '\n';
  }

  return new TransformStream({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      let index;
      let out = '';
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        out += handleLine(line);
      }
      if (out) controller.enqueue(encode(out));
    },
    flush(controller) {
      let out = '';
      if (buffer) out += handleLine(buffer);
      if (pending) out += pending;   // stream ended on an undecided block: it was the answer
      if (out) controller.enqueue(encode(out));
    },
  });
}
