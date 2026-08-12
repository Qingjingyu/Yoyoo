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
5. Generate `POSTGRES_PASSWORD` and `YOYOO_AUTH_PEPPER` on the host; never paste
   them into Git, chat, shell arguments, or deployment logs.

## Staging sequence

Copy `.env.example` to an untracked `.env`, replace every placeholder, then:

```bash
docker build --tag "yoyoo-space:<commit>" ../..
docker compose --env-file .env -f compose.yml config --quiet
docker compose --env-file .env -f compose.yml up -d postgres
docker compose --env-file .env -f compose.yml run --rm migrate
docker compose --env-file .env -f compose.yml run --rm bootstrap
docker compose --env-file .env -f compose.yml run --rm --no-deps app \
  node scripts/provision-public-owner.mts
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
$COMPOSE run --rm --no-deps app node scripts/provision-public-owner.mts
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

The provisioning command asks for the password twice without echo and prints
one recovery code once. Store that code in a password manager. It will only bind
the active human workspace owner whose AI Card ID is `AI_100001`.

## Verification

```bash
docker compose --env-file .env -f compose.yml ps
curl --fail --silent https://app.yoyooai.com/api/health
```

Then verify in a private browser window:

- anonymous `/` redirects to `/login`;
- wrong credentials remain rejected;
- `AI_100001` plus the owner password can log in;
- rooms, one text message, one file download, refresh, and logout work;
- mobile layout has no overflow and the browser console stays clean.

## Rollback

Application rollback is image-only while the forward schema remains compatible:

1. Set `YOYOO_IMAGE` back to the recorded prior image digest.
2. Run `docker compose --env-file .env -f compose.yml up -d app`.
3. Re-run health, login, room, and attachment smoke checks.

Do not automatically restore PostgreSQL or BlobStore. Data restore overwrites
current state and requires a new backup, an exact restore point, and separate
approval. Applied SQL migrations are immutable and are never rolled back in
place.
