# Feature 009: YOS 真实接入

> Date: 2026-08-06
>
> Status: adapter and controlled resilience acceptance verified; protocol limits remain

## Background

The deterministic Agent proved Yoyoo's persistence and delivery path but did
not provide real intelligence. This slice verifies the current YOS contract
without modifying YOS, then implements YOS as the first external Agent adapter
without leaking its internal types into the Yoyoo platform core.

## Verified YOS Source

- Repository: `/Users/subai/A/10_公司项目/BeautyAgentic/02_产品项目/01_Y-OS/工程/YOS`
- Branch: `fix/component-install-rollback-20260724`
- Commit: `f1d5a9cec79cb46549688bcf3f28058841883f64`
- Local Web Console: `127.0.0.1:3457`, password protection enabled.
- YOS source and runtime configuration were read only. No YOS file, process
  setting, password, or database schema was changed.

## Confirmed Contract

| Capability | Confirmed behavior |
| --- | --- |
| Health | Public `GET /api/health` checks the Web Console process. |
| Authentication | `GET/POST /api/auth` establishes an HttpOnly session cookie. |
| Agent status | Authenticated `GET /api/status` exposes idle/busy/offline state. |
| Submit | Authenticated `POST /api/send` durably queues a C4 message. |
| Reply | `GET /api/poll?since_id=N` returns complete inbound/outbound messages. |
| Token streaming | Not exposed. |
| Correlated run ID | Not exposed by the Web Console send contract. |
| Cancellation | Not exposed. |

## Delivered

- `YosWebConsoleAdapter` with validated HTTP responses, session-cookie login,
  whole-message reply translation, abort handling, timeout, and safe errors.
- Truthful descriptor capabilities: `streaming: false`,
  `cancellation: false`.
- Environment-selected runtime registration with no silent fallback for invalid
  YOS configuration.
- `dev:yos` and `start:yos` launchers that load the existing `~/yos/.env` using
  Node 24 `process.loadEnvFile()` without copying or printing credentials.
- Contract tests backed by a real local HTTP server fixture and a PostgreSQL
  conversation-service integration test.
- A deterministic SSE regression test for a terminal-event commit race found
  during the full integration gate.
- A 180-second default response window based on an observed valid YOS reply at
  about 128 seconds; explicit timing configuration still overrides the default.
- Pre-send draining of an unmatched Web Console inbound message so a delayed
  reply from an interrupted request cannot be persisted as the next run's reply.

## Key Decisions

- YOS remains an adapter, not a Yoyoo domain dependency. Yoyoo owns durable
  messages, run state, delivery, and browser events; YOS owns interpretation and
  reply generation.
- The first outbound message after the send cursor is treated as the reply.
  Yoyoo permits only one active run per conversation, reducing ambiguity within
  the currently available Web Console contract.
- A whole YOS reply becomes one `text_delta` followed by `completed`. This keeps
  the general event contract stable without claiming token-level streaming.
- Because the Web Console has no correlated run ID, Yoyoo serializes against its
  ordered channel history: a latest unmatched inbound row must receive an
  outbound row before a new request is sent.
- Credentials are loaded only in the server process. Upstream response bodies
  are not copied into user-visible operational errors.
- The deterministic Agent remains the normal development default. YOS mode is
  explicit, so missing local credentials cannot silently break the baseline.

## Rejected Alternatives

- Read YOS SQLite directly: rejected because it couples Yoyoo to one host,
  filesystem, and private table schema.
- Import YOS C4 modules into Yoyoo: rejected because it collapses the adapter
  boundary and prevents other Agent implementations.
- Pretend polling is token streaming or expose a stop button: rejected because
  the verified YOS contract does not support either capability.
- Copy the YOS password into tracked configuration: rejected. The launcher
  reads the existing ignored server environment file in process.

## Verification

- YOS adapter contract tests: 7 passed.
- Runtime selection checks: 4 passed; startup-loader check: 1 passed.
- Final automated gates: 25 unit/UI checks passed; 18 fixture/database/HTTP
  integration checks passed; three live-YOS checks were skipped in the normal
  suite and passed when explicitly enabled (one direct smoke plus two resilience
  checks).
- Desktop and mobile Playwright acceptance: 10 of 10 checks passed.
- ESLint, TypeScript checking, the production Next.js build, migration replay,
  and whitespace validation passed.
- PostgreSQL YOS fixture path: passed with persisted human and Agent messages
  and ordered status/status/delta/completed events.
- Real direct YOS smoke: passed in about 18 seconds with a unique reply marker.
- Full Yoyoo API smoke on `127.0.0.1:4175`: submit 202, SSE 200/completed,
  unique YOS marker restored from PostgreSQL.
- Real Chromium inspection: persisted human/YOS messages visible; browser
  console contained zero errors and zero warnings.
- Ten consecutive real YOS marker exchanges passed 10 of 10 sequential rounds.
- Controlled resilience acceptance passed 2 of 2 live checks: a proxy cut after
  YOS accepted a request produced a retriable `YOS_CONNECTION_FAILED`, and an
  owned Yoyoo process restart produced `PROCESS_RESTARTED` before a successful
  retry with exactly one persisted human message.
- The first combined resilience run reproduced stale-reply misassociation: the
  delayed `YOS_NETWORK_CUT_*` reply was persisted for the following restart
  run. The regression failed before the channel-drain fix and passed afterward
  against a fresh production build.
- One valid YOS reply arrived at about 128 seconds, eight seconds after the old
  120-second default. A virtual-clock regression failed on the old default and
  passed with the new 180-second window.
- One initial browser-gate run exposed a stale development singleton after hot
  reload: the old process predated the new runtime `agentId`. Restarting that
  development process restored the current-conversation API to 200, after which
  all 10 browser checks passed. No production code change was needed.
- No dependency was added.

## Remaining

- The current Web Console contract cannot guarantee cross-system exactly-once
  behavior after a crash that occurs after YOS accepts a message but before
  Yoyoo persists the terminal reply.
- Public owner authentication, voice transport, and multi-conversation history
  remain outside this feature.
