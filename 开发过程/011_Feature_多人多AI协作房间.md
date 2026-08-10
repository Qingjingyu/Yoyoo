# Feature: 多人多 AI 底座与单人多 AI 协作房间

> Date: 2026-08-07
>
> Status: implemented and verified

## Background

V0.1 treated conversation as one owner talking to one Agent. That interaction
worked, but the product direction is a shared IM-like workspace in which humans
and multiple AI Agents are first-class participants. V0.2 therefore upgrades
the domain to multi-human + multi-Agent while exposing a smaller first UI:
Su Bai and three independently addressable Agents in one room.

The accepted homepage is intentionally frozen. All new product behavior belongs
to `/conversation` and the room APIs.

## Delivered Scope

- Forward-only migration `003` for Principals, workspaces, memberships, rooms,
  messages, mentions, Agent bindings, runs, ordered events, delegations, and
  Artifacts, including V0.1 backfill.
- Mention-only routing with explicit one-Agent or multi-Agent selection.
- Independent parallel runs with failure isolation and idempotent mutation
  boundaries.
- Typed Planner-to-Builder delegation with linked parent/child runs.
- Visible human intervention, capability-gated stop, and retry.
- Persisted Agent replies and Markdown Artifacts with producer and source-run
  provenance.
- A full-height room timeline, compact Agent status strip, bottom composer,
  loading/empty/error/active/stopped/success states, and responsive mobile
  layout.
- A stable third room seat that uses Local Reviewer by default and switches to
  the real YOS Web Console adapter in YOS mode.

## Key Decisions

1. The platform owns deterministic responsibilities: identity, membership,
   routing, permissions, persistence, delivery, idempotency, run state,
   delegation records, Artifact provenance, and audit facts.
2. Agents own interpretation and intelligence. There is no central “Brain” in
   Yoyoo and no provider-specific payload in room UI or storage contracts.
3. The default listener policy is `mention_only`. “全员参与” is a deliberate
   routing action so an ordinary message cannot wake every Agent implicitly.
4. Planner and Builder remain labeled local acceptance Agents. Their deterministic
   delegation and Artifact behavior proves the platform loop but is not claimed
   as production intelligence.
5. YOS is an adapter, not the platform core. In YOS mode it reuses the stable
   Reviewer principal identity, preventing a fourth ghost member after mode
   changes or refresh.
6. YOS advertises `streaming: false` and `cancellation: false` because its
   current Web Console contract exposes whole replies and no cancellation API.
   The UI therefore does not render a stop action it cannot fulfill.

## Rejected Alternatives

- Keep the one-Agent transcript and add more avatars: rejected because it does
  not create independent identities, routing, runs, delegation, or recovery.
- Build multi-human invitations and organization management in the same release:
  rejected because it expands authentication and authorization before the core
  multi-Agent loop is proven.
- Make every Agent listen to every message: rejected because it creates noise,
  cost, accidental work, and unbounded fan-out.
- Treat YOS as the shared orchestration brain: rejected because Yoyoo must stay
  a universal human-AI collaboration platform and support other adapters.
- Show a fake YOS stop control: rejected because visible operations must match
  actual adapter capabilities.

## Verification Evidence

### Test-first and targeted checks

- Runtime selection tests prove deterministic default mode and YOS mode retain
  exactly three stable room Agent seats.
- UI tests prove routing controls, delegation and Artifact presentation,
  intervention/retry actions, error recovery, and capability-gated YOS actions.
- PostgreSQL integration proves parallel execution, durable delegation,
  intervention, Agent messages, Artifact provenance, isolated failure, retry,
  and refresh recovery.
- Desktop Chromium acceptance proves all-Agent routing, Planner-to-Builder
  delegation, Artifact persistence after reload, Reviewer intervention, no
  horizontal overflow, and no application console errors.
- A compact `320x568` browser check proves visible composer/navigation and
  minimum `44x44` core controls.

### Real YOS checks

- `tests/integration/yos-live.test.ts`: passed against the local YOS service on
  2026-08-07 in 14.11 seconds, including health, authentication, a private
  message, and unique-marker reply.
- `tests/integration/yos-room-live.test.ts`: passed on 2026-08-07 in 9.14
  seconds. It proved a three-Agent room with YOS in the third seat, YOS-only
  routing, completed execution, and the marked YOS reply present after reading
  a fresh authoritative room snapshot.

### Final gate

- `pnpm lint`: passed.
- `pnpm typecheck`: passed.
- `pnpm test`: 11 files, 42 of 42 checks passed.
- `pnpm test:integration`: 8 files and 29 of 29 default checks passed; 4 live
  checks were correctly skipped unless `YOS_LIVE_TEST=1` is explicit.
- `pnpm build`: passed with all homepage, room, compatibility, intervention,
  retry, and SSE routes present in the optimized production build.
- `pnpm test:e2e`: 16 of 16 checks passed across desktop and mobile Chromium.
  The suite covers the frozen homepage, three-Agent room, explicit all-Agent
  routing, delegation, Artifact persistence after reload, intervention, compact
  controls, horizontal overflow, reduced motion, and application console errors.

## Known Limits

- The UI exposes one human only; multi-human authentication, invitation, and
  organization administration are not implemented.
- Planner, Builder, and default Reviewer are local deterministic Agents. Only
  the YOS seat is a verified real external runtime in this release.
- YOS Web Console has no correlated upstream run ID, token stream, or cancel
  endpoint. Yoyoo serializes that channel and reports only supported abilities.
- Audio transport and public deployment authentication remain separate work.
