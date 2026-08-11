# Yoyoo Dual-Theme Spatial Interface Design

## Objective

Replace image-led scenery with one quiet, future-native interface system that
works in light and dark environments. The product must retain Yoyoo's precise,
cinematic character through hierarchy, material, typography, motion, and Agent
presence rather than through a city photograph.

## Design Direction

The light and dark themes are two environmental states of the same product, not
separate skins. They share layout, spacing, typography, border geometry,
interaction states, and the ice-cyan identity accent.

- Light uses a mist-white canvas, cool silver surfaces, navy text, and restrained
  ice-cyan status light.
- Dark uses a graphite canvas, deep blue-green surfaces, cool white text, and the
  same ice-cyan status light.
- Large structural regions stay flat and quiet. Glass is reserved for floating
  controls, the composer, menus, and overlays.
- Fine borders, local edge highlights, status pulses, and measured transitions
  provide the future character. Decorative cards, gradient blobs, and scenery
  images do not.

## Surface Model

1. `canvas`: the application atmosphere and lowest contrast plane.
2. `rail`: global navigation and room navigation.
3. `panel`: timeline, settings content, and room details.
4. `floating`: composer, menus, dialogs, and transient controls.
5. `interactive`: selected, hover, focus, active, success, warning, and danger.

Each layer is represented by semantic tokens. Components consume meanings such
as `--surface-panel` and `--text-muted`; they do not select raw light or dark
colors.

## Page Composition

### Homepage

- Remove the rain-city bitmap and image-specific overlays.
- Preserve the concise greeting, one primary composer, and dedicated Live entry.
- Keep the digital-life presence as the signature object, but let it sit in an
  unframed quiet field rather than a scenic illustration.
- Do not add dashboard cards, marketing copy, or fabricated status information.

### Conversation

- Preserve the global rail, conversation list, timeline, bottom composer, and
  responsive details surface.
- Reduce visual competition behind messages. Readability and room identity are
  primary.
- Keep message surfaces mostly planar; use glass only where an element genuinely
  floats above the timeline.
- Continue to expose routing, member, run, file, and room-management facts
  without changing their behavior.

### Settings And Agent Directory

- Use the same rail and panel hierarchy as conversation.
- Treat forms and credential outcomes as operational surfaces, not decorative
  cards.
- Preserve loading, empty, error, success, revoked, and pending states.

### Live Mode

- Keep the fluid digital-life Orb and its existing state model.
- Give the Orb a soft atmospheric halo, never diagram-like concentric lines.
- Adapt surrounding controls and status text to both themes while preserving
  reduced-motion behavior.

## Theme Behavior

- Supported preferences are `light`, `dark`, and `system`.
- `system` resolves through `prefers-color-scheme` and updates live.
- The explicit preference persists locally.
- A pre-hydration script applies the resolved theme before paint to avoid a
  light-to-dark flash or a React hydration mismatch.
- The selector lives in settings because theme choice is a low-frequency
  preference. The product does not place a permanent theme toggle in the main
  conversation header.

## Responsive And Accessibility Requirements

- Preserve the accepted desktop rail and mobile bottom navigation.
- Keep the room drawer, full-width mobile details surface, safe-area padding,
  keyboard behavior, and 44px minimum touch targets.
- Maintain visible focus, non-color state cues, reduced motion, and readable
  contrast in both themes.
- Verify `1440x900`, `1024x768`, `390x844`, and `320x568` without horizontal
  overflow, clipped text, or composer overlap.

## Explicit Non-Goals

- No new background image, generated character, or human avatar.
- No layout or information-architecture rewrite.
- No database migration, API change, Agent protocol change, or new dependency.
- No Bloome clone and no generic white SaaS dashboard treatment.
- No large component-library abstraction unless migration proves repeated need.

## Rejected Alternatives

- Brighten the existing night image: rejected because it produces inconsistent
  contrast and keeps daily usability coupled to one bitmap.
- Duplicate every stylesheet for light and dark: rejected because the themes
  would drift and every future component would require parallel maintenance.
- Copy a flat white/black IM treatment: rejected because it removes Yoyoo's
  material hierarchy and recognizable Agent presence.

## Acceptance

The redesign is accepted only when both themes cover every current route and UI
state, the homepage contains no scenery image, the existing behavior gates stay
green, theme resolution is flicker-free and persistent, and desktop/mobile
screenshots demonstrate one coherent Yoyoo system rather than two unrelated
skins.
