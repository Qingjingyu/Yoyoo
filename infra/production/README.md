# Yoyoo Public Deployment

This package serves `app.yoyooai.com` with one private Next.js application, one
private PostgreSQL database, and persistent BlobStore storage. A dedicated host
can use the bundled Caddy service. A host that already runs Nginx must add
`compose.nginx.yml`, which exposes the application only on
`127.0.0.1:${YOYOO_APP_PORT:-4173}` and disables Caddy unless its explicit
profile is selected. PostgreSQL is never exposed to the host network.

## Required evidence before production changes

1. Confirm the target host, SSH access, available disk, and Docker Compose.
2. Confirm the `app.yoyooai.com` A/AAAA records point only to that host.
3. Create and verify a PostgreSQL plus BlobStore backup on the current system.
4. Record the currently running image digest and keep it available for rollback.
5. Generate `POSTGRES_PASSWORD` on the host; never paste it into Git, chat,
   shell arguments, or deployment logs. Keep the existing auth pepper only for
   the bounded rollback window; AI Card-only mode does not load it.
6. Require a healthy `https://id.yoyooai.com`, a passing AI Card production
   doctor, and the exact registered `yoyoo_prod` callback before setting the
   five `YOYOO_AICARD_*` values.

## Staging sequence

Copy `.env.example` to an untracked `.env`, replace every placeholder, then:

```bash
docker build --tag "yoyoo-space:<commit>" ../..
docker compose --env-file .env -f compose.yml config --quiet
docker compose --env-file .env -f compose.yml up -d postgres
docker compose --env-file .env -f compose.yml run --rm migrate
docker compose --env-file .env -f compose.yml run --rm bootstrap
docker compose --env-file .env -f compose.yml up -d app caddy
```

### Existing Nginx host

On a server whose ports 80 and 443 are already owned by Nginx, use both Compose
files for every command:

```bash
export COMPOSE="docker compose --env-file .env -f compose.yml -f compose.nginx.yml"
$COMPOSE config --quiet
$COMPOSE up -d postgres
$COMPOSE run --rm migrate
$COMPOSE run --rm bootstrap
$COMPOSE up -d app
```

Set `YOYOO_POSTGRES_VOLUME` and `YOYOO_BLOB_VOLUME` when a deployment must use
new, empty production storage while retaining an imported or previous volume as
a rollback source. Never point a public deployment at a development database
until test fixtures and private data have been audited.

Proxy the dedicated hostname to `http://127.0.0.1:${YOYOO_APP_PORT:-4173}` and
let the host's existing certificate tooling manage TLS. Back up the active
Nginx configuration and verify unrelated virtual hosts before and after the
change. `nginx.app.conf` is the tracked HTTP bootstrap configuration; enable it
only after confirming that port `4173` is bound to loopback and the application
health endpoint returns `200`. Issue TLS and enable the HTTPS redirect after DNS
for `app.yoyooai.com` resolves to the target host.

New deployments use `YOYOO_HUMAN_AUTH_MODE=aicard` and never provision a Yoyoo
password. The bootstrap Principal is only the product-local Owner anchor; the
first verified human AI Card callback maps authoritative `AI_100001` to it.

For an existing password-mode deployment, do not switch blindly:

1. Back up PostgreSQL, BlobStore, environment, proxy configuration and the
   current image; verify the backup manifest.
2. On the current additive release, complete a real AI Card login as the Owner
   and verify room history, one message and one private file.
3. Deploy the new image and forward migrations with
   `YOYOO_HUMAN_AUTH_MODE=aicard`, retaining the prior image and pepper.
4. Run `$COMPOSE run --rm --no-deps app npm run auth:finalize-aicard-owner`
   without `--apply`. It must report one mapped Owner and at least one active AI
   Card session.
5. Verify public login, refresh, logout, mobile layout and anonymous denial.
6. Only after a new explicit approval, rerun the same command with `-- --apply`.

## Verification

```bash
docker compose --env-file .env -f compose.yml ps
curl --fail --silent https://app.yoyooai.com/api/health
```

Then verify in a private browser window:

- anonymous `/` redirects to `/login`;
- the retired Yoyoo password API is not anonymously reachable;
- rooms, one text message, one file download, refresh, and logout work;
- mobile layout has no overflow and the browser console stays clean.
- AI Card login returns to the exact callback, maps `AI_100001` to the existing
  owner Principal, and a second browser reuses the same Card.

## Rollback

Application rollback is image-only while the forward schema remains compatible:

1. Set `YOYOO_IMAGE` back to the recorded prior image digest.
2. Run `docker compose --env-file .env -f compose.yml up -d app`.
3. Re-run health, login, room, and attachment smoke checks.

Before finalization apply, identity rollback is image and environment only.
After apply, restoring password mode additionally requires re-enabling the
backed-up legacy credential and restoring the Owner's legacy Card projection
from the verified backup. Treat that data change as a separate approved
operation; never alter Principal, room, message or file IDs.

Do not automatically restore PostgreSQL or BlobStore. Data restore overwrites
current state and requires a new backup, an exact restore point, and separate
approval. Applied SQL migrations are immutable and are never rolled back in
place.
