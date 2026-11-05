"""Capture/refresh tests run fully offline against synthetic fixtures (no network)."""
import json

import pytest

import capture_public_sources as cps
import knowledge as k
from refresh import refresh

SITE_HTML = b'''<!doctype html><html><head><title>Pricing | Hydromancer</title>
<meta name="description" content="Transparent,   predictable pricing"></head>
<body><header><nav><a href="/x">Menu item must not appear</a></nav></header>
<main><h1>Transparent and predictable pricing</h1>
<p>Starter is <strong>$300</strong> per month with 500k tokens included.</p>
<ul><li>REST weight budgets</li><li>Read the <a href="https://docs.hydromancer.xyz/readme/pricing">docs</a></li></ul>
<table><tr><th>Plan</th><th>Price</th></tr><tr><td>Starter</td><td>$300</td></tr></table>
<pre><code>curl -X POST https://api.hydromancer.xyz/info \\
  -d '{"type":"userRateLimit"}'</code></pre>
<script>var secret = "never";</script></main>
<footer>Footer text must not appear</footer></body></html>'''

DOCS_INDEX = b'''# Hydromancer
- [Pricing](https://docs.hydromancer.xyz/readme/pricing.md): Plans
- [userFills](https://docs.hydromancer.xyz/readme/rest-api/historical-data/userfills.md): Fills
- [l2Book](https://docs.hydromancer.xyz/readme/rest-api/market-data/l2book.md)
- [Evil](https://evil.example/readme/x.md): must be ignored
- [Private](https://docs.hydromancer.xyz/readme/x.md?token=1): must be ignored
'''
NATIVE_INDEX = b'''# Hyperliquid
- [Rate limits and user limits](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits.md)
- [Brand kit](https://hyperliquid.gitbook.io/hyperliquid-docs/brand-kit.md): excluded section
'''
SITEMAP = b'<sitemapindex><sitemap><loc>https://hydromancer.xyz/sitemaps/pages.xml</loc></sitemap></sitemapindex>'
PAGES = b'<urlset><url><loc>https://hydromancer.xyz/pricing</loc></url><url><loc>https://hydromancer.xyz/missing</loc></url></urlset>'
TELEGRAM_HTML = b'''<!doctype html><html><head><title>Telegram: Contact @xenoflux</title>
<meta property="og:title" content="Xeno"><meta property="og:description" content="founder of Hydromancer hydromancer.xyz"></head>
<body><div class="tgme_page"><div class="tgme_page_title"><span>Xeno</span></div><div>@xenoflux</div>
<div class="tgme_page_description">founder of Hydromancer hydromancer.xyz</div></div></body></html>'''
NATIVE_MD = b'> For the complete documentation index, see [llms.txt](x).\n\n# Rate limits and user limits\n\nREST requests share an aggregated weight limit of 1200 per minute.\n'
RESPONSES = {
    cps.DOCS_INDEX: DOCS_INDEX, cps.NATIVE_INDEX: NATIVE_INDEX, cps.SITE_SITEMAP: SITEMAP,
    'https://hydromancer.xyz/sitemaps/pages.xml': PAGES, 'https://hydromancer.xyz/pricing': SITE_HTML,
    'https://docs.hydromancer.xyz/readme/pricing.md': b'# Pricing\n\nStarter $300.\n',
    'https://docs.hydromancer.xyz/readme/rest-api/historical-data/userfills.md': b'# userFills\n\nGet fills.\n',
    'https://docs.hydromancer.xyz/readme/rest-api/market-data/l2book.md': b'# l2Book\n\nBook snapshot.\n',
    'https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits.md': NATIVE_MD,
    'https://t.me/xenoflux': TELEGRAM_HTML,
}


def fake_fetch(url, provider):
    assert cps.allowed(url, provider), f'fetch outside allowlist: {url}'
    body = RESPONSES.get(url)
    return (200, body) if body is not None else (404, b'')


def test_html_to_markdown_keeps_main_content_only():
    title, text = cps.html_to_markdown(SITE_HTML.decode(), 'https://hydromancer.xyz/pricing')
    assert title == 'Pricing'
    assert text.startswith('Source: https://hydromancer.xyz/pricing\nTitle: Pricing\nDescription: Transparent, predictable pricing\n')
    assert '# Transparent and predictable pricing' in text
    assert 'Starter is $300 per month with 500k tokens included.' in text
    assert '- REST weight budgets' in text
    assert '[docs](https://docs.hydromancer.xyz/readme/pricing)' in text
    assert '| Plan | Price |' in text and '| Starter | $300 |' in text
    assert "curl -X POST https://api.hydromancer.xyz/info \\\n  -d '{\"type\":\"userRateLimit\"}'" in text
    for leaked in ('Menu item', 'Footer text', 'secret', 'never'):
        assert leaked not in text


