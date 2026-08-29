FROM python:3.11-slim

WORKDIR /srv

# Install deps first for layer caching.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

EXPOSE 8000

# Single worker is plenty: parsing is CPU-light and runs behind the web app's
# own auth/rate limits. Scale with more replicas if ever needed.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
