#!/usr/bin/env python3
"""Ask the running assistant a list of questions (one per line in a file) and
print each answer. Fresh anonymous session; same protocol as qa-battery.py.
usage: qa-ask.py questions.txt [out.jsonl]"""
import json, sys, time, urllib.request
from http.cookiejar import CookieJar
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
state = json.loads((ROOT / 'frontend/state.json').read_text())
app = json.loads((ROOT / 'runtime/preview-client.json').read_text())['appId']
G = state['publishedOrigin']
jar = CookieJar(); op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
op.open(f"{G}/start/{state['accessToken']}", timeout=20).read()
r = urllib.request.Request(f'{G}/run/auth/apps/{app}/anonymous-session', data=b'{}', method='POST',
                           headers={'Origin': G, 'Content-Type': 'application/json'})
b = json.loads(op.open(r, timeout=20).read()); jwt = b.get('token') or b['data']['token']
out = open(sys.argv[2], 'w') if len(sys.argv) > 2 else None
for q in Path(sys.argv[1]).read_text().strip().splitlines():
    if not q.strip() or q.startswith('#'): continue
    req = urllib.request.Request(f'{G}/run/api/chat', method='POST', data=json.dumps({'messages': [{'role': 'user', 'content': q}]}).encode(),
                                 headers={'Origin': G, 'Authorization': f'Bearer {jwt}', 'x-inkeep-app-id': app,
                                          'Content-Type': 'application/json', 'Accept': 'text/event-stream'})
    t0 = time.time(); txt = []
    with op.open(req, timeout=180) as resp:
        for line in resp:
            l = line.decode('utf-8', 'replace').strip()
            if l.startswith('data:'):
                try: d = json.loads(l[5:])
                except ValueError: continue
                if d.get('type') == 'text-delta': txt.append(d.get('delta', ''))
    a = ''.join(txt).strip(); secs = round(time.time() - t0, 1)
    print(f'\n### {q} ({secs}s)\n{a}')
    if out: out.write(json.dumps({'question': q, 'answer': a, 'seconds': secs}) + '\n'); out.flush()
    time.sleep(5)
