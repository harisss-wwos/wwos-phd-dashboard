# Deploying the PHD Dashboard API (Render + MongoDB Atlas)

The static site stays on **GitHub Pages** (unchanged). This adds a small **API on Render**
that holds the database secret and talks to **MongoDB Atlas**. Architecture:

```
Browser (GitHub Pages: UI)  --HTTPS-->  Render API (holds MONGODB_URI)  -->  MongoDB Atlas
```

---

## Prerequisites (already done)
- Atlas cluster live, Network Access includes `0.0.0.0/0` (needed for Render's rotating IPs).
- Accounts already seeded in Atlas: `harisss` (owner), `arunkzn` / `flofalgu` / `punithsd` (admin).
- API code lives in `phd-pages/server/`. Frontend calls it via `api-config.js`.

---

## Step 1 — Commit and push the new files
From `c:\Kiro\phd-pages`:
```
git add server render.yaml DEPLOY.md api-config.js app.html app.js profile.html users.html
git commit -m "Add auth API (Render/Atlas) + login, profile, user management"
git push origin main
```
(Note: `server/.env` and `server/node_modules/` are gitignored — the secret is NOT pushed. Good.)

---

## Step 2 — Generate a JWT secret (you'll paste it into Render)
Run locally and copy the output:
```
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

---

## Step 3 — Create the Render Web Service
Two ways; **Blueprint** is easiest because `render.yaml` pre-fills everything.

### Option A — Blueprint (recommended)
1. Render dashboard -> **New +** -> **Blueprint**.
2. Pick the `wwos-phd-dashboard` repo. Render detects `render.yaml`.
3. It will create a service named **wwos-phd-api** with:
   - Root Directory: `server`
   - Build: `npm install`
   - Start: `npm start`
   - Health check: `/api/health`
4. It will prompt for the two secret env vars (`MONGODB_URI`, `JWT_SECRET`) — see Step 4.

### Option B — Manual Web Service
1. Render -> **New +** -> **Web Service** -> connect the `wwos-phd-dashboard` repo.
2. Settings:
   - **Root Directory:** `server`
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free
   - **Health Check Path:** `/api/health`

---

## Step 4 — Set Environment Variables in Render
Service -> **Environment** -> add:

| Key | Value |
|---|---|
| `MONGODB_URI` | your Atlas connection string (paste from `atlas-credentials.env`) |
| `JWT_SECRET` | the random string from Step 2 |
| `MONGODB_DB` | `phd` |
| `ALLOWED_ORIGINS` | `https://harisss-wwos.github.io` |

Save. Render redeploys automatically.

> The DB password lives ONLY here (server-side). It is never in the public repo or the browser.

---

## Step 5 — Get your service URL
After deploy, Render shows a URL like:
```
https://wwos-phd-api.onrender.com
```
Test it in a browser:
```
https://wwos-phd-api.onrender.com/api/health   ->  {"ok":true,...}
```
(First hit after idle takes ~30-50s while the free instance wakes.)

---

## Step 6 — Point the frontend at the API
Edit `api-config.js` line with the placeholder, replacing it with your Render URL:
```js
window.PHD_API_BASE = override || (isLocal ? 'http://127.0.0.1:3000' : 'https://wwos-phd-api.onrender.com');
```
Then commit + push:
```
git add api-config.js
git commit -m "Point frontend to Render API URL"
git push origin main
```
GitHub Pages redeploys in ~1-2 min.

---

## Step 7 — Verify end to end
1. Open the live site's Live Dashboard: `https://harisss-wwos.github.io/wwos-phd-dashboard/app.html`
2. Click **Login** -> `harisss` / `harisss@123` -> you should see **owner** + Publish/Users buttons.
3. Upload/merge a CSV, click **Publish Data** -> data saves to Atlas.
4. Open the page in a different browser (logged out) -> the published data loads for everyone (viewers, no login).

---

## Security to-do before real use
1. **Rotate the Atlas DB password** (it was shared in plaintext during setup):
   - Atlas -> Database Access -> edit `harisss_db_user` -> Edit Password.
   - Update `MONGODB_URI` in Render's Environment with the new password.
2. Have each seeded user log in and change their password on the **Profile** page.
3. (Optional) Create a least-privilege Atlas DB user scoped to just the `phd` database instead of the setup user.

---

## Re-seeding accounts (only if needed)
Accounts already exist in Atlas. If you ever need to recreate them:
- Locally: `cd server && node seed.js` (uses `server/.env`), or
- On Render: add a one-off **Job** / Shell running `node seed.js`.
The seed is idempotent (skips users that already exist).
