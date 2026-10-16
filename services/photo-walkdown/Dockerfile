FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DJANGO_SETTINGS_MODULE=config.settings \
    WALKDOWN_DATA_DIR=/data

WORKDIR /srv

# Install deps first for layer caching.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# collectstatic needs settings to import, so give it throwaway values; the
# real ones come from the environment at run time.
RUN DJANGO_SECRET_KEY=build SUPABASE_URL=https://build.invalid SUPABASE_ANON_KEY=build \
    SUPABASE_SERVICE_ROLE_KEY=build WALKDOWN_TENANT_ID=build \
    python manage.py collectstatic --noinput

# SQLite, the thumbnail cache and the upload log live on the /data volume.
RUN useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin walkdown \
 && mkdir -p /data && chown walkdown /data
USER walkdown
VOLUME /data
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD python -c "import urllib.request,sys; sys.exit(urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=4).status != 200)"

# One worker with threads: SQLite allows a single writer, and the work is
# waiting on Supabase, which threads handle fine.
CMD ["sh", "-c", "python manage.py migrate --noinput && python manage.py load_deltas --no-refresh && exec gunicorn config.wsgi --bind 0.0.0.0:${PORT:-8000} --workers 1 --threads 8 --timeout 60 --no-control-socket --access-logfile -"]
