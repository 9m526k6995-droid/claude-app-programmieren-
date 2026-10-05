#!/usr/bin/env bash
# Testet die Supabase-SQL-Dateien gegen eine echte Postgres-Datenbank.
#   ZWIP_TEST_PG="host=localhost user=postgres" bash tests/run-sql.sh
set -euo pipefail
cd "$(dirname "$0")/.."
PG="${ZWIP_TEST_PG:-host=localhost user=postgres}"
DB=zwip_sqltest

psql "$PG dbname=postgres" -q -v ON_ERROR_STOP=1 -c "drop database if exists $DB" -c "create database $DB" >/dev/null
run() { psql "$PG dbname=$DB" -q -v ON_ERROR_STOP=1 -f "$1" 2>&1 | grep -v -E "^NOTICE:  (policy|trigger|relation|extension).*(does not exist|already exists)" || true; }
for f in tests/sql/supabase-shim.sql supabase/profiles.sql supabase/schema.sql supabase/trophies.sql supabase/profile.sql supabase/trophies.sql supabase/profile.sql; do
  out=$(psql "$PG dbname=$DB" -q -v ON_ERROR_STOP=1 -f "$f" 2>&1) || { echo "$out"; echo "✘ Fehler in $f"; exit 1; }
done
echo "✔ SQL-Dateien laufen fehlerfrei (auch doppelt ausgeführt)"
out=$(psql "$PG dbname=$DB" -v ON_ERROR_STOP=1 -f tests/sql/trophies.test.sql 2>&1) || { echo "$out" | grep -E "✔|FEHL|ERROR|LINE" ; exit 1; }
echo "$out" | grep -E "✔|BESTANDEN" | sed 's/^psql:[^:]*:[0-9]*: NOTICE:  //; s/^NOTICE:  //'
out=$(psql "$PG dbname=$DB" -v ON_ERROR_STOP=1 -f tests/sql/profile.test.sql 2>&1) || { echo "$out" | grep -E "✔|FEHL|ERROR|LINE" ; exit 1; }
echo "$out" | grep -E "✔|BESTANDEN" | sed 's/^psql:[^:]*:[0-9]*: NOTICE:  //; s/^NOTICE:  //'
psql "$PG dbname=postgres" -q -c "drop database if exists $DB" >/dev/null
