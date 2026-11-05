"""Shared import, index and public fetch limits (UTF-8 bytes vs characters)."""

MAX_DOCUMENT_BYTES = 2 * 1024 * 1024
# A valid UTF-8 document has no more characters than bytes. Thus every next_offset
# for an accepted document fits this inclusive character-offset bound.
MAX_FETCH_OFFSET = MAX_DOCUMENT_BYTES
FETCH_PAGE_CHARS = 10000
MAX_CATALOG_SOURCES = 1000
DOCUMENT_ID_PATTERN = r'^(hydro|native|site|tg)-[0-9]{1,4}$'

# Closed set of public publishers. Every ledger record, capture and index row
# belongs to exactly one of these hosts; nothing from any other host is indexed.
#   hydromancer: docs.hydromancer.xyz (GitBook, Markdown via the .md suffix)
#   native:      hyperliquid.gitbook.io, the public Hyperliquid API documentation
#   site:        hydromancer.xyz, the marketing site (products, pricing, blog, customers)
#   telegram:    t.me, one public profile: Xeno (@xenoflux), the founder, as linked from the contact pages
PROVIDERS = {
    'hydromancer': {'prefix': 'hydro', 'host': 'docs.hydromancer.xyz',
                    'sections': ('rest-a', 'rest-b', 'websocket', 'platform'),
                    'suffix': '.md', 'directory': 'sources'},
    'native': {'prefix': 'native', 'host': 'hyperliquid.gitbook.io',
               'sections': ('native',), 'suffix': '.txt', 'directory': 'pages'},
    'site': {'prefix': 'site', 'host': 'hydromancer.xyz',
             'sections': ('site',), 'suffix': '.md', 'directory': 'sources'},
    'telegram': {'prefix': 'tg', 'host': 't.me',
                 'sections': ('contact',), 'suffix': '.md', 'directory': 'sources'},
}
SECTION_PROVIDER = {section: provider for provider, spec in PROVIDERS.items() for section in spec['sections']}
SECTIONS = tuple(SECTION_PROVIDER)


def read_document(path):
    """Bound memory before decoding/hashing, including direct ledger builds."""
    with path.open('rb') as handle:
        data = handle.read(MAX_DOCUMENT_BYTES + 1)
    if len(data) > MAX_DOCUMENT_BYTES:
        raise ValueError('Capture exceeds 2 MiB')
    return data