# Deploying to Vercel (PostgreSQL)

The app uses PostgreSQL (Prisma). SQLite cannot work on Vercel — its filesystem is read-only
and per-instance.

## One-time setup

1. Create a Postgres database — Neon (free) or Vercel Storage → Postgres.
2. Copy its `DATABASE_URL` connection string (the pooled one; Neon host contains `-pooler`).
3. In Vercel → Project → Settings → Environment Variables, set `DATABASE_URL`
   (Production, Preview and Development), then redeploy. (Neon's Vercel integration sets it for you.)
4. Put the same value in your local `.env` (git-ignored; see `.env.example`).
5. Create the tables and load the demo data **once**, from your machine:

   ```
   npm run seed
   ```

   (`prisma db push` + `tsx prisma/seed.ts`. Takes a few minutes over the network.)

## Re-seeding for a clean demo

`npm run seed` again — it clears all data first, then reloads the deterministic demo dataset.
Run it against the same database Vercel uses; no redeploy is needed.
