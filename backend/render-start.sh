#!/bin/sh
# Start command for Render's free plan, which has no background workers and no
# disk shared between services. So the Celery worker runs in the same container
# as the API: they share one filesystem, and the worker can read uploaded files.
#
# Sized for ~512 MB RAM: one gunicorn process (threads handle concurrent SSE
# streams) and a single-process Celery worker that runs one ingestion job at a time.
set -e

python manage.py migrate --noinput

# --pool=solo runs tasks in the worker's own process instead of forking a child,
# saving a whole copy of Django in memory. Restart it if it ever exits.
(
  while true; do
    celery -A config worker --loglevel=info --pool=solo
    echo "Celery worker exited; restarting in 5s" >&2
    sleep 5
  done
) &

exec gunicorn config.wsgi:application --bind "0.0.0.0:${PORT:-8000}" \
  --workers 1 --worker-class gthread --threads 8 --timeout 120
