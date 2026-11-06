#!/usr/bin/env python3
"""Ask every question in qa-questions.txt through the loopback gateway, one fresh
visitor session each, and write qa-results.jsonl (question, answer, tool calls,
cited URLs, whether every cited host is allowed, seconds). Uses the gateway's own
invitation token from frontend/state.json; never prints it.
"""
import json
import re
import sys
import time
import urllib.request
from http.cookiejar import CookieJar
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ALLOWED = {'docs.hydromancer.xyz', 'hydromancer.xyz', 'www.hydromancer.xyz', 'hyperliquid.gitbook.io', 't.me'}
state = json.loads((ROOT / 'frontend/state.json').read_text())
# The gateway sets a Secure session cookie, so go through the published HTTPS origin
# (the tunnel), exactly as a visitor's browser does.
GATEWAY = state.get('publishedOrigin') or sys.exit('frontend/state.json has no publishedOrigin; start the tunnel first')
app_id = json.loads((ROOT / 'runtime/preview-client.json').read_text())['appId']
questions = [q.strip() for q in (ROOT / 'deploy/qa-questions.txt').read_text().splitlines() if q.strip() and not q.startswith('#')]
out = Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / 'deploy/qa-results.jsonl')


def session():
    jar = CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    opener.open(f"{GATEWAY}/start/{state['accessToken']}", timeout=20).read()
    req = urllib.request.Request(f'{GATEWAY}/run/auth/apps/{app_id}/anonymous-session', data=b'{}', method='POST',
                                 headers={'Origin': GATEWAY, 'Content-Type': 'application/json'})
    body = json.loads(opener.open(req, timeout=20).read())
    return opener, body.get('token') or body['data']['token']


def ask(question):
    opener, jwt = session()
    req = urllib.request.Request(f'{GATEWAY}/run/api/chat', method='POST',
                                 data=json.dumps({'messages': [{'role': 'user', 'content': question}]}).encode(),
                                 headers={'Origin': GATEWAY, 'Authorization': f'Bearer {jwt}', 'x-inkeep-app-id': app_id,
                                          'Content-Type': 'application/json', 'Accept': 'text/event-stream'})
    started = time.time()
    text, tools = [], []
    with opener.open(req, timeout=180) as response:
        for raw in response:
            line = raw.decode('utf-8', 'replace').strip()
            if not line.startswith('data:'):
                continue
            try:
                event = json.loads(line[5:].strip())
            except ValueError:
                continue
            if event.get('type') == 'text-delta':
                text.append(event.get('delta', ''))
            elif event.get('type') == 'tool-input-available':
                tools.append({'tool': event.get('toolName'), 'input': event.get('input')})
    answer = ''.join(text).strip()
    urls = sorted(set(re.findall(r'https?://[^\s)\]>"]+', answer)))
    hosts = {re.sub(r'^https?://([^/]+).*$', r'\1', u) for u in urls}
    return {'question': question, 'answer': answer, 'tools': tools, 'urls': urls,
            'hosts_allowed': hosts <= ALLOWED, 'seconds': round(time.time() - started, 1)}


with out.open('w') as handle:
    for index, question in enumerate(questions, 1):
        try:
            result = ask(question)
        except Exception as error:  # record and continue; never silently drop
            result = {'question': question, 'error': str(error)[:300]}
        handle.write(json.dumps(result) + '\n')
        handle.flush()
        print(f"{index:2d}/{len(questions)} {result.get('seconds', '-'):>5}s {'OK ' if result.get('hosts_allowed', False) else 'CHK'} {question[:60]}")
        time.sleep(8)  # stay under the per-minute gateway limit and keep load gentle
print('wrote', out)