#!/usr/bin/env python3
"""Multi-turn battery: each list in qa-conversations.json is one visitor session.
Follow-ups are sent with the full prior message history, as the widget does.
Writes qa-conversations.jsonl with every turn's answer, tools, cited URLs and timing.
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
GATEWAY = state.get('publishedOrigin') or sys.exit('no publishedOrigin; start the tunnel first')
app_id = json.loads((ROOT / 'runtime/preview-client.json').read_text())['appId']
conversations = json.loads((ROOT / 'deploy/qa-conversations.json').read_text())
out = Path(sys.argv[1] if len(sys.argv) > 1 else ROOT / 'deploy/qa-conversations.jsonl')


def session():
    jar = CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    opener.open(f"{GATEWAY}/start/{state['accessToken']}", timeout=20).read()
    req = urllib.request.Request(f'{GATEWAY}/run/auth/apps/{app_id}/anonymous-session', data=b'{}', method='POST',
                                 headers={'Origin': GATEWAY, 'Content-Type': 'application/json'})
    body = json.loads(opener.open(req, timeout=20).read())
    return opener, body.get('token') or body['data']['token']


def ask(opener, jwt, messages, conversation_id):
    headers = {'Origin': GATEWAY, 'Authorization': f'Bearer {jwt}', 'x-inkeep-app-id': app_id,
               'Content-Type': 'application/json', 'Accept': 'text/event-stream'}
    payload = {'messages': messages}
    if conversation_id:
        payload['conversationId'] = conversation_id
    req = urllib.request.Request(f'{GATEWAY}/run/api/chat', method='POST', data=json.dumps(payload).encode(), headers=headers)
    started = time.time()
    text, tools = [], []
    with opener.open(req, timeout=180) as response:
        conversation_id = response.headers.get('x-inkeep-conversation-id') or conversation_id
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
    return {'answer': answer, 'tools': tools, 'urls': urls, 'hosts_allowed': hosts <= ALLOWED,
            'seconds': round(time.time() - started, 1)}, conversation_id


with out.open('w') as handle:
    for index, turns in enumerate(conversations, 1):
        opener, jwt = session()
        messages, conversation_id = [], None
        for turn, question in enumerate(turns, 1):
            messages.append({'role': 'user', 'content': question})
            result: dict = {}
            try:
                result, conversation_id = ask(opener, jwt, messages, conversation_id)
            except Exception as error:
                result['error'] = str(error)[:300]
            result.update(conversation=index, turn=turn, question=question)
            messages.append({'role': 'assistant', 'content': result.get('answer', '')})
            handle.write(json.dumps(result) + '\n')
            handle.flush()
            print(f"{index:2d}.{turn} {result.get('seconds', '-'):>5}s {'OK ' if result.get('hosts_allowed') else 'CHK'} {question[:60]}")
            time.sleep(6)
print('wrote', out)