# Feature 008: 真实文字对话

> Date: 2026-08-06
>
> Status: deterministic test-Agent slice implemented; YOS pending

## Background

The visual homepage previously kept submitted text only in browser state. This
slice connects that approved interface to durable PostgreSQL state and a stable
Agent boundary, without implying that YOS or a real model is already online.

## Delivered

- PostgreSQL repositories for current conversations, messages, runs, and
  ordered run events.
- A conversation service that persists the human message before Agent work,
  prevents concurrent active runs, and reconciles interrupted work on restart.
- A run coordinator that persists streaming deltas and truthful completed,
  failed, or stopped terminals.
- Versioned snapshot, submit, SSE, cancel, and retry endpoints.
- Submission and retry idempotency, including the forward-only
  `002_retry_idempotency.sql` migration.
- A browser client that restores history, reconciles optimistic messages,
  streams Agent output, reconnects from an event cursor, and exposes stop or
  retry only in the relevant state.
- Desktop and mobile behavior using the existing approved visual composition;
  Live mode remains a separate interface.

## Key Decisions

- Yoyoo Space owns deterministic persistence, state transitions, delivery, and
  recovery. An Agent adapter owns interpretation and response generation.
- The deterministic adapter is an acceptance tool. Its fixed response proves
  the platform path but is not described as AI intelligence or YOS behavior.
- Only one run may be queued or running in a conversation. A different submit
  during that window receives a visible conflict instead of creating competing
  streams.
- Applied migration `001` was not edited. Retry identity was added with
  forward-only migration `002` and checksum-protected migration execution.
- Development uses a configured local owner identity. Public deployment remains
  blocked until authentication or an explicit private-network boundary exists.

## Rejected Alternatives

- Store only browser state: rejected because refresh, reconnection, and retry
  could not be trustworthy.
- Put YOS payloads directly into UI or database types: rejected because it would
  make the general platform depend on the first adapter.
- Allow concurrent runs and merge output in the browser: rejected because event
  ownership and retry semantics would become ambiguous.
- Rewrite migration `001`: rejected because an applied migration checksum is an
  immutable deployment contract.

## Verification

- `git diff --check`: passed.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm test`: 12 of 12 unit and UI checks passed.
- `npm run test:integration`: 17 of 17 database, service, and HTTP/SSE checks
  passed.
- `npm run build`: passed with the homepage and five dynamic API routes.
- `npm run test:e2e`: 10 of 10 Playwright checks passed across desktop and
  mobile Chromium.
- `npm run db:migrate`: passed using `.env.local`; both applied migrations were
  checksum-verified and skipped without data changes.
- PostgreSQL 17 reported healthy on `127.0.0.1:55432`.

During the whole-project pass, the UI suite exposed an unsupported `scrollTo`
assumption in the test DOM. The thread auto-scroll now uses the standard
`scrollTop = scrollHeight` path; the targeted six-check UI suite and every full
gate passed after that correction.

The final runbook check also exposed that the migration command did not load the
documented `.env.local` file. The package script now uses Node 24's built-in
`--env-file-if-exists` option, adding no dependency and keeping credentials out
of source code.

## Remaining

- Read-only verification of the current YOS request, authentication, streaming,
  cancellation, and error contract.
- A YOS adapter backed by sanitized fixtures and real ten-turn acceptance.
- Browser microphone capture and audio transport.
- Public owner authentication and a multi-conversation history surface.
