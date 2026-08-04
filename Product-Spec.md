# Yoyoo Space Product Spec

> Version: v0.1 conversation core
>
> Date: 2026-08-05
>
> Status: approved direction, implementation not started

## Goal

Build Yoyoo Space as a focused, visually distinctive place where one person can
hold a persistent conversation with one connected AI Agent. The first release
must feel like an Agent presence rather than a conventional dashboard, while
remaining quiet enough for long daily conversations.

The product is newly implemented. It does not inherit the retired Yoyoo user
interface, domain model, database, migrations, or Git history. YOS is the first
Agent connection, but the product core depends only on a small general Agent
adapter contract.

## Target Users

- V0.1: Su Bai using a private desktop or mobile browser.
- Later: invited people connecting their own compatible Agents.

## Problem

Existing chat products treat an Agent as a message generator inside a generic
messaging layout. The retired Yoyoo product also expanded into contacts, public
feeds, tasks, files, Skills, permissions, and administration before the primary
conversation experience was good enough.

Yoyoo Space must first make one conversation excellent: clear Agent presence,
durable history, understandable working state, reliable recovery, and an
interface with a coherent cinematic glass visual language.

## MVP Scope

- One private owner and one configured Agent.
- One primary persistent conversation.
- Text messages with incremental Agent response streaming.
- Explicit Agent states: offline, ready, thinking, working, waiting, failed.
- Stop the current response and retry a failed user message.
- Persist user messages, Agent messages, delivery state, and timestamps.
- Restore the conversation after refresh or browser reconnection.
- A compact conversation history drawer for starting or reopening a thread;
  the main screen still presents one conversation at a time.
- A responsive desktop and mobile interface built from the owned cinematic
  glass design system, not from the retired product or third-party source.
- A small versioned Agent adapter contract and a YOS adapter implementing only
  capabilities that YOS actually exposes.
- Loading, empty, error, offline, reconnecting, and success states.

## V2 / Later

- Voice input and spoken responses.
- A live two-dimensional or three-dimensional virtual presence.
- Image and file attachments.
- Multiple Agents in one account or conversation.
- Public Agent discovery, A2A exposure, teams, and multi-user collaboration.
- Tasks, workflow views, memory browsers, Skill management, files, activity
  logs, social feeds, billing, and administration.

## User Stories

- As the owner, I can open Yoyoo Space and immediately see whether my Agent is
  available without navigating through a dashboard.
- As the owner, I can send a message and see a response arrive progressively.
- As the owner, I can stop an unwanted response without losing earlier text.
- As the owner, I can refresh or reconnect and continue from persisted history.
- As the owner, I can understand a send, connection, or Agent failure and retry
  safely without creating duplicate messages.
- As an integration author, I can connect another Agent by implementing the
  adapter contract without changing conversation UI components.

## Core Flows

1. The app loads the current conversation and Agent health in parallel.
2. If no conversation exists, the app shows a quiet first-message state.
3. The owner submits text. The server validates and persists it with an
   idempotency key before invoking the configured Agent adapter.
4. Agent status and text deltas stream to the browser. The server persists the
   authoritative response and terminal state.
5. The owner may stop the run. The adapter receives cancellation when it
   supports it; the interface retains already-produced text and marks the run.
6. On disconnect, the browser reconnects from its last event cursor and then
   reconciles with persisted state.
7. On failure, the interface shows the failure next to the affected message and
   offers a safe retry using a new run identity.

## Functional Requirements

- A message must contain non-whitespace text and respect the documented length
  limit before it reaches an Agent.
- Repeated submission with the same idempotency key must not create a second
  user message or Agent run.
- Message and run states must be explicit structured values, not inferred from
  displayed text.
- Streaming events must have ordered IDs and support cursor-based reconnection.
- The server is the source of truth; optimistic UI must reconcile with server
  IDs and state.
- Agent-specific payloads stay inside adapters. UI and persistence models use
  the stable Yoyoo Space contract only.
- Capabilities such as cancellation must be advertised by the adapter. The UI
  must not display controls for unsupported operations.
- Secrets must come from server-side environment configuration and never enter
  browser bundles, URLs, messages, logs, or repository files.

## Non-Functional Requirements

- Use semantic HTML, visible keyboard focus, screen-reader labels, sufficient
  contrast, reduced-motion behavior, and non-color status cues.
- Keep the message list and composer stable while messages stream or errors
  appear. Long text and long unbroken strings must not overflow.
- Support current desktop Chrome/Safari and mobile Safari/Chrome at minimum.
- Verify at 1440x900 and 390x844, including the virtual-presence reserved area.
- No public deployment is allowed without owner authentication or an explicit
  private-network/authenticated reverse-proxy boundary.
- Store only user-visible conversation content and operational state. Do not
  store chain-of-thought, private scratchpads, or hidden model reasoning.
- The third-party Glass UI React repository remains reference-only. No AGPL
  source is imported into the product.

## Open Questions

- The exact YOS conversation endpoint and authentication method will be locked
  after a read-only contract check against the current YOS checkout.
- Public owner authentication is deferred until a deployment target is chosen;
  local development remains bound to `127.0.0.1`.
- The future virtual presence will be designed after the conversation slice is
  accepted and will not block v0.1.

## Acceptance Criteria

- A real YOS-backed conversation sends and receives at least ten consecutive
  turns without duplicate messages or lost terminal state.
- Refresh during idle restores the full persisted conversation.
- Disconnect during streaming visibly reconnects or terminates with a truthful,
  retryable failure; it never displays a false completed state.
- Stop works when the adapter advertises cancellation and is absent otherwise.
- Empty, loading, offline, reconnecting, streaming, stopped, failed, and success
  states are visibly usable on desktop and mobile.
- Keyboard-only message entry, send, stop, retry, history opening, and history
  selection are verified in a real browser.
- Lint, type checking, unit tests, integration tests, production build, and
  Playwright browser tests pass with no application console errors.
- No new source file imports from either legacy Yoyoo or Glass UI React.

## Explicit Non-Goals

- Do not rebuild the retired Yoyoo feature set.
- Do not build a dashboard, social network, task center, file manager, Skill
  manager, organization system, Agent marketplace, or settings maze.
- Do not copy old Yoyoo UI components, CSS, database schema, migrations, or
  application architecture.
- Do not copy or rebrand third-party Glass UI React code.
- Do not claim A2A compliance or universal Agent compatibility until separate
  conformance tests exist.
- Do not add voice, avatars, or 3D merely to decorate an unfinished chat flow.

