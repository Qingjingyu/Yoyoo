# AI Card Authority Cutover Implementation Plan

> Date: 2026-08-15
> Scope: make AI Card the only public identity authority without deleting Yoyoo business Principals

## Product Boundary

- AI Card owns account registration, passwords, permanent Card IDs, identity status, and cross-product identity.
- Yoyoo owns local Principal projections, workspace membership, permissions, rooms, messages, files, tasks, and audit.
- A Yoyoo Principal UUID remains the stable foreign-key anchor. It is mapped to an AI Card identity by verified issuer, client ID, pairwise Subject, and Card ID.
- The `system:yoyoo` Principal is a product actor, not an AI Card account, and must not display or reserve an `AI_` number.

## Not Doing

- Do not delete the owner Principal, workspace, room, membership, history, or files.
- Do not infer identity from a handle, display name, or legacy `principals.ai_card_id` string.
- Do not remove already-applied migrations or rewrite their checksums.
- Do not delete production credentials until a verified authoritative owner mapping and a working AI Card session exist.
- Do not add another authentication dependency or protocol.

## Step 1: Lock The Runtime Contract With Tests

Files:

- `tests/agents/human-auth-http.test.ts`
- `tests/agents/human-auth-proxy.test.ts`
- `tests/agents/aicard-runtime-config.test.ts`
- `tests/scripts/finalize-aicard-owner-cutover.test.ts`

Acceptance:

- Production accepts `YOYOO_HUMAN_AUTH_MODE=aicard`.
- The legacy password login endpoint is not a public route in AI Card-only mode.
- AI Card configuration is mandatory in AI Card-only mode.
- Cutover refuses missing, conflicting, non-owner, or sessionless mappings without mutation.
- Dry-run is the default and repeated finalization is safe.

## Step 2: Implement AI Card-only Runtime Mode

Files:

- `src/server/auth/human-auth-http.ts`
- `src/server/auth/human-auth-runtime.ts`
- `src/server/auth/human-auth-proxy.ts`
- `src/server/runtime.ts`
- `src/app/api/v1/auth/login/route.ts`

Acceptance:

- `local` remains available only for local development.
- `password` remains a rollback mode but is no longer the production default.
- `aicard` resolves and refreshes federated sessions without enabling password login.
- Requests to the old login API return a stable, non-secret error when disabled.

## Step 3: Add Guarded Data Finalization

Files:

- `scripts/finalize-aicard-owner-cutover.mts`
- `tests/scripts/finalize-aicard-owner-cutover.test.ts`
- `package.json`

Transaction preconditions:

1. Exactly one active human workspace owner exists.
2. Exactly one verified mapping for the configured issuer/client points to that Principal.
3. The mapping Card ID is `AI_100001` and the mapped Principal type is human.
4. At least one unexpired, unrevoked AI Card session exists for that exact mapping.

Apply behavior:

- Revoke remaining password sessions.
- Disable the legacy owner credential rather than deleting it in this release.
- Clear legacy `principals.ai_card_id` projections, including the system actor's stale `AI_100002`.
- Preserve Principal UUIDs and every Yoyoo business foreign key.
- Default to report-only mode; require `--apply` for mutation.

## Step 4: Production Contract And Documentation

Files:

- `infra/production/compose.yml`
- `infra/production/README.md`
- `README.md`
- `Product-Spec.md`
- `DEV-PLAN.md`
- `开发过程/000_Roadmap.md`
- `开发过程/038_Feature_AI_Card唯一身份收口.md`

Acceptance:

- New deployments default to `aicard` mode.
- Runbook orders backup, additive deploy, real owner login, report-only check, explicit approval, apply, smoke tests, and rollback.
- Documentation clearly distinguishes AI Card identity data from Yoyoo product-local data.

## Verification

Run in this order:

1. Focused unit/script tests.
2. `npm run lint`
3. `npm run typecheck`
4. `npm test`
5. `npm run db:up`
6. `npm run test:integration`
7. `npm run build`
8. Secret scan over changed files.

Production deployment and data finalization remain separate gates. A successful local build is not production acceptance.
