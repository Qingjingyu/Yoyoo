# Feature: 语音专属数字生命

> Date: 2026-08-06
>
> Status: implemented and verified

## Background

Showing the fluid digital life on the homepage made a focused conversation
entrance feel decorative and visually heavy. Its useful role is narrower: it
should embody Yoyoo and communicate state while a person is intentionally in a
voice conversation.

## Delivered Scope

- The homepage and local text-preparing state render no digital-life visual.
- A small online signal replaces the homepage visual presence.
- Entering Live mode mounts the cyber-spectrum fluid orb in the listening
  state; leaving Live mode removes it.
- Live size is fixed at `168px` on desktop and `136px` on mobile.
- Live status, mute, and exit controls remain visible without overlapping the
  visual.
- The independent `/orb-preview` route remains available for motion and state
  tuning.
- The previous `DigitalLife` component remains in source as a reversible
  fallback but is no longer imported by the formal homepage.

This remains a truthful interface prototype. It does not request microphone
permission, capture audio, transcribe speech, or call an Agent.

## Key Decisions

1. The digital life is voice feedback, not persistent decoration. Removing it
   from text contexts restores hierarchy and makes Live mode meaningfully
   distinct.
2. The orb keeps a stable layout box while internal layers animate. This avoids
   layout shift and lets tests enforce exact responsive dimensions.
3. CSS custom-property sizing is accepted by the Yoyoo-owned component so the
   same orb implementation can respond to breakpoints without JavaScript
   viewport logic.
4. Live entry uses a restrained `240ms` opacity transition. Scaling the outer
   layout box was removed after browser tests proved it temporarily violated
   the exact responsive dimensions. Ongoing state motion remains owned by the
   orb component and honors reduced motion.

## Rejected Alternative

Keeping a smaller orb permanently on the homepage was rejected. It would reduce
its area but not solve the underlying hierarchy problem: a stateful voice
representation would still compete with text conversation when voice is not in
use.

## Test-First Evidence

Behavior tests were changed before production code. The first focused run
failed three of five tests because the homepage still rendered the old visual,
the new online status did not exist, and Live mode had not adopted the
cyber-spectrum orb. After implementation, the focused suite passed five of five
tests.

## Final Verification

- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm test`: 2 files and 6 tests passed.
- `npm run build`: Next.js `16.3.0` production build passed.
- `npm run test:e2e`: 6 Playwright checks passed across desktop and mobile.

Manual browser evidence confirms:

- Desktop Live orb measured `168x168` at a `1440x900` viewport.
- Mobile Live orb measured `136x136` at a `390x844` viewport.
- Mobile page width remained `390px` with no horizontal overflow.
- Homepage orb count returned to zero after exiting Live mode.
- The inspected browser console contained zero errors and zero warnings.

The first end-to-end run exposed the entry-scale defect: the desktop visual was
temporarily `160px` instead of `168px`, and mobile was `133px` instead of
`136px`. Removing outer-box scaling made the second run pass all six checks.

## Impact And Rollback

The change affects only homepage presence and Live-mode presentation. Text
submission behavior, navigation, loading/error states, and the orb preview route
remain intact. Rollback requires restoring `DigitalLife` in the homepage and
Live branches; no data or API migration is involved.
