# Deploying DocuChat on Render (free)

Everything runs on Render's free plan except the database, which comes from
**Neon** (free Postgres with pgvector that doesn't expire). The setup is defined
in [`render.yaml`](../render.yaml), so Render creates the services for you.

```
Browser ──> docuchat-web (Next.js) ───────────────┐
   │                                              │
   └──────> docuchat-api ──> Neon Postgres + pgvector
            (gunicorn + Celery     │
             in one container) ──> docuchat-redis (Celery queue, rate-limit counters)
```

Why the API and the Celery worker share one container: Render's free plan has no
background workers, and separate services can't share a disk. In one container,
the worker can read the files the API saves (see `backend/render-start.sh`).

Free-plan trade-offs (Render's limits change, so check their pricing page):
- Services **sleep after ~15 min idle**, and the first visit takes ~30–60 s to wake them.
- About **512 MB RAM**, so very large PDFs may fail.
- The disk is wiped on every restart/redeploy. That's fine here: files are only
  needed while processing, and chunks + embeddings live in Postgres.
- Free instance hours are shared across services; sleeping services don't use them.
- Django admin pages load without CSS (static files aren't served on this setup).

---

## Step 1: Gemini API key
Go to https://aistudio.google.com/apikey → **Create API key** → copy it.

## Step 2: Database on Neon
1. Sign up at https://neon.tech (GitHub login works) and create a project
   named `docuchat`. Pick a region close to where your Render services will run
   (e.g. AWS Singapore for Render Singapore).
2. On the project dashboard, open **Connect**. **Turn connection pooling off**
   (use the direct connection; Django keeps its own connections) and copy the
   connection string. It looks like:
   `postgresql://user:password@ep-xxx.ap-southeast-1.aws.neon.tech/neondb?sslmode=require`
3. Retrieval needs **pgvector 0.8 or newer** (for filtered HNSW scans). Check in
   Neon's **SQL Editor**:
   ```sql
   CREATE EXTENSION IF NOT EXISTS vector;
   SELECT extversion FROM pg_extension WHERE extname = 'vector';
   ```
   You need `0.8.0` or higher.

## Step 3: Choose your Render URLs
Render names each service's URL after the service: `https://<name>.onrender.com`.
If a name is already taken, Render adds a random suffix. You'll confirm the real
URLs in step 5.

Planned:
- API: `https://docuchat-api.onrender.com`
- Frontend: `https://docuchat-web.onrender.com`

## Step 4: Create the Blueprint
1. Sign up at https://render.com with GitHub.
2. **New → Blueprint** → connect the `Docuchat` repository → branch `main`.
3. Render reads `render.yaml` and asks for the secret values:

   | Key | Value |
   |---|---|
   | `DATABASE_URL` | Neon connection string from step 2 |
   | `GEMINI_API_KEY` | Key from step 1 |
   | `CORS_ALLOWED_ORIGINS` | `https://docuchat-web.onrender.com` |
   | `NEXT_PUBLIC_API_URL` | `https://docuchat-api.onrender.com/api` |

4. Click **Apply**. The first build takes ~5–10 minutes. Watch the logs of
   `docuchat-api` for `Booting worker` (gunicorn) and `celery@... ready`.

## Step 5: Check the URLs match
Open each service in the Render dashboard and compare its URL with what you
typed in step 4. If Render added a suffix (e.g. `docuchat-api-x1y2.onrender.com`):
- **docuchat-web → Environment:** fix `NEXT_PUBLIC_API_URL`, then
  **Manual Deploy → Clear build cache & deploy**. It's baked in at build time,
  so a plain restart isn't enough.
- **docuchat-api → Environment:** fix `CORS_ALLOWED_ORIGINS` and save (it restarts).

Quick check: `https://<api-url>/api/health/` should show `{"status": "ok"}`.

## Step 6: Test
1. Open the frontend URL and register an account.
2. Upload a PDF and wait for **Ready**.
3. Ask a question. The answer should stream in with citations.

## Step 7: Make yourself staff (skips rate limits)
Open **docuchat-api → Shell** in the Render dashboard and run, with your email:
```bash
python manage.py shell -c "from apps.accounts.models import User; User.objects.filter(email='you@example.com').update(is_staff=True, is_superuser=True)"
```
If the Shell tab isn't available on the free plan, run the same command from
your laptop against the Neon database, using the local Docker setup:
```bash
docker compose run --rm -e DATABASE_URL='<neon url>' backend \
  python manage.py shell -c "from apps.accounts.models import User; User.objects.filter(email='you@example.com').update(is_staff=True, is_superuser=True)"
```

## Updating
Every push to `main` redeploys both services automatically.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Frontend shows "Can't reach the server" | `NEXT_PUBLIC_API_URL` is wrong, or the API is still waking up (wait ~1 min). After fixing it, redeploy **with cleared build cache**. |
| Browser console shows a CORS error | `CORS_ALLOWED_ORIGINS` on the API must exactly equal the frontend URL: `https://`, no trailing slash. |
| `400 Bad Request` from the API | Host not allowed. `RENDER_EXTERNAL_HOSTNAME` is added automatically; a custom domain must be added to `DJANGO_ALLOWED_HOSTS`. |
| Document stuck on *Processing* | API logs: look for `celery` lines. Usually the Gemini key or Gemini's rate limit. |
| `unrecognized configuration parameter "hnsw.iterative_scan"` | pgvector is older than 0.8, see step 2.3. |
| Service restarts with "out of memory" | The PDF is too large for 512 MB. Try a smaller file, or move to a paid instance. |
| Login rate limit hits everyone at once | Render's proxy chain differs from `DJANGO_NUM_PROXIES=1`. Check the `X-Forwarded-For` header in the logs and adjust. |