def test_allowlist_rejects_other_hosts_queries_and_credentials():
    for url in ('https://evil.example/', 'http://hydromancer.xyz/', 'https://hydromancer.xyz.evil.example/',
                'https://user@hydromancer.xyz/', 'https://hydromancer.xyz/?q=1', 'https://hydromancer.xyz/#f'):
        assert not cps.allowed(url, 'site')
        with pytest.raises(ValueError, match='allowlist'):
            cps.fetch(url, 'site')
    assert cps.allowed('https://hydromancer.xyz/pricing', 'site')
    assert not cps.allowed('https://hydromancer.xyz/pricing', 'hydromancer')


def test_index_parsing_filters_hosts_and_native_sections():
    assert [u for _, u, _ in cps.parse_index(DOCS_INDEX.decode(), 'hydromancer')] == [
        'https://docs.hydromancer.xyz/readme/pricing.md',
        'https://docs.hydromancer.xyz/readme/rest-api/historical-data/userfills.md',
        'https://docs.hydromancer.xyz/readme/rest-api/market-data/l2book.md']
    assert cps.native_pages(fake_fetch) == [('Rate limits and user limits | Hyperliquid Docs',
        'https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/rate-limits-and-user-limits.md')]
    assert cps.site_pages(fake_fetch) == ['https://hydromancer.xyz/pricing', 'https://hydromancer.xyz/missing']
    assert cps.section_for('hydromancer', 'https://docs.hydromancer.xyz/readme/rest-api/historical-data/userfills.md') == 'rest-a'
    assert cps.section_for('hydromancer', 'https://docs.hydromancer.xyz/readme/rest-api/market-data/l2book.md') == 'rest-b'
    assert cps.section_for('hydromancer', 'https://docs.hydromancer.xyz/readme/websocket/candles.md') == 'websocket'
    assert cps.section_for('hydromancer', 'https://docs.hydromancer.xyz/reservoir.md') == 'platform'


def test_capture_writes_catalog_and_skips_failures(tmp_path):
    report = cps.capture(tmp_path / 'out', fetch_impl=fake_fetch, delay=0)
    assert report == {'captured': 6, 'skipped': 1, 'per_provider': {'hydromancer': 3, 'site': 1, 'native': 1, 'telegram': 1},
                      'output': str(tmp_path / 'out')}
    catalog = json.loads((tmp_path / 'out/catalog.json').read_text())
    assert catalog['format_version'] == 1
    ids = [s['id'] for s in catalog['sources']]
    assert ids == ['hydro-1', 'hydro-2', 'hydro-3', 'site-1', 'native-1', 'tg-1']
    telegram = next(s for s in catalog['sources'] if s['provider'] == 'telegram')
    assert telegram['title'].startswith('Xeno (@xenoflux), founder') and telegram['section'] == 'contact'
    assert b'founder of Hydromancer' in (tmp_path / 'out/captures/tg-1.md').read_bytes()
    site = next(s for s in catalog['sources'] if s['provider'] == 'site')
    assert site['title'] == 'Pricing' and site['section'] == 'site' and site['url'] == 'https://hydromancer.xyz/pricing'
    assert 'converted to Markdown' in site['snapshot_date_basis']
    assert (tmp_path / 'out/captures/site-1.md').read_bytes().startswith(b'Source: https://hydromancer.xyz/pricing')
    assert (tmp_path / 'out/captures/native-1.txt').read_bytes() == NATIVE_MD
    assert json.loads((tmp_path / 'out/skipped.json').read_text()) == [{'url': 'https://hydromancer.xyz/missing', 'status': 404, 'bytes': 0}]


def test_refresh_builds_a_searchable_index_from_all_three_sources(tmp_path, monkeypatch):
    summary = refresh(tmp_path / 'data', delay=0, fetch_impl=fake_fetch)
    assert summary['indexed'] == 6 and summary['provider_counts'] == {'hydromancer': 3, 'site': 1, 'native': 1, 'telegram': 1}
    db = tmp_path / 'data/public-docs.sqlite'
    assert db.is_file()
    hits = k.search('pricing plans', 8, db=db)['results']
    assert {h['provider'] for h in hits} >= {'hydromancer', 'site'}
    site_hit = next(h for h in hits if h['provider'] == 'site')
    assert site_hit['url'] == 'https://hydromancer.xyz/pricing'
    assert k.fetch(site_hit['id'], db=db)['text'].startswith('Source: https://hydromancer.xyz/pricing')
    native = k.search('native API rate limits for a small bot', 4, db=db)['results'][0]
    assert native['title'] == 'Rate limits and user limits | Hyperliquid Docs'
    founder = k.search('who is the founder of Hydromancer', 4, db=db)['results'][0]
    assert founder['url'] == 'https://t.me/xenoflux' and 'founder of Hydromancer' in founder['excerpt']
    assert not list((tmp_path / 'data').glob('capture-*/captures'))

def test_inline_svg_titles_do_not_leak_into_the_page_title():
    html = (b'<!doctype html><html><head><title>Why teams choose Hydromancer | Hydromancer</title></head>'
            b'<body><main><h1>Why</h1><svg><title>badge 13</title></svg><svg><title>badge 13</title></svg>'
            b'<p>Body text.</p></main></body></html>')
    title, _ = cps.html_to_markdown(html.decode(), 'https://hydromancer.xyz/why-hydromancer')
    assert title == 'Why teams choose Hydromancer'
