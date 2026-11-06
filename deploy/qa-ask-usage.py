#!/usr/bin/env python3
"""Like qa-ask.py, but also records tool calls, time to first text and any token
usage the stream reports, for model comparisons.
usage: qa-ask-usage.py questions.txt out.jsonl"""
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
out = open(sys.argv[2], 'w')


def find_usage(obj):
    """Return the first dict that looks like token usage anywhere in an event."""
    if isinstance(obj, dict):
        keys = set(obj)
        if keys & {'inputTokens', 'input_tokens', 'promptTokens'} and keys & {'outputTokens', 'output_tokens', 'completionTokens'}:
            return obj
        for v in obj.values():
            u = find_usage(v)
            if u: return u
    if isinstance(obj, list):
        for v in obj:
            u = find_usage(v)
            if u: return u
    return None


for q in Path(sys.argv[1]).read_text().strip().splitlines():
    if not q.strip() or q.startswith('#'): continue
    req = urllib.request.Request(f'{G}/run/api/chat', method='POST', data=json.dumps({'messages': [{'role': 'user', 'content': q}]}).encode(),
                                 headers={'Origin': G, 'Authorization': f'Bearer {jwt}', 'x-inkeep-app-id': app,
                                          'Content-Type': 'application/json', 'Accept': 'text/event-stream'})
    t0 = time.time(); txt = []; tools = 0; first = None; usage = None; types = {}; err = None
    try:
        with op.open(req, timeout=240) as resp:
            for line in resp:
                l = line.decode('utf-8', 'replace').strip()
                if not l.startswith('data:'): continue
                try: d = json.loads(l[5:])
                except ValueError: continue
                t = d.get('type', '?'); types[t] = types.get(t, 0) + 1
                if t == 'text-delta':
                    if first is None: first = round(time.time() - t0, 1)
                    txt.append(d.get('delta', ''))
                if t in ('tool-input-start', 'tool-call'): tools += 1
                u = find_usage(d)
                if u: usage = u
    except Exception as e:  # keep going; record the failure
        err = f'{type(e).__name__}: {e}'
    a = ''.join(txt).strip(); secs = round(time.time() - t0, 1)
    rec = {'question': q, 'answer': a, 'seconds': secs, 'first_text_s': first, 'tool_calls': tools,
           'usage': usage, 'event_types': types, 'error': err}
    print(f'{secs:>5}s first={first} tools={tools} chars={len(a)} usage={bool(usage)} {q[:60]}', flush=True)
    out.write(json.dumps(rec) + '\n'); out.flush()
    time.sleep(5)
