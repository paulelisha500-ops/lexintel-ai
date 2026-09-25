FROM python:3.11-slim

# Tesseract for OCR (eng+ara), OpenCV runtime deps for signature verification
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    tesseract-ocr-ara \
    libgl1 \
    libglib2.0-0 \
    poppler-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
# Longer timeout + more retries: the torch/transformers wheels are large
# enough that a slow or briefly-flaky connection can trip pip's default
# 15s read timeout mid-download.
ENV PIP_DEFAULT_TIMEOUT=120
RUN pip install --no-cache-dir --retries 10 -r requirements.txt
RUN python -m spacy download en_core_web_trf

COPY requirements-extra.txt requirements-dev.txt ./
RUN pip install --no-cache-dir --retries 10 -r requirements-extra.txt -r requirements-dev.txt

COPY . .

EXPOSE 8005
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8005"]
