# Yoyoo Space v0.1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver one durable, visually distinctive conversation between one owner and one configured Agent, with YOS as the first adapter.

**Architecture:** A self-hosted Next.js Node application owns the browser UI, versioned HTTP/SSE API, conversation service, run coordinator, and PostgreSQL persistence. Agent-specific behavior is isolated behind a capability-aware adapter contract; the UI consumes only Yoyoo Space messages, runs, and events.

**Tech Stack:** Node.js, Next.js, React, TypeScript, PostgreSQL, plain CSS design tokens, Lucide, Vitest, Testing Library, and Playwright. Exact versions are verified and pinned during Task 1.

**Current status:** Tasks 1-5 are complete. The current-conversation portion of
Tasks 7-8 is complete. Task 9 has an implemented and one-turn-verified YOS Web
Console adapter; full ten-turn/interruption acceptance remains. The history
drawer and source-boundary automation also remain.

---

### Task 1: Reproducible frontend and homepage foundation - Complete

**Files:**
- Create: `package.json`, `package-lock.json`, `tsconfig.json`
- Create: `next.config.ts`, `eslint.config.mjs`, `vitest.config.mts`
- Create: `playwright.config.ts`, `.env.example`
- Create: `src/app/layout.tsx`, `src/app/page.tsx`, `src/app/loading.tsx`
- Create: `src/app/error.tsx`, `src/app/icon.tsx`
- Create: `src/components/home/*`, `src/components/shell/sidebar.tsx`
- Create: `src/styles/tokens.css`, `src/styles/base.css`
- Create: `src/styles/home.css`, `src/styles/responsive.css`
- Test: `tests/ui/home-experience.test.tsx`, `e2e/home.spec.ts`

**Steps:**
1. Verify current official Node, Next.js, React, TypeScript, Vitest, and
   Playwright compatibility; record exact dependency rationale.
2. Write failing tests for the focused hierarchy, submission, Live-mode entry,
   mute and exit behavior, loading, and error states.
3. Create the smallest application and script surface for lint, type checking,
   unit tests, build, and browser tests.
4. Implement the responsive homepage shell, aligned navigation, compact
   abstract Agent presence, and a separate Live-mode interface.
5. Verify desktop and mobile behavior, console output, overflow, contrast,
   reduced motion, production build, and Lighthouse results.
6. Record exact dependency compatibility decisions and evidence.

### Task 2: Database foundation - Complete

**Files:**
- Create: `infra/postgres/docker-compose.yml`
- Create: `infra/postgres/migrations/001_conversation_core.sql`
- Create: `scripts/db-migrate.mjs`
- Create: `src/server/postgres/client.ts`
- Test: `tests/integration/database-foundation.test.ts`

**Steps:**
1. Write failing integration tests for migration repeatability and constraints.
2. Define conversations, messages, runs, and ordered run events with explicit
   status checks, foreign keys, timestamps, idempotency uniqueness, and indexes.
3. Start a new PostgreSQL development container and apply the migration.
4. Prove a second migration run is a no-op and invalid state is rejected.
5. Document the new volume name and prohibit implicit destructive reset scripts.

**Evidence:** PostgreSQL 17 container healthy on `127.0.0.1:55432`; three
integration tests pass for repeatability, checksum protection, constraints,
idempotency, and ordered-event uniqueness. The persistent volume is
`yoyoo_space_pg_data` and no reset script exists.

### Task 3: Agent adapter contract - Complete

**Files:**
- Create: `src/agents/contract.ts`
- Create: `src/agents/registry.ts`
- Create: `src/agents/test-adapter.ts`
- Test: `tests/agents/contract.test.ts`

**Steps:**
1. Write failing tests for descriptor validation, health, ordered status/delta/
   completion/error events, abort signals, and capability-gated cancellation.
2. Implement the minimal contract and registry without vendor fields in shared
   message types.
3. Implement a deterministic test adapter with controllable delay and failure.
4. Prove an unsupported cancel capability cannot be invoked.

**Evidence:** Five contract tests pass for strict portable descriptors, health,
ordered stream completion, truthful stop/failure terminals, and capability-gated
cancellation. The deterministic adapter does not depend on YOS.

### Task 4: Persistent conversation service - Complete

**Files:**
- Create: `src/server/postgres/conversation-repository.ts`
- Create: `src/server/postgres/run-repository.ts`
- Create: `src/server/conversation-service.ts`
- Create: `src/server/run-coordinator.ts`
- Test: `tests/integration/conversation-service.test.ts`

**Steps:**
1. Write failing tests for empty conversation creation, message persistence,
   duplicate submission, streaming completion, stopped runs, failed runs,
   retry, and restart reconciliation.
2. Implement parameterized repositories and transaction boundaries.
3. Persist the user message before invoking the adapter.
4. Persist ordered events and terminal Agent messages from adapter output.
5. Make cancellation and failure truthful; never convert them to completion.

**Evidence:** Seven service integration tests cover persistence before adapter
invocation, duplicate submission, ordered completion, partial failure, stop,
idempotent retry, active-run exclusion, and restart reconciliation.

### Task 5: Versioned HTTP and event stream - Complete

