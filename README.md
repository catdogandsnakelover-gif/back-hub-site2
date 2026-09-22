# Back Hub — self-hostable edition

A galaxy-themed, key-gated hub directory you can deploy to real public hosting.
Visitors enter a single-use access key to unlock a directory of hub links.
The owner manages keys and hubs from an Owner Console.

## Quick start

```bash
npm install
npm start
```

Then open http://localhost:3000 (or whatever `PORT` is set to).

Environment variables:

| Variable         | Default            | What it does                                     |
|------------------|--------------------|--------------------------------------------------|
| `PORT`           | `3000`             | Port the server listens on                       |
| `SESSION_SECRET` | random per boot    | Signs the session cookies — **set this in production** so logins survive restarts |
| `DB_PATH`        | `./data.db`        | Where the SQLite database file lives             |
| `NODE_ENV`       | —                  | Set to `production` to mark cookies `Secure` (needs HTTPS) |

## First admin access

1. Open the site and tap the **Admin** button on the landing page.
2. Enter the owner email: `kevinaugusta27@gmail.com`
   (change it with the `ADMIN_EMAIL` constant at the top of `server.js`).
3. The Owner Console opens: generate keys, manage shared hubs.

Keys are single-use by default (`Allowed uses: 1`). Raise the number when
generating a key to make it reusable — e.g. 5 lets five different people in.

## Deploying

### Railway

1. Push this folder to a GitHub repo.
2. In Railway: **New Project → Deploy from GitHub**, pick the repo.
3. Add a persistent volume mounted at `/data` and set `DB_PATH=/data/data.db`
   (otherwise the SQLite file is wiped on every redeploy).
4. Set `SESSION_SECRET` to a long random string and `NODE_ENV=production`.
5. Railway assigns a public URL automatically.

### Render

1. Push this folder to a GitHub repo.
2. In Render: **New → Web Service**, pick the repo. Build command: `npm install`,
   start command: `npm start`.
3. Add a **Persistent Disk** mounted at `/data` and set `DB_PATH=/data/data.db`.
4. Set `SESSION_SECRET` (generate one) and `NODE_ENV=production` in Environment.
5. Render gives you a public `https://…onrender.com` URL.

### Plain VPS (Ubuntu)

```bash
git clone <your-repo-url> back-hub-site
cd back-hub-site
npm install
# run with pm2 so it stays up and restarts on reboot
npm install -g pm2
SESSION_SECRET="$(openssl rand -hex 32)" NODE_ENV=production pm2 start server.js --name back-hub
pm2 save && pm2 startup
```

Put it behind a reverse proxy (nginx/Caddy) for HTTPS — example Caddy:

```
yourdomain.com {
    reverse_proxy localhost:3000
}
```

Caddy handles HTTPS certificates automatically.

## Security notes — read this

- The admin gate is **email entry only** (there is no Google OAuth here).
  On a public site, **anyone who knows or guesses the owner email gets into
  the Owner Console**. Treat this as a convenience lock, not real security.
- For real protection later: add a password, TOTP 2FA, or proper OAuth
  (e.g. "Sign in with Google" restricted to your account) in front of the
  admin routes in `server.js`.
- Always set `SESSION_SECRET` to a long random value in production and serve
  over HTTPS (`NODE_ENV=production` marks cookies `Secure`).
- The SQLite file (`data.db`) holds all keys and hubs — back it up and keep
  it out of public web roots (it's in the project dir, not in `public/`).
- A small in-memory rate limiter guards the key-redeem and admin-login
  endpoints; for heavy traffic put the app behind a proper WAF / rate limiter.
