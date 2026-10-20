FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DJANGO_SETTINGS_MODULE=config.settings \
    STUDIO_DATA_DIR=/data \
    STUDIO_SEED_DIR=/srv/seed

# ffmpeg renders the downloadable MP4; DejaVu is the only font the renderer uses.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /srv

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# collectstatic needs settings to import, so give it throwaway values; the
# real ones come from the environment at run time.
RUN DJANGO_SECRET_KEY=build SUPABASE_URL=https://build.invalid SUPABASE_ANON_KEY=build \
    SUPABASE_SERVICE_ROLE_KEY=build python manage.py collectstatic --noinput

RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin studio \
 && mkdir -p /data && chown studio /data
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD python -c "import urllib.request,sys; sys.exit(urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=4).status != 200)"

ENTRYPOINT ["/srv/entrypoint.sh"]

# One worker with threads: SQLite allows a single writer and the work is
# waiting on Supabase. Long renders run as management commands, not requests.
CMD ["sh", "-c", "python manage.py migrate --noinput && exec gunicorn config.wsgi --bind 0.0.0.0:${PORT:-8000} --workers 1 --threads 8 --timeout 60 --no-control-socket --access-logfile -"]
