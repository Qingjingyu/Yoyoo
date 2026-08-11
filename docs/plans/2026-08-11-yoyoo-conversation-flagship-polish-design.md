# Yoyoo Flagship Conversation Surface Design

## Objective

Turn `/conversation` into the visual benchmark for Yoyoo: a quiet future IM
workspace where humans and AI share one operational room. Preserve every
existing workflow while replacing small, generic, uniformly boxed UI with a
more readable and deliberate material hierarchy.

## Physical Scene

A person works for hours with several persistent AI colleagues in a calm,
precision-built workspace. Ambient light may be bright or dark, but the room
must remain legible, stable, and focused. The interface becomes more alive only
when an Agent is actually present, selected, receiving, or executing.

## Visual System

- `canvas`: quiet field behind the work.
- `rail`: denser navigation material with clear separation from the timeline.
- `timeline`: reading-first plane without decorative scenery.
- `message`: low-relief authored surfaces, differentiated by structure and tone.
- `floating`: composer, menus, and temporary controls with restrained glass.
- `signal`: ice-cyan presence light used only for active semantic states.

Light mode uses mist white, cool silver, navy ink, and ice cyan. Dark mode uses
graphite, blue-green black, cool white, and the same signal light. Warning and
danger keep their existing semantic hues.

## Typography And Density

- Message and composer copy: 14px minimum, 1.6-1.68 line height.
- Operational metadata: 11px minimum.
- Room names and major navigation: 13-16px with moderate weight.
- Monospace is reserved for IDs, timestamps, and machine state, not every label.
- Conversation rows gain clearer rhythm rather than more cards.

## Interaction Language

- Active room: complete selected surface, visible border, stronger title, and a
  small semantic status point; no side stripe.
- Hover/focus: local edge and tone changes within 180-220ms.
- Agent running: restrained status pulse only on its signal.
- Composer focus: one controlled edge-light response; no expanding layout.
- Upload progress: transform-based movement rather than animated width.
- Reduced motion: remove pulse and transform transitions while retaining state.

## Responsive Behavior

Desktop keeps the three/four-column IM structure. Mobile keeps the bottom global
navigation, room drawer, full timeline, and bottom composer. The visual language
changes, not the established navigation model. At 320px, controls remain 44px,
labels do not overlap, and the composer never collides with the bottom bar.

## Rejected Alternatives

- Heavy sci-fi HUD: visually loud, low information value, and poor for daily IM.
- More glass cards: weakens hierarchy and repeats the generic AI-dashboard look.
- A second background image: reintroduces contrast and crop coupling.
- New font package: adds loading and platform variance before typography scale is
  fixed with the existing native stack.

## Acceptance

The benchmark is accepted when both themes feel related, all operational copy is
readable, the active room and Agent work states are unambiguous, the composer is
the strongest interactive surface, and no current IM behavior regresses.
