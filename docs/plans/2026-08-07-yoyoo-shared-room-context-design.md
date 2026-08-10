# Yoyoo Shared Room Context Design

## Decision

The platform will attach a bounded list of prior public room messages to every
room-scoped `AgentRunRequest`. The list is created once from authoritative
PostgreSQL facts and remains provider-neutral. Codex and YOS decide how to use
the messages; Yoyoo does not summarize or interpret them.

## Data Flow

1. A human message is persisted and creates one run per selected Agent.
2. When a run is claimed, the repository loads the trigger and room members.
3. It also loads completed messages from the same room whose `(created_at, id)`
   sorts strictly before the trigger's `(created_at, id)`.
4. A pure selector keeps the newest 24 messages within a 16,000-character
   aggregate budget and truncates any individual entry to 8,000 characters.
5. The selected entries are returned oldest-to-newest as `history`.
6. Each adapter serializes sender identity, history, and the current message at
   its provider boundary.

Filtering strictly before the trigger means Codex and YOS launched by the same
message cannot race and see each other's current replies. A later human turn
will see both completed replies.

## Error And Security Boundaries

- Another room can never contribute rows because every query is scoped by the
  run's `room_id`.
- Only `completed` public messages enter history. Failed/stopped placeholders
  and active partial output are excluded.
- History is labeled as untrusted participant content. It cannot alter fixed
  subprocess flags, credentials, permissions, or platform routing.
- No hidden reasoning, provider logs, credentials, or stderr enter context.
- Empty history is valid and preserves current one-shot behavior.

## Rejected Alternatives

- Adapter-specific database reads: duplicates policy and makes room isolation
  dependent on each provider implementation.
- Semantic retrieval or summaries: premature, nondeterministic, and crosses the
  platform/Agent intelligence boundary.
- Long-lived provider sessions: hides context state outside Yoyoo and makes
  refresh/retry behavior harder to audit.

## Verification

- Unit: schema, order, count, per-message and aggregate character limits.
- PostgreSQL: same-room filtering, before-trigger boundary, retry determinism.
- Adapter: Codex and YOS receive clearly separated history/current sections.
- Live: Codex reads a prior YOS marker and YOS reads a prior Codex marker.
