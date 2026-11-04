#!/bin/sh
# Commit the migrated schema inside the dedicated Doltgres management database.
# Run from runtime/ after both migrations succeed. Reads the password from .env,
# never prints it.
set -eu
cd "$(dirname "$0")/../runtime"
PGPASSWORD=$(python3 -c 'import os,sys
from urllib.parse import urlsplit, unquote
for line in open(".env"):
    if line.startswith("INKEEP_AGENTS_MANAGE_DATABASE_URL="):
        print(unquote(urlsplit(line.split("=",1)[1].strip()).password)); sys.exit()
sys.exit("manage URL missing")')
export PGPASSWORD
docker exec -e PGPASSWORD deploy-doltgres-1 psql -h localhost -U hydromancer_demo -d inkeep_hydromancer_manage -tA \
  -c "SELECT count(*) AS pending_before FROM dolt_status;" \
  -c "SELECT DOLT_ADD('-A');" \
  -c "SELECT DOLT_COMMIT('-a', '-m', 'Initialize Inkeep 0.80.6 schema');" \
  -c "SELECT count(*) AS pending_after FROM dolt_status;"
