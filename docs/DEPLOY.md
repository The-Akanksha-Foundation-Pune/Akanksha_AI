# Deploying Akanksha AI

The plan follows Alumni Connect: one more PM2 process on the Tether EC2 box, behind the same
nginx, at **https://tether.akanksha.org/akanksha-ai/**. Nothing below has been done on the server
yet; the values in the table are the defaults the files in `deploy/` assume, and each can be changed.

| Item | Default | Where to change it |
|------|---------|--------------------|
| Directory | `/home/ec2-user/Akanksha_AI` | repository variable `APP_DIR` |
| PM2 name | `akanksha-ai` | `deploy/ecosystem.config.cjs`, `deploy/deploy.sh` |
| Port | **5080**, localhost only | `PORT` in `.env`, `deploy/nginx-akanksha-ai.conf` |
| Public address | `https://tether.akanksha.org/akanksha-ai` | `CLIENT_URL` and `BASE_PATH` in `.env`, the nginx block |
| Branch | `main` | |
| Runner label | `akanksha-ai-prod` | `runs-on` in `.github/workflows/ci-cd.yml` |

How the pieces fit: nginx receives `/akanksha-ai/...`, strips the prefix, and proxies to Express.
Express serves the built client (`SERVE_CLIENT=1`) and the API. The client is built with
`VITE_BASE_PATH=/akanksha-ai/`, so every asset and API call carries the prefix
(`client/src/main.jsx` adds it to `/api/...` calls). To serve the app at the root of its own
hostname instead, set `BASE_PATH=/` and `CLIENT_URL=https://<host>`.

## First-time setup on the server

1. **Check the port is free**: `pm2 list`, `sudo ss -ltnp | grep ':5080 '` (empty = free).
2. **Clone**: `cd /home/ec2-user && git clone git@github.com:The-Akanksha-Foundation-Pune/Akanksha_AI.git`.
   The repository is private, so the server needs a deploy key (Settings > Deploy keys, read-only)
   or the same GitHub access the other checkouts use.
3. **Environment**: copy `deploy/env.production.example` to `/home/ec2-user/Akanksha_AI/.env` and
   fill it in. Use a new Anthropic key and a new `JWT_SECRET`, not the ones from a laptop.
   `deploy/deploy.sh` refuses to run without `SERVE_CLIENT=1` and both Google keys.
4. **Google sign-in**: add `https://tether.akanksha.org/akanksha-ai/api/modules/auth/google/callback`
   to **Authorised redirect URIs** on the OAuth client.
5. **Database user**: SELECT on the data databases, full rights on `AI` only.
6. **nginx**: paste `deploy/nginx-akanksha-ai.conf` into the `tether.akanksha.org` server block,
   then `sudo nginx -t && sudo systemctl reload nginx`. The block turns buffering off because
   answers are streamed.
7. **First deploy by hand**: `cd /home/ec2-user/Akanksha_AI && bash deploy/deploy.sh`.

## Deploying by hand

```sh
cd /home/ec2-user/Akanksha_AI
git fetch origin && git checkout main && git reset --hard origin/main
bash deploy/deploy.sh
```

`deploy/deploy.sh` installs dependencies, builds the client beside the live files, applies pending
migrations to the AI database, swaps the new build in, restarts PM2 and waits for `/api/health`,
`/api/health/db` and the page. If the build or a migration fails, the running version is left as
it was. It never touches `.env`.

## CI/CD

`.github/workflows/ci-cd.yml`:

| When | What runs |
|------|-----------|
| Pull request to `main` | **CI** |
| Push to `main` (a merge) | CI, then **deploy** if CI passed |
| *Run workflow* button | The same, to re-deploy `main` without a new commit |

**CI** runs on GitHub's machines, with a throwaway MySQL and made-up keys (no real database, API
key or account):

- Client: `oxlint`, then the production build with `VITE_BASE_PATH=/akanksha-ai/`.
- Server: every file parses (`npm run check`); no `.env` file is committed; all migrations apply
  to an empty database, and applying them again changes nothing; then the smoke test
  (`server/scripts/smoke.mjs`) starts the real server and checks that every module loads, health
  and the database answer, the API refuses a caller with no session, an invited super admin gets
  in, a stranger does not, and the client page is served.