**Files:**
- Create: `src/app/api/v1/conversations/current/route.ts`
- Create: `src/app/api/v1/conversations/current/messages/route.ts`
- Create: `src/app/api/v1/conversations/current/events/route.ts`
- Create: `src/app/api/v1/runs/[runId]/cancel/route.ts`
- Create: `src/server/event-stream.ts`, `src/server/http-response.ts`
- Create: `src/server/runtime.ts`
- Test: `tests/integration/conversation-http.test.ts`

**Steps:**
1. Write failing tests for input limits, structured errors, idempotency headers,
   SSE ordering, `Last-Event-ID`, cancellation, and secret redaction.
2. Implement the smallest resource routes over the conversation service.
3. Reauthorize and reconcile persisted state on every SSE reconnection.
4. Verify an interrupted client cannot create a second run accidentally.

**Evidence:** Versioned snapshot, submit, event-stream, cancel, and retry routes
are implemented. HTTP integration tests cover structured validation,
idempotency, SSE cursor replay, stopped terminals, refresh restoration, and
idempotent retry. Retry metadata is added by forward-only migration `002`.

### Task 6: Owned visual system

**Files:**
- Create: `src/styles/tokens.css`, `src/styles/base.css`
- Create: `src/styles/space.css`, `src/styles/responsive.css`
- Create: `src/components/surface/glass-surface.tsx`
- Test: `tests/ui/glass-surface.test.tsx`

**Steps:**
1. Identify the exact owned cinematic token and glass-surface source files.
2. Write tests for semantic surface variants and accessible content behavior.
3. Port only general tokens and glass fallback behavior; remove showcase layout,
   travel data, hero composition, and scene logic.
4. Verify opaque fallback, reduced motion, contrast, and stable dimensions.

### Task 7: Golden conversation interface - Current conversation complete

**Files:**
- Create: `src/components/conversation/space-shell.tsx`
- Create: `src/components/conversation/agent-presence.tsx`
- Create: `src/components/conversation/message-timeline.tsx`
- Create: `src/components/conversation/message-composer.tsx`
- Create: `src/components/conversation/history-drawer.tsx`
- Create: `src/components/conversation/conversation-state.ts`
- Modify: `src/app/page.tsx`
- Test: `tests/ui/conversation-state.test.ts`
- Test: `tests/ui/conversation-interface.test.tsx`

**Steps:**
1. Write failing state tests for loading, empty, ready, streaming, stopping,
   offline, reconnecting, failed, and success.
2. Build a full-screen spatial composition with one stable message column, a
   restrained Agent presence, and a composer that never shifts during streams.
3. Add optimistic submission followed by authoritative ID reconciliation.
4. Add stop, retry, history opening, keyboard focus, and long-text handling.
5. Verify no dashboard cards, nested cards, or explanatory feature copy appear.

**Remaining:** A history drawer is intentionally deferred until multiple
conversations are introduced. Real offline behavior depends on the YOS adapter.

### Task 8: Browser acceptance with test Agent - Core flow complete

**Files:**
- Create: `e2e/conversation.spec.ts`
- Create: `e2e/conversation-mobile.spec.ts`
- Create: `scripts/check-source-boundaries.mjs`
- Modify: `package.json`

**Steps:**
1. Write failing Playwright tests for the full conversation flow at 1440x900
   and 390x844.
2. Cover refresh, stream interruption, reconnection, stop, retry, keyboard use,
   reduced motion, overflow, and browser console errors.
3. Add a source-boundary check rejecting imports from legacy and AGPL paths.
4. Capture screenshots and inspect them before declaring the visual slice done.

**Remaining:** Add a source-boundary script. The current Playwright suite covers
desktop/mobile persistence, streaming, stop, retry, Live-mode separation,
overflow, reduced motion, and console errors.

### Task 9: Real YOS adapter - Implemented, full acceptance pending

**Files:**
- Create: `src/agents/yos-adapter.ts`
- Create: `src/agents/yos-contract.ts`
- Test: `tests/agents/yos-adapter.test.ts`
- Test: `tests/integration/yos-conversation.test.ts`

**Steps:**
1. Inspect the current YOS checkout and record confirmed endpoints,
   authentication, streaming, cancellation, and error behavior.
2. Write contract tests from captured sanitized fixtures.
3. Implement translation without leaking YOS types into shared contracts.
4. Run the real ten-turn, refresh, failure, retry, and supported-cancel checks.
5. Mark any unavailable capability as unsupported instead of simulating it.

**Evidence:** The inspected YOS Web Console exposes cookie-authenticated
`/api/send`, `/api/poll`, `/api/status`, and conversation history. It does not
expose correlated run IDs, token deltas, or cancellation. `YosWebConsoleAdapter`
advertises those limitations, passes local HTTP contract tests and PostgreSQL
service integration, and completed a private marked reply through the full
Yoyoo HTTP/SSE route. Ten consecutive turns and forced interruption recovery
remain before Task 9 is fully accepted.

### Task 10: Final verification and handoff

**Files:**
- Modify: `README.md`, `DEV-PLAN.md`
- Modify: `开发过程/000_Roadmap.md`
- Create: `开发过程/001_Feature_Yoyoo-Space对话核心.md`

**Steps:**
1. Run every automated gate from a clean install and new database.
2. Run real desktop and mobile browser acceptance against YOS.
3. Review security, error redaction, accessibility, asset provenance, and source
   boundaries.
4. Record observed results separately from unverified or deferred work.
5. Provide local/private deployment and recovery instructions.
