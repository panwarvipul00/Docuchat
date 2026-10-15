FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

# tiktoken downloads its BPE vocab on first use. Fetch it at build time so the
# worker doesn't depend on network access (or a cold cache) when it runs.
ENV TIKTOKEN_CACHE_DIR=/opt/tiktoken
RUN python -c "import tiktoken; tiktoken.get_encoding('cl100k_base')"

COPY . .

EXPOSE 8000
# gthread workers: an SSE answer holds its connection open for seconds, so give
# each process threads instead of tying up a whole sync worker per stream.
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", \
     "--workers", "3", "--worker-class", "gthread", "--threads", "8", "--timeout", "120"]
