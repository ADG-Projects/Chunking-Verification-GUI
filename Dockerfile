# syntax=docker/dockerfile:1
FROM python:3.10-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    VIRTUAL_ENV=/app/.venv \
    UV_PROJECT_ENVIRONMENT=/app/.venv \
    PATH="/app/.venv/bin:$PATH"

WORKDIR /app

# System deps for Unstructured + OCR + OpenCV + file type detection
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates \
    poppler-utils \
    tesseract-ocr tesseract-ocr-ara \
    libmagic1 \
    libheif1 libde265-0 \
    libgl1 libglib2.0-0 libsm6 libxext6 libxrender1 \
  && rm -rf /var/lib/apt/lists/*

## Install uv (fast Python package manager) and create venv
# uv places the binary in /root/.local/bin by default
RUN curl -LsSf https://astral.sh/uv/install.sh | sh -s -- --yes && \
    python -m venv "$VIRTUAL_ENV"
ENV PATH="/root/.local/bin:$PATH"

# Copy lockfiles first for better layer caching and install deps
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

# Copy the rest of the app
COPY . .

# Pre-fetch vendor assets to avoid runtime CDN fetches on cold start
RUN "$VIRTUAL_ENV/bin/python" - <<'PY'
from web.serve import ensure_pdfjs_assets, ensure_chartjs_assets
ensure_pdfjs_assets()
ensure_chartjs_assets()
print("Vendor assets cached")
PY

EXPOSE 8000
CMD ["uvicorn", "web.serve:app", "--host", "0.0.0.0", "--port", "8000"]
