export function isStreamError(event) {
  return event.type === 'error' || (event.type === 'data-operation' && event.data?.type === 'error');
}
