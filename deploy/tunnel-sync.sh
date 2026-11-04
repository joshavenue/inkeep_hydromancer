#!/bin/sh
# Read the current quick-tunnel hostname from cloudflared's metrics endpoint and,
# if it changed, write it to frontend/state.json as publishedOrigin and add it to
# the Inkeep App's allowed domains (runtime/authorize-preview-origin.mjs).
# Prints the public URL and the invitation path, never the token.
set -eu
cd "$(dirname "$0")/.."
URL=$(curl -s --max-time 5 http://127.0.0.1:18599/quicktunnel | python3 -c 'import json,sys; print("https://"+json.load(sys.stdin)["hostname"])')
CURRENT=$(python3 -c 'import json; print(json.load(open("frontend/state.json")).get("publishedOrigin") or "")')
if [ "$URL" = "$CURRENT" ]; then echo "tunnel unchanged: $URL"; exit 0; fi
python3 - "$URL" <<'EOF'
import json, os, sys
p = "frontend/state.json"
s = json.load(open(p)); s["publishedOrigin"] = sys.argv[1]
tmp = p + ".tmp"
fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
os.write(fd, json.dumps(s, indent=2).encode()); os.close(fd); os.replace(tmp, p)
EOF
cd runtime && node --env-file=.env authorize-preview-origin.mjs | python3 -c 'import json,sys; d=json.loads(sys.stdin.read().splitlines()[-1]); print("allowed:", d["allowedDomains"])'
echo "tunnel updated: $URL  (invitation: $URL/start/<accessToken from frontend/state.json>)"
