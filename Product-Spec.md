# Yoyoo Space Product Spec

> Current version: V0.14 Internal Daily Release
>
> Date: 2026-08-11
>
> Status: implemented and locally verified

## Goal

Turn the locally verified Yoyoo product into a repeatable internal daily-use
release. One explicit command must prepare the existing database, apply only
forward migrations, build the production application, and start the chosen
local Agent mode on the stable loopback URL.

This phase packages existing capabilities. It does not add another product
module or change the accepted homepage and conversation information
architecture.

## Target User

- Su Bai using Yoyoo every day on this Mac with persistent rooms, messages,
  files, Codex, and YOS.
- A maintainer diagnosing local readiness, taking a recoverable backup, or
  restarting the application without reconstructing commands from history.

## Scope

### Internal launcher

- Provide one production-mode command for the real Codex + YOS configuration.
- Provide an explicit deterministic local mode for offline acceptance.
- Reuse the existing Docker Compose database, checksum-verified migration
  runner, Next.js production build, and YOS environment wrapper.
- Bind the product only to `127.0.0.1` on the stable internal port `4173`.
- Forward termination signals to the application and leave PostgreSQL data and
  uploaded files intact when the application stops.

### Readiness diagnosis

- Check the Node version, Docker CLI and daemon, local environment file,
  database configuration, Codex login, YOS environment file, production build,
  PostgreSQL health, blob-store access, and optional application reachability.
- Separate required failures from optional or runtime warnings. Never report a
  healthy product from process existence alone.
- Keep credentials and private file contents out of output.

### Recoverable local backup

- Create a timestamped backup under the ignored local `output/backups/internal`
  directory.
- Include a PostgreSQL custom-format dump and the authoritative blob directory.
- Write a manifest containing artifact sizes and SHA-256 digests without
  secrets or machine-private configuration.
- Verify the dump inventory, blob archive inventory, and manifest hashes after
  creation. A backup is not accepted merely because files exist.
- Document restoration as a separately approved destructive operation; do not
  add an automatic restore command in this phase.

### Handoff

- Document daily start, local fallback, doctor, backup, verification, stop, and
  recovery-escalation procedures.
- Reconcile README, roadmap, feature evidence, Product Spec, and development
  plan to V0.14.

## Success Criteria

- A fresh production build starts at `http://127.0.0.1:4173` through one
  command after non-destructive preparation.
- Stopping and restarting the application preserves an existing room, message,
  and attachment record.
- The doctor returns a non-zero exit code for missing required prerequisites and
  prints actionable, redacted results.
- A generated backup passes both PostgreSQL and blob-archive verification and
  its manifest digests match the produced files.
- Existing unit, integration, production build, and desktop/mobile browser gates
  remain green.

## Non-Goals

- No public deployment, public authentication, public registration, reverse
  proxy, domain, TLS, multi-human invitation, or external notification service.
- No PM2, launchd, Electron, Docker image for the application, or new runtime
  dependency.
- No automatic database restore, database reset, volume deletion, hard room
  deletion, or migration rewrite.
- No production object storage, malware scanning, OCR, semantic search, or
  native binary-Agent attachment interpretation.
- No redesign, new navigation destination, or new chat feature.

## Safety Boundary

- The launcher may create missing local runtime directories, start the existing
  PostgreSQL service, apply forward migrations, build, and start Yoyoo.
- Backup is additive and must never alter live records or blobs.
- Restore, reset, deletion, public exposure, and credential rotation require a
  separate plan, a current backup, and explicit approval.
