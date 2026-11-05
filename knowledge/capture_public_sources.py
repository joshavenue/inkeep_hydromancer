"""Capture the three public knowledge sources into reviewable local files.

Sources (closed allowlist, nothing else is ever fetched):
  docs.hydromancer.xyz      every page listed in its llms.txt, as GitBook Markdown (.md)
  hydromancer.xyz           every URL in the public sitemaps, HTML converted to Markdown
  hyperliquid.gitbook.io    the developer, trading and HyperCore sections of its llms.txt
  t.me/xenoflux             the founder's public Telegram profile, which the contact pages link to

The result is a catalog (format_version 1) plus one capture file per page, ready
for import_snapshot.py and knowledge.py. No model, credential, login, cookie or
private URL is involved. Pages that do not return HTTP 200 are skipped and
reported, never substituted.
"""
import argparse
from datetime import datetime, timezone
import hashlib
from html import unescape
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import sys
import time
import urllib.error
import urllib.request

from contracts import MAX_CATALOG_SOURCES, MAX_DOCUMENT_BYTES, PROVIDERS

ROOT = Path(__file__).resolve().parent
USER_AGENT = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) '
              'Chrome/130.0 Safari/537.36 HydromancerDocsCapture/1.0')
DOCS_INDEX = 'https://docs.hydromancer.xyz/llms.txt'
NATIVE_INDEX = 'https://hyperliquid.gitbook.io/hyperliquid-docs/llms.txt'
SITE_SITEMAP = 'https://hydromancer.xyz/sitemap.xml'
# The only Telegram page ever fetched: the profile both contact pages point to.
TELEGRAM_PAGES = [('Xeno (@xenoflux), founder of Hydromancer, on Telegram', 'https://t.me/xenoflux')]
# Hyperliquid documentation sections a builder needs when comparing the native
# API with Hydromancer. Onboarding, brand, points and similar pages are excluded.
NATIVE_PATHS = ('for-developers/', 'historical-data.md', 'trading/', 'hypercore/',
                'hyperliquid-improvement-proposals-hips/')
INDEX_LINE = re.compile(r'^- \[([^\]]+)\]\((https://[^)\s]+)\)(?::\s*(.*))?$', re.M)


def allowed(url, provider):
    spec = PROVIDERS[provider]
    return url.startswith(f'https://{spec["host"]}/') and '?' not in url and '#' not in url and '@' not in url


