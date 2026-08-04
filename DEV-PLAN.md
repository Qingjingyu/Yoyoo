# Yoyoo Space Development Plan

## Product Boundary

V0.1 delivers one persistent text conversation between one owner and one
configured Agent. `Product-Spec.md` is the source of truth. Any additional
surface requires a spec change before implementation.

## Technical Direction

- Application: self-hosted Next.js with React and TypeScript.
- Runtime: Node.js, bound to `127.0.0.1` during local development.
- Persistence: PostgreSQL with forward-only SQL migrations and direct,
  parameterized access through `pg`.
- Validation: one runtime schema library selected and pinned during foundation.
- Styling: plain CSS with cascade layers and custom-property design tokens.
- Icons: Lucide only when an established symbol exists.
- Tests: Vitest for units and services; Playwright for real-browser behavior.
- Deployment: a long-running Node service, not a serverless runtime, so Agent
  streaming and cancellation have explicit process ownership.

Dependency versions will be checked against official current releases before
installation and locked exactly. No dependency is inherited from legacy Yoyoo
or Glass UI React.

## Architecture

```text
Browser
  -> Yoyoo Space HTTP/SSE boundary
      -> Conversation service
          -> PostgreSQL repositories
          -> Run coordinator
              -> AgentAdapter
                  -> YOSAdapter (first implementation)
```

The shared contract contains only Agent descriptor, health, run, stream event,
and cancellation semantics. The YOS adapter owns all translation to current YOS
requests and responses. Conversation components never import adapter code.

## Initial Project Structure

```text
src/
  app/
    api/v1/
    conversation/
    globals.css
    layout.tsx
    page.tsx
  agents/
    contract.ts
    registry.ts
    yos-adapter.ts
  components/conversation/
  server/
    conversation-service.ts
    run-coordinator.ts
    event-stream.ts
    postgres/
  styles/
    tokens.css
    base.css
    space.css
    responsive.css
tests/
e2e/
infra/postgres/
docs/plans/
开发过程/
```

## Delivery Phases

### Phase 0: Fresh Foundation

- Pin the runtime and dependency versions.
- Create the application shell, test runners, linting, and build scripts.
- Create an example environment file without credentials.
- Add one forward-only PostgreSQL migration for conversations, messages, runs,
  and ordered run events.
- Verify a clean install, migration, unit test, and production build.

### Phase 1: Conversation Contract

- Write failing tests for message validation, state transitions,
  idempotency, ordered events, retry, and cancellation capability gating.
- Implement the stable Agent adapter contract and a deterministic test adapter.
- Implement repositories, conversation service, run coordinator, and SSE cursor
  reconnection.
- Verify restart and duplicate-submission behavior against PostgreSQL.

### Phase 2: Golden Conversation Slice

- Build the new Yoyoo Space visual tokens from the owned cinematic template.
- Implement the spatial shell, Agent presence, message timeline, composer,
  streaming state, stop, retry, and history drawer.
- Implement loading, empty, offline, reconnecting, failed, and success states.
- Verify keyboard behavior and desktop/mobile layouts in a real browser.

### Phase 3: Real YOS Adapter

- Recheck the current YOS source and runtime contract without modifying it.
- Implement only confirmed YOS capabilities.
- Keep credentials server-side and redact operational errors.
- Run a real ten-turn conversation, disconnect/reconnect, stop when supported,
  retry, browser refresh, and service restart acceptance sequence.

### Phase 4: Polish And Handoff

- Run security, accessibility, overflow, reduced-motion, and performance checks.
- Verify no legacy or AGPL source imports.
- Update README, roadmap, and feature delivery record with observed results.
- Provide local run and private deployment instructions.

## Verification Gates

Every phase must run the checks it introduces. Final completion requires:

```bash
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run build
npm run test:e2e
```

Commands are planned interfaces until Phase 0 creates the package scripts.
Passing component tests alone is not sufficient for completion.

## Replacement Safety

- The retired repository is not a dependency, subtree, package, or Git remote.
- The legacy snapshot is outside this repository and is reference-only.
- Old databases and runtime state are not migrated into v0.1.
- The third-party AGPL repository remains outside this repository.
- New code may reuse owned cinematic design tokens only after each reused file
  is identified in the implementation plan and adapted to an application UI.

## Detailed Plan

The task-by-task implementation sequence is maintained in
`docs/plans/2026-08-05-yoyoo-space-v0.1.md`.

