# Deploying DocuChat for free (Oracle Cloud Always Free VM)

The whole stack (Postgres + pgvector, Redis, Django API, Celery worker, Next.js)
runs on one free VM with Docker Compose. Caddy sits in front with an automatic
HTTPS certificate. Gemini's free tier provides the LLM and embeddings.

```
Browser ──HTTPS──> Caddy ──/api, /admin──> Django (gunicorn) ──> Postgres + pgvector
                     │                          │
                     └──── everything else ──> Next.js          Redis ──> Celery worker
                                                 (uploads shared via the `media` volume)
```

Cost: **$0**. Oracle asks for a card to verify identity but does not charge
Always Free resources. Free-tier limits change, so check them when you sign up.

---

## 0. Before you start

- Code pushed to GitHub (merge your feature branch into `main`).
- A **Gemini API key** from https://aistudio.google.com/apikey (free).
- An **SSH key** on your laptop. Run `ls ~/.ssh/id_ed25519.pub`, or create one
  with `ssh-keygen -t ed25519`.

## 1. Create the Oracle Cloud account

1. Sign up at https://www.oracle.com/cloud/free/.
2. Choose your **home region** carefully, since Always Free compute only runs
   there and you can't change it later. Pick one near your users.

## 2. Create the VM

Go to **Compute → Instances → Create instance**:

| Setting | Value |
|---|---|
| Image | **Canonical Ubuntu 24.04** |
| Shape | **Ampere → VM.Standard.A1.Flex**, 2 OCPU, 12 GB RAM (free allowance is 4 OCPU / 24 GB in total) |
| Networking | Create a new VCN + public subnet, **assign a public IPv4 address** |
| SSH keys | Paste the contents of `~/.ssh/id_ed25519.pub` |
| Boot volume | Default (about 50 GB) is fine |

If you get **"Out of capacity"**, try another availability domain or retry later.
Free ARM capacity comes and goes. The fallback is `VM.Standard.E2.1.Micro`
(1 GB RAM). It's tight, so add swap (see Troubleshooting).

Note the instance's **public IP**, e.g. `140.238.12.34`.

## 3. Open ports 80 and 443 (two places)

Oracle blocks traffic both in the cloud network **and** in the VM's own
firewall. You must open both.

**a) Cloud network:** Instance page → subnet → **Security List** → *Add Ingress Rules*:
- Source CIDR `0.0.0.0/0`, TCP, destination port `80`
- Source CIDR `0.0.0.0/0`, TCP, destination port `443`

**b) VM firewall:** SSH in (`ssh ubuntu@140.238.12.34`) and run:
```bash
sudo iptables -I INPUT -p tcp -m multiport --dports 80,443 -j ACCEPT
sudo netfilter-persistent save
```

## 4. Get a free domain

HTTPS certificates need a domain name. Two free options:
- **sslip.io (no signup):** use your IP with dashes, e.g. `140-238-12-34.sslip.io`.
  It already resolves to `140.238.12.34`.
- **DuckDNS:** a nicer name like `docuchat.duckdns.org`. Sign in at
  https://www.duckdns.org and point the subdomain at your IP.

## 5. Install Docker on the VM

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
exit   # log out and SSH back in so the group change applies
docker run --rm hello-world   # check it works
```

## 6. Get the code and configure it

```bash
git clone https://github.com/panwarvipul00/Docuchat.git docuchat
cd docuchat
cp .env.prod.example .env.prod
python3 -c "import secrets; print(secrets.token_hex(32))"   # run twice: secret key + DB password
nano .env.prod
```

If the repo is private, clone with a GitHub personal access token or add the
VM's SSH key as a read-only deploy key.

Fill in `.env.prod`:
```
DOMAIN=140-238-12-34.sslip.io
DJANGO_SECRET_KEY=<first random value>
POSTGRES_PASSWORD=<second random value>
LLM_PROVIDER=gemini
EMBEDDING_PROVIDER=gemini
GEMINI_API_KEY=<your key>
```
Allowed hosts, CORS, CSRF origins and the database URL are derived from these
values automatically in `docker-compose.prod.yml`.

## 7. Start it

```bash
alias dc='docker compose -f docker-compose.prod.yml --env-file .env.prod'
echo "alias dc='docker compose -f docker-compose.prod.yml --env-file .env.prod'" >> ~/.bashrc

dc up -d --build      # first build takes ~5–10 minutes
dc ps                 # all services should be "running"/"healthy"
dc logs caddy | grep -i certificate   # look for "certificate obtained successfully"
```

## 8. Test it

1. Open `https://<your DOMAIN>`. It should show a padlock, with no warning.
2. Register, upload a PDF, and wait for the **ready** badge.
3. Ask a question. The answer should stream word by word with citations.
4. Optional admin user: `dc exec backend python manage.py createsuperuser`,
   then visit `https://<DOMAIN>/admin/`.

## 9. Updating after new commits

```bash
cd ~/docuchat && git pull && dc up -d --build
```
Migrations run automatically when the backend starts.

## 10. Backups (recommended)

Back up the database nightly to a file:
```bash
mkdir -p ~/backups
crontab -e
# add this line:
0 3 * * * docker compose -f ~/docuchat/docker-compose.prod.yml --env-file ~/docuchat/.env.prod exec -T db pg_dump -U postgres docuchat | gzip > ~/backups/docuchat-$(date +\%F).sql.gz
```

---

## Before sharing the link publicly

Anyone can register and use your Gemini quota. Add per-user rate limiting
(Phase 5) first, and never put a paid OpenAI key on a public demo without a
hard spending limit set in the OpenAI dashboard.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Browser can't connect, or Caddy log shows certificate errors | Ports 80/443 not open in **both** places (step 3), or `DOMAIN` doesn't resolve to the VM IP. |
| `400 Bad Request` | `DOMAIN` in `.env.prod` doesn't match the URL you opened. Run `dc up -d` after fixing it. |
| Document stuck on *processing* | `dc logs worker`. Usually a missing/invalid `GEMINI_API_KEY` or a rate limit. |
| Answer appears all at once instead of streaming | Something between the browser and Caddy is buffering (e.g. a CDN proxy). Connect directly. |
| Build or worker killed / out of memory (1 GB VM) | Add swap: `sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile && echo '/swapfile none swap sw 0 0' \| sudo tee -a /etc/fstab` |
| See what's happening | `dc logs -f backend worker` |
