# DocuChat

Chat with your documents. Upload PDFs, Word files or text files, then ask questions in plain English. Every answer comes **only from your documents**, and each one cites the document and page it came from.

DocuChat is a retrieval-augmented generation (RAG) app. The retrieval logic is written by hand, without LangChain or LlamaIndex, so every step is visible in the code.

## Features

- **Accounts and workspaces:** sign in with email and password using JWT tokens that refresh automatically. Each workspace's data is isolated, and every query is limited to the user's own workspace.
- **Background processing:** uploads are parsed (PyMuPDF, python-docx), cleaned, split into chunks of about 600 tokens without breaking sentences, and embedded in batches by a Celery worker.
- **Vector search:** uses Postgres with the `pgvector` extension and an HNSW index. Iterative index scans keep results complete even when filtering to a single workspace.
- **Streaming answers:** answers stream in token by token, with inline `[n]` citations shown as source badges.
- **Grounded answers:** if your documents don't contain the answer, DocuChat says so instead of guessing.
- **Swappable AI providers:** OpenAI, Google Gemini (free tier) or Groq for answers, and OpenAI or Gemini for embeddings. Each is one environment variable to change.
- **Polished interface:** a violet and amber theme with light and dark modes, Markdown answers, and a responsive layout.

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 15 (App Router), TypeScript, Tailwind CSS 4 |
| Backend | Django 5, Django REST Framework, SimpleJWT |
| Database | PostgreSQL 16 + pgvector |
| Background jobs | Celery + Redis |
| AI | OpenAI / Gemini / Groq through one OpenAI-compatible client |
| Dev environment | Docker Compose |
| Tests | pytest + pytest-django |

## Getting started

You need Docker and Docker Compose, and an API key. A [Gemini key](https://aistudio.google.com/apikey) is free.

```bash
git clone git@github.com:panwarvipul00/docuchat.git
cd docuchat
cp .env.example .env
```

Edit `.env`:

```env
DJANGO_SECRET_KEY=any-long-random-string
LLM_PROVIDER=gemini
EMBEDDING_PROVIDER=gemini
GEMINI_API_KEY=your-key-here
```

Then start everything:

```bash
docker compose up -d --build
```

- Web app: http://localhost:3000
- API: http://localhost:8000/api

Register an account, upload a document on **Documents**, wait for the status to show **ready**, then ask questions on **Chat**.

### Running the tests

```bash
docker compose run --rm backend pytest
```

The tests use offline fake AI providers, so they need no API key and cost nothing.

## Project structure

```
backend/
  apps/        accounts, workspaces, documents, chat (models, views, URLs)
  services/    parsing, chunking, embeddings, retrieval, llm, rag (all business logic)
  tests/
frontend/
  app/         Next.js routes: login, register, dashboard, documents, chat
  components/  shared UI, theme, Markdown renderer
  lib/api.ts   typed API client with token refresh and SSE streaming
```

## Status

| Phase | Scope | Status |
|---|---|---|
| 1 | Setup, auth, uploads | ✅ Done |
| 2 | Ingestion pipeline | ✅ Done |
| 3 | Retrieval and streaming chat | ✅ Done |
| 4 | Frontend polish | 🚧 In progress |
| 5 | Hybrid search, sharing, rate limits | ⏳ Planned |
| 6 | Evaluation, CI, deployment | ⏳ Planned |
