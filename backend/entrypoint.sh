#!/bin/sh
# Waits for MySQL, then (API container only) applies migrations and seeds demo data.

set -e

python - <<'PY'
import os
import sys
import time
import MySQLdb

for attempt in range(60):
    try:
        MySQLdb.connect(
            host=os.environ.get("DB_HOST", "mysql"),
            user=os.environ.get("DB_USER", "slop"),
            passwd=os.environ.get("DB_PASSWORD", "slop"),
            db=os.environ.get("DB_NAME", "slop"),
            port=int(os.environ.get("DB_PORT", "3306")),
        ).close()

        sys.exit(0)

    except MySQLdb.Error:
        time.sleep(2)

print("MySQL is not reachable", file=sys.stderr)
sys.exit(1)
PY

if [ "${RUN_MIGRATIONS:-0}" = "1" ]; then
    python manage.py migrate --noinput
    python manage.py bootstrap_demo
fi

exec "$@"