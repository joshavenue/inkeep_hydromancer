"""Shared import, index and public fetch limits (UTF-8 bytes vs characters)."""

MAX_DOCUMENT_BYTES = 2 * 1024 * 1024
# A valid UTF-8 document has no more characters than bytes. Thus every next_offset
# for an accepted document fits this inclusive character-offset bound.
MAX_FETCH_OFFSET = MAX_DOCUMENT_BYTES
FETCH_PAGE_CHARS = 10000
DOCUMENT_ID_PATTERN = r'^(hydro|native)-[0-9]{1,4}$'


def read_document(path):
    """Bound memory before decoding/hashing, including direct ledger builds."""
    with path.open('rb') as handle:
        data = handle.read(MAX_DOCUMENT_BYTES + 1)
    if len(data) > MAX_DOCUMENT_BYTES:
        raise ValueError('Capture exceeds 2 MiB')
    return data
