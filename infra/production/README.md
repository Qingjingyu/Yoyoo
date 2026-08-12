# Yoyoo Public Deployment

This package serves `app.yoyooai.com` with Caddy TLS, one private Next.js
application, one private PostgreSQL database, and persistent BlobStore storage.
It does not expose PostgreSQL or the application container directly.

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