def fetch(url, provider, *, opener=None, timeout=30):
    """HTTPS GET of an allowlisted public URL. Returns (status, bytes); no redirects followed."""
    if not allowed(url, provider):
        raise ValueError(f'URL outside the public allowlist for {provider}: {url}')
    request = urllib.request.Request(url, headers={'User-Agent': USER_AGENT, 'Accept': 'text/html,text/markdown,text/plain,*/*'})
    opener = opener or urllib.request.build_opener(NoRedirect())
    try:
        with opener.open(request, timeout=timeout) as response:
            return response.status, response.read(MAX_DOCUMENT_BYTES + 1)
    except urllib.error.HTTPError as error:
        return error.code, b''


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class MainText(HTMLParser):
    """Convert a hydromancer.xyz page to Markdown: headings, paragraphs, lists, tables, code, links."""
    SKIP = {'script', 'style', 'svg', 'noscript', 'nav', 'footer', 'header', 'form', 'button',
            'template', 'iframe', 'dialog', 'video', 'audio', 'canvas'}
    BLOCK = {'p', 'div', 'section', 'article', 'ul', 'ol', 'blockquote', 'figure', 'figcaption', 'br', 'hr'}

    def __init__(self, base):
        super().__init__(convert_charrefs=True)
        self.base = base
        self.parts, self.skip, self.main, self.seen_main = [], 0, 0, False
        self.pre, self.href, self.cell, self.row, self.list_depth = 0, None, None, None, 0
        self.title, self.description, self.in_title = '', '', False
        self.og_title, self.og_description = '', ''

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'title':
            self.in_title = True
        if tag == 'meta' and attrs.get('name') == 'description':
            self.description = attrs.get('content', '')
        if tag == 'meta' and attrs.get('property') == 'og:title':
            self.og_title = attrs.get('content', '')
        if tag == 'meta' and attrs.get('property') == 'og:description':
            self.og_description = attrs.get('content', '')
        if tag == 'main':
            self.main += 1
            self.seen_main = True
        if tag in self.SKIP:
            self.skip += 1
        if not self.active():
            return
        if tag in ('h1', 'h2', 'h3', 'h4', 'h5', 'h6'):
            self.parts.append('\n\n' + '#' * int(tag[1]) + ' ')
        elif tag == 'pre':
            self.pre += 1
            self.parts.append('\n\n```\n')
        elif tag == 'code' and not self.pre:
            self.parts.append('`')
        elif tag == 'li':
            self.parts.append('\n' + '  ' * max(self.list_depth - 1, 0) + '- ')
        elif tag in ('ul', 'ol'):
            self.list_depth += 1
            self.parts.append('\n')
        elif tag == 'tr':
            self.row = []
        elif tag in ('td', 'th'):
            self.cell = []
        elif tag == 'a' and (attrs.get('href') or '').startswith('http'):
            self.href = attrs['href']
            self.parts.append('[')
        elif tag in self.BLOCK:
            self.parts.append('\n\n' if tag != 'br' else '\n')

    def handle_endtag(self, tag):
        if tag == 'title':
            self.in_title = False
        if tag == 'main':
            self.main -= 1
        if tag in self.SKIP:
            self.skip -= 1
            return
        if not self.active():
            return
        if tag in ('h1', 'h2', 'h3', 'h4', 'h5', 'h6'):
            self.parts.append('\n\n')
        elif tag == 'pre':
            self.pre -= 1
            self.parts.append('\n```\n\n')
        elif tag == 'code' and not self.pre:
            self.parts.append('`')
        elif tag in ('ul', 'ol'):
            self.list_depth -= 1
            self.parts.append('\n')
        elif tag in ('td', 'th') and self.cell is not None and self.row is not None:
            self.row.append(' '.join(''.join(self.cell).split()))
            self.cell = None
        elif tag == 'tr' and self.row is not None:
            self.parts.append('\n| ' + ' | '.join(self.row) + ' |')
            self.row = None
        elif tag == 'table':
            self.parts.append('\n\n')
        elif tag == 'a' and self.href:
            self.parts.append(f']({self.href})')
            self.href = None
        elif tag in self.BLOCK:
            self.parts.append('\n\n')

    def handle_data(self, data):
        if self.in_title:
            self.title += data
            return
        if not self.active():
            return
        if self.cell is not None:
            self.cell.append(data)
        elif self.pre:
            self.parts.append(data)
        else:
            self.parts.append(re.sub(r'\s+', ' ', data))

    def active(self):
        return self.skip == 0 and (self.main > 0 or not self.seen_main)

    def markdown(self):
        text = ''.join(self.parts)
        text = re.sub(r'[ \t]+\n', '\n', text)
        text = re.sub(r'\n{3,}', '\n\n', text)
        return text.strip()


def html_to_markdown(html, url, title=None):
    parser = MainText(url)
    parser.feed(html)
    parser.close()
    body = parser.markdown()
    title = title or re.sub(r'\s*\|\s*Hydromancer\s*$', '', ' '.join(parser.title.split())) or url
    head = f'Source: {url}\nTitle: {title}\n'
    description = parser.description or parser.og_description
    if description:
        head += f'Description: {" ".join(description.split())}\n'
    return title, head + '\n' + body + '\n'


def parse_index(text, provider):
    """Entries of a GitBook llms.txt: (title, url, description), allowlisted host only."""
    entries = []
    for title, url, description in INDEX_LINE.findall(text):
        if allowed(url, provider):
            entries.append((title.strip(), url, (description or '').strip()))
    return entries


def parse_sitemap(xml, provider):
    return [loc for loc in re.findall(r'<loc>\s*([^<\s]+)\s*</loc>', xml) if allowed(loc, provider)]


def docs_pages(fetch_impl):
    status, body = fetch_impl(DOCS_INDEX, 'hydromancer')
    if status != 200:
        raise RuntimeError(f'docs llms.txt returned HTTP {status}')
    return [(title, url) for title, url, _ in parse_index(body.decode('utf-8'), 'hydromancer')]


def native_pages(fetch_impl):
    status, body = fetch_impl(NATIVE_INDEX, 'native')
    if status != 200:
        raise RuntimeError(f'Hyperliquid llms.txt returned HTTP {status}')
    pages = []
    for title, url, _ in parse_index(body.decode('utf-8'), 'native'):
        path = url.split('/hyperliquid-docs/', 1)[-1]
        if path.startswith(NATIVE_PATHS):
            pages.append((f'{title} | Hyperliquid Docs', url))
    return pages


def telegram_pages(fetch_impl):
    return list(TELEGRAM_PAGES)


def site_pages(fetch_impl):
    status, body = fetch_impl(SITE_SITEMAP, 'site')
    if status != 200:
        raise RuntimeError(f'sitemap.xml returned HTTP {status}')
    urls = []
    for child in parse_sitemap(body.decode('utf-8'), 'site'):
        if child.endswith('.xml'):
            status, nested = fetch_impl(child, 'site')
            if status == 200:
                urls += parse_sitemap(nested.decode('utf-8'), 'site')
        else:
            urls.append(child)
    return list(dict.fromkeys(urls))


