# Feature: Yoyoo Space 首页基础

> Date: 2026-08-05
>
> Status: implemented and verified

## Background

The first homepage proved the project foundation but became visually dense: the
sidebar marker was offset, the digital life and greeting competed for attention,
and the recent-conversation rail made the entrance feel like a dashboard. The
revised goal is a single calm meeting point between one person and Yoyoo.

## Delivered Scope

- A sidebar whose desktop controls share one horizontal center line and whose
  mobile form becomes a stable bottom navigation.
- A quiet online status, one personal greeting, and one composer with text,
  voice, and send actions.
- Removal of homepage recent conversations and their sample model.
- A separate Live-mode screen with listening, muted, and exit interactions.
- Explicit digital-life presentation states for idle, preparing, listening,
  thinking, speaking, and muted behavior.
- Loading, error, ready, local preparing, and reduced-motion presentation.

The text submit action and Live mode remain local interface states. They do not
call an Agent, request microphone permission, transcribe speech, or play audio.

## Key Decisions

1. The homepage is an entrance, not a history dashboard. Conversation history
   may return later in a dedicated conversation surface, not beside the primary
   homepage action.
2. Live mode is a distinct context instead of another control layered onto the
   homepage. The digital life appears only when voice interaction is
   intentionally entered; the homepage and text-preparing state do not render
   it.
3. The homepage status is a small text-and-signal element. Live status belongs
   to the Live visual, avoiding duplicate or decorative presence layers.
4. Motion uses transforms and opacity with state-specific timing and a reduced-
   motion fallback. Listening is more active than idle but intentionally slower
   than a loading spinner.
5. Existing plain CSS, tokens, and Lucide icons remain sufficient. No dependency
   was added.

## Rejected Alternatives

- Keep recent conversations on the homepage: rejected because it increases
  density before a persistent conversation product exists.
- Immediately request the browser microphone: rejected because audio capture,
  permissions, speech services, and Agent transport need a separate contract
  and error-state design.
- Automatically cycle listening, thinking, and speaking: rejected because it
  would falsely imply a working Agent conversation.
- Expand the digital life to a full-screen decoration on the homepage: rejected
  because the main action is still entering a conversation.

## Test-First Evidence

The revised component tests were written before the new implementation. The
first run failed four of five tests because the old homepage required recent
conversation data, had no voice entry, and mapped unknown Agent states to
"online". After implementation, all five component tests passed.

## Final Verification

- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm test`: 5 tests passed.
- `npm run build`: Next.js `16.3.0` production build passed.
- `npm run test:e2e`: 6 Playwright checks passed at `1440x900` and `390x844`.
- Desktop sidebar links shared one measured center coordinate.
- Desktop and mobile had no horizontal overflow.
- Production browser console reported zero errors and zero warnings.
- Reduced-motion animation duration was effectively zero with one iteration.
- Four production screenshots were inspected: homepage and Live mode at both
  desktop and mobile sizes.

Lighthouse was not rerun for this redesign. Scores recorded for the prior
homepage version are not treated as current evidence.

## Impact And Follow-Up

The homepage source no longer exports or consumes sample recent-conversation
data. The later Live-only digital-life decision is documented in
`003_Feature_语音专属数字生命.md`. Future real voice work must add microphone
permission, unsupported/error states, speech transport, cancellation, and
privacy behavior without weakening the current text entry path.
