# Bahadix Web — Deployment Guide

Host the site **for free** on Vercel + Supabase. Your PC does not need to stay on.

## Stack (free tiers)

| Service | Role | Free limit |
|---------|------|------------|
| [Vercel](https://vercel.com) | Website hosting | Hobby plan, always on |
| [Supabase](https://supabase.com) | PostgreSQL database | 500 MB, plenty for 60 people |

## 1. Create Supabase project

1. Sign up at [supabase.com](https://supabase.com) → **New project**
2. Open **SQL Editor** → paste and run [`../supabase/schema.sql`](../supabase/schema.sql)
3. Go to **Project Settings → API** and copy:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## 2. Configure environment

In `web/`, copy the example env file:

```bash
cp .env.example .env.local
```

Edit `.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
ADMIN_PASSWORD=your-strong-password-here
```

Choose a strong `ADMIN_PASSWORD` — only people with this password can approve issues and manage the roster.

## 3. Run locally (optional)

Requires **Node.js 20+**:

```bash
cd web
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## 4. Deploy to Vercel

1. Push this repo to GitHub
2. Go to [vercel.com](https://vercel.com) → **Add New Project** → import the repo
3. Set **Root Directory** to `web`
4. Add environment variables (same as `.env.local`):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `ADMIN_PASSWORD`
5. Deploy

Your site will be live at `https://your-project.vercel.app` within a minute.

## Pages

| URL | Who | Purpose |
|-----|-----|---------|
| `/` | Everyone | Home |
| `/report` | Cadets | Report blocked hours (exam, trial, etc.) |
| `/admin` | Commander | Approve issues, manage roster, export JSON |
| `/scheduler.html` | Commander | Full Bahadix scheduler (Excel, ICS, build board) |

## Workflow

1. **Commander** adds cadet names in `/admin`
2. **Cadets** open `/report` on their phone, pick their name, time range, reason → submit
3. **Commander** approves in `/admin`
4. Approved blocks appear as JSON — add them in the scheduler under **התנסויות** (tab 06), or copy manually
5. Build the full schedule in `/scheduler.html`

## Security notes

- Cadet reporting uses a name picker (no login) — fine for a closed unit of ~60
- Admin actions require `ADMIN_PASSWORD`
- To add per-cadet login later, enable [Supabase Auth](https://supabase.com/docs/guides/auth)

## Costs

For ~60 users this stays **$0/month** on Vercel Hobby + Supabase Free.