def section_for(provider, url):
    if provider != 'hydromancer':
        return PROVIDERS[provider]['sections'][0]
    path = url.split('docs.hydromancer.xyz/', 1)[1]
    if path.startswith('readme/rest-api/'):
        rest_b = ('outcomes', 'vaults', 'roles-and-agents', 'metadata', 'token-deployment', 'borrow-lend',
                  'staking', 'delegations', 'fees', 'api-usage', 'subaccounts', 'candlesticks', 'market-data')
        return 'rest-b' if path.split('/')[2].split('.')[0] in rest_b else 'rest-a'
    if path.startswith('readme/websocket'):
        return 'websocket'
    return 'platform'


def capture(output, *, providers=('hydromancer', 'site', 'native', 'telegram'), fetch_impl=fetch, delay=0.25,
            limit=None, log=print):
    """Write <output>/captures/<id>.<ext> and <output>/catalog.json. Returns a report dict."""
    output = Path(output)
    captures = output / 'captures'
    captures.mkdir(parents=True, exist_ok=True)
    listings = {'hydromancer': docs_pages, 'site': site_pages, 'native': native_pages, 'telegram': telegram_pages}
    sources, skipped = [], []
    for provider in providers:
        spec = PROVIDERS[provider]
        pages = listings[provider](fetch_impl)
        if limit:
            pages = pages[:limit]
        for number, page in enumerate(pages, start=1):
            title, url = page if isinstance(page, tuple) else (None, page)
            fetch_url = url if provider != 'hydromancer' or url.endswith('.md') else url + '.md'
            status, body = fetch_impl(fetch_url, provider)
            if status != 200 or not body or len(body) > MAX_DOCUMENT_BYTES:
                skipped.append({'url': url, 'status': status, 'bytes': len(body)})
                log(f'skip {status} {url}')
                continue
            retrieved = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
            if provider in ('site', 'telegram'):
                title, text = html_to_markdown(body.decode('utf-8', 'replace'), url, title)
                data = text.encode('utf-8')
                basis = 'automated public HTTPS capture; HTML main content converted to Markdown at retrieval time'
            else:
                data = body
                text = body.decode('utf-8', 'replace')
                if provider == 'native' and (text.lstrip().startswith('<') or 'llms.txt' not in text[:400]):
                    skipped.append({'url': url, 'status': status, 'bytes': len(body), 'reason': 'not a Markdown export'})
                    log(f'skip not-markdown {url}')
                    continue
                basis = 'automated public HTTPS capture of the publisher Markdown export at retrieval time'
            identifier = f'{spec["prefix"]}-{number}'
            (captures / (identifier + spec['suffix'])).write_bytes(data)
            sources.append({'id': identifier, 'url': url, 'title': title or url, 'provider': provider,
                            'section': section_for(provider, url), 'snapshot_date': retrieved,
                            'snapshot_date_basis': basis, 'sha256': hashlib.sha256(data).hexdigest()})
            if delay:
                time.sleep(delay)
    if len(sources) > MAX_CATALOG_SOURCES:
        raise RuntimeError(f'{len(sources)} sources exceed the catalog limit of {MAX_CATALOG_SOURCES}')
    catalog = {'format_version': 1, 'description': 'Automated public capture; see capture_public_sources.py.',
               'captured_at': datetime.now(timezone.utc).replace(microsecond=0).isoformat(), 'sources': sources}
    (output / 'catalog.json').write_text(json.dumps(catalog, indent=2) + '\n', encoding='utf-8')
    (output / 'skipped.json').write_text(json.dumps(skipped, indent=2) + '\n', encoding='utf-8')
    counts = {p: sum(1 for s in sources if s['provider'] == p) for p in providers}
    return {'captured': len(sources), 'skipped': len(skipped), 'per_provider': counts, 'output': str(output)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--output', type=Path, default=ROOT / 'data/capture', help='Directory for captures/ and catalog.json')
    parser.add_argument('--providers', nargs='+', default=['hydromancer', 'site', 'native', 'telegram'], choices=sorted(PROVIDERS))
    parser.add_argument('--limit', type=int, default=None, help='Capture at most N pages per provider (smoke test)')
    parser.add_argument('--delay', type=float, default=0.25, help='Seconds between requests')
    args = parser.parse_args()
    report = capture(args.output, providers=tuple(args.providers), delay=args.delay, limit=args.limit,
                     log=lambda line: print(line, file=sys.stderr))
    print(json.dumps(report, indent=2))