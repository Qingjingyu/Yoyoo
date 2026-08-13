# 035 Feature: AI Card Only Agent Admission

## Background

Yoyoo already supported authorizing an AI Card Agent, but the Settings page and
public workspace endpoint still offered a second path that created a local
Agent identity and a `yya_` credential. That contradicted the unified identity
model: a YOS instance could become one identity in AI Card and another identity
inside Yoyoo.

The accepted boundary is now explicit. YOS or another external AI first owns
and claims one AI Card. Its human controller then authorizes that existing Card
into Yoyoo. Yoyoo creates only the local Principal, membership, permissions and
runtime mapping needed to provide service in the workspace.

## Key Decisions

- AI Card is the only issuer for new human and AI identities.
- Yoyoo does not locally create a new AI, allocate its Card, or identify it by
  nickname or handle.
- Settings exposes `授权 AI 接入` and explains that YOS or another AI must first
  own an AI Card.
- The public Agent-creation POST returns `409 AI_CARD_REQUIRED` without touching
  the database.
- Existing `yya_` Agents are not deleted. Listing, rotation, revocation and the
  legacy Gateway protocol remain available for migration compatibility.
- Internal repository creation stays only as explicit test scaffolding for that
  compatibility protocol. It is not exposed as a product or browser API.

## Rejected Alternatives

- Let Yoyoo create an AI Card on behalf of YOS: rejected because it blurs who
  owns and claims the external AI identity.
- Keep both local and AI Card creation: rejected because duplicate identities
  would remain possible.
- Resolve AI by display name or handle: rejected because mutable presentation
  data is not an identity or authorization proof.
- Delete all existing Gateway Agents now: rejected because it would break
  deployed bridges and historical attribution without an approved migration.

## Implementation

- Removed the local creation form and `createAgent` browser client capability.
- Replaced normal and empty-state admission actions with AI Card authorization.
- Closed `POST /api/v1/workspaces/current/agents` with a stable visible error.
- Kept existing Gateway Agent management and transport behavior unchanged.
- Refactored Gateway integration setup to use an explicit internal fixture so
  tests do not depend on a forbidden public product flow.
- Extended the existing AI Card/Yoyoo federation acceptance with a real YOS
  identity flow: sequential Card issuance, Ed25519 node claim, controlled Card
  authorization, short-lived runtime token, exact room ID admission and a
  persisted Agent message.
- Fixed AI Card consent validation to accept the current `AI_100002` form as
  well as migration-era `aic_` IDs. The UI already displayed the new ID, but
  the old route-only regex rejected it before this end-to-end test exposed the
  mismatch.

## Verification

- Test-first RED evidence: the old implementation returned `201`, rendered
  `兼容接入 AI`, and exposed local display-name/handle fields.
- Focused UI: 7 of 7 passed.
- Focused PostgreSQL/HTTP integration: 9 of 9 passed, including rejection with
  no listed Agent for the attempted handle and legacy Gateway regressions.
- TypeScript typecheck: passed after the implementation.
- Full Yoyoo lint, typecheck and production build: passed.
- Full Yoyoo unit/UI suite: 38 files and 188 tests passed.
- Full Yoyoo PostgreSQL integration suite: 23 files passed, 5 opt-in live files
  skipped; 130 tests passed and 7 live checks skipped.
- Full Yoyoo Playwright suite: 38 of 38 desktop/mobile checks passed.
- Cross-repository federation: real production builds for AI Card and Yoyoo,
  isolated databases and temporary HTTPS proxies passed the human and YOS
  acceptance. `AI_100001` was reused by two human sessions; YOS received
  `AI_100002`, mapped to one stable Agent Principal with no `yya_` credential,
  obtained an `agent.runtime` token, discovered its exact authorized room ID
  and persisted one message as that Principal. Reauthorization reused the same
  pairwise Subject and Principal.

No production configuration, identity or data was changed in this local slice.
