#!/bin/sh
# Runs once on first start of the postgres container: gives SpiceDB its own
# database and role inside the runtime Postgres instance.
set -eu
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<EOF
CREATE USER spicedb WITH LOGIN PASSWORD '$SPICEDB_DB_PASSWORD';
CREATE DATABASE spicedb OWNER spicedb;
EOF