CI does not ask Claude anything, so it costs no API credit and does not test answers. That is the
evaluation set on the roadmap.

**Deploy** runs on a **self-hosted runner on the app server**, so it needs no AWS role, SSH key or
GitHub secret. It resets the checkout to the tested commit and runs `deploy/deploy.sh`; if that
fails it deploys the previous commit again. It then checks `<CLIENT_URL>/api/health` from the
server's `.env`. CI never runs on that runner, so code from a pull request never executes on the
server.

A migration that ran before a failure is not undone by the rollback: the previous code then runs
against the newer tables. Keep migrations additive (new tables, new nullable columns), as they
are today, so that stays safe.

### Switching the deploy on (once)

Until this is done the pipeline still runs CI on every pull request and merge; the deploy step
reports "switched off" instead of failing.

A runner belongs to one repository, so Alumni Connect's or Tether's runner cannot be shared: this
installs another one beside them. Needs a repository admin and SSH access to the app server.

1. On GitHub: **Akanksha_AI > Settings > Actions > Runners > New self-hosted runner > Linux / x64**.
   Keep that page open; it shows the download lines and a one-time `--token`.

2. On the server, as `ec2-user` (the user that owns the checkout and the PM2 process), in a folder
   of its own:

   ```bash
   mkdir -p ~/actions-runner-akanksha-ai && cd ~/actions-runner-akanksha-ai
   # Download + extract: copy the exact curl/tar lines from the GitHub page.
   ./config.sh --url https://github.com/The-Akanksha-Foundation-Pune/Akanksha_AI \
     --token <TOKEN FROM GITHUB PAGE> \
     --name akanksha-ai-prod-ec2 --labels akanksha-ai-prod --work _work --unattended
   sudo ./svc.sh install ec2-user
   sudo ./svc.sh start
   ```

   The `akanksha-ai-prod` label must match `runs-on` in `ci-cd.yml`.

3. Make sure the runner can find `node`, `npm`, `pm2` and `git`. The service uses the PATH captured
   in `~/actions-runner-akanksha-ai/.path` at config time; if Node comes from nvm, check that file
   contains the nvm `bin` directory (compare with `~/actions-runner-alumni-connect/.path`, which
   works), then `sudo ./svc.sh stop && sudo ./svc.sh start`.

4. Check the checkout can fetch without a prompt:
   `cd /home/ec2-user/Akanksha_AI && git fetch origin main`.

5. GitHub > Settings > Actions > Runners should list `akanksha-ai-prod-ec2` as **Idle**. Then set
   the repository variable `DEPLOY_ENABLED` = `true` (Settings > Secrets and variables > Actions >
   Variables) and trigger the first deploy from **Actions > CI/CD > Run workflow**.

To require a person to approve each production deploy, add required reviewers to the `production`
environment (Settings > Environments). To stop direct pushes deploying untested code, protect
`main` and require the two CI checks.

### Running the checks yourself

```sh
npm run lint --prefix client
npm run check --prefix server
npm run smoke --prefix server        # stop `npm run dev` first: it starts the server on the same port
```

Run locally, the smoke test only reads (health checks and refused requests). Do not set
`SMOKE_SIGNIN=1` outside CI: it signs in through dev sign-in, which creates a user row.

## If something is wrong

| Symptom | Look at |
|---------|---------|
| 502 at /akanksha-ai/ | `pm2 logs akanksha-ai`; is the port in nginx the same as `PORT`? |
| Page is blank, assets 404 | `BASE_PATH` in `.env` does not match the nginx path; redeploy |
| Sign-in page loads, API calls 404 or hit another app | the nginx block sits below another app's `/api/` block |
| Answer appears all at once, or stops after a minute | `proxy_buffering off` / `proxy_read_timeout` missing in nginx |
| Google says redirect_uri_mismatch | the production callback URI (setup step 4) |
| Signed in, then asked to sign in again | `CLIENT_URL` must be the exact public https address; cookies are `Secure` in production |
| Deploy job waits forever | the runner is offline: `sudo ./svc.sh status` in its folder |
