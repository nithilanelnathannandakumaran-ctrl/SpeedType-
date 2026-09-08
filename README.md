# SpeedType — Cloudflare Workers edition

Same app, same features (real accounts, guest mode, live WPM, site-wide
announcements, PIN-gated admin panel) — rebuilt to run on Cloudflare
Workers instead of a traditional Node server. The two versions are **not
interchangeable** — this one uses a real SQL database (D1) instead of
JSON files on disk, so accounts from the Render/Railway version won't
show up here, and vice versa. Pick one host and stick with it.

## Why this looks different from the Render version

Cloudflare Workers don't run plain Node.js — no `http.createServer`, no
filesystem. So this version is a genuine rewrite of the backend only:

- **Storage**: `data/*.json` files → **D1**, Cloudflare's built-in SQLite
  database (`schema.sql` sets up the tables).
- **Server format**: Node's `http` module → a Workers `fetch()` handler
  (`src/index.js`).
- **Password hashing**: Node's `crypto.scryptSync` → PBKDF2 via the Web
  Crypto API, since Workers don't have Node's `crypto` module.
- **Static files**: `public/index.html`, `style.css`, and `script.js` are
  completely unchanged from the Node version — Cloudflare serves them
  directly and only hands your Worker script the `/api/*` requests.

## What you'll need

Unlike Render, there's no "connect your GitHub repo" web dashboard flow
for this — deploying needs **Wrangler**, Cloudflare's command-line tool.
That means using a terminal. If you've never used one, each step below
is a single line to type and press Enter on.

1. **Node.js installed** on your computer (same requirement as testing
   the Render version locally). Get it from nodejs.org if you don't have
   it.
2. **A free Cloudflare account** at cloudflare.com.

## Deploy it

Open a terminal in this unzipped folder and run these one at a time:

```bash
npm install
```

```bash
npx wrangler login
```
This opens your browser to authorize Wrangler with your Cloudflare
account.

```bash
npx wrangler d1 create speedtype-db
```
This prints a block of output containing a `database_id`. Copy that ID.

Open `wrangler.jsonc` in a text editor and replace
`REPLACE_WITH_YOUR_DATABASE_ID` with the ID you just copied. Save it.

```bash
npm run db:migrate
```
This creates the actual tables in your new database using `schema.sql`.

```bash
npx wrangler deploy
```
This uploads everything and gives you a live URL, something like
`speedtype.yourname.workers.dev`.

That's it — open the URL and sign up. Sign up as **elnathan** to get
admin access automatically (or change `ADMIN_USERNAME` in
`wrangler.jsonc` first if you want a different admin).

## Running it locally to test first

```bash
npm run db:migrate:local
npx wrangler dev
```
Opens a local copy at `http://localhost:8787` using a local D1 database
(separate from your real deployed one) so you can try it safely before
going live.

## Setting the admin PIN

Same as before: sign up/log in as elnathan → Settings → Admin → Create
admin PIN. That unlocks the admin panel (announcements, every account,
reset stats, delete accounts) for 20 minutes at a time.

## The honest trade-offs of this version vs. Render/Railway

- **Free tier is generous** — Cloudflare's free plan covers 100,000
  requests/day, which is far more than a personal typing test site will
  ever use, and D1's free tier (5GB storage, 5 million rows read/day) is
  similarly overkill for this.
- **No sleep/wake delay** — unlike Render's free tier, Workers don't
  spin down after inactivity. Every request is instant.
- **Deployment is more hands-on** — no drag-and-drop GitHub upload flow;
  it's terminal commands. Once it's set up though, redeploying after a
  change is just `npx wrangler deploy` again.
- **PBKDF2 instead of scrypt** for password hashing — both are
  legitimate, widely-used password hashing algorithms; this isn't a
  security downgrade, just what's available without Node's crypto module.
