# Yoyoo Cinematic Presence Design

> Date: 2026-08-06
>
> Status: approved for implementation

## Experience Sentence

Yoyoo is a quiet, inhabited material chamber: the interface sits inside a
graphite-and-glass environment whose light subtly acknowledges the Agent's
presence, then becomes more alive only when the user enters voice conversation.

## Goals

- Replace the flat black canvas with a real spatial environment, not a
  decorative background image.
- Keep the homepage focused on one greeting and one composer.
- Make Live mode feel like the same space entering a more responsive state.
- Preserve readable hierarchy, stable geometry, keyboard access, reduced
  motion, and an honest local-only text state.
- Keep the scene original and owned by Yoyoo; use only the Three.js runtime.

## Non-goals

- No dashboard, metrics, weather data, recent-conversation cards, HUD grid, or
  sci-fi telemetry.
- No large homepage Orb, human avatar, lip sync, fake audio transport, or fake
  Agent response.
- No copied visual asset, shader, layout, or source from the weather reference.
- No backend, persistence, YOS adapter, or API contract in this slice.

## Spatial Composition

The viewport is one unframed Three.js scene. A dark graphite floor establishes
depth. A sequence of architectural fins and one recessed material aperture
create a chamber on the right side, leaving calm negative space for the
greeting and composer on the left. One translucent membrane and one restrained
light seam provide the feeling of a living material without becoming a glowing
ornament.

The application shell, navigation, content, and controls remain DOM layers over
the scene. They do not sit inside a decorative page card. Glass is reserved for
the navigation rail, composer, and compact Live controls where depth conveys a
real interaction surface.

## State Language

- `idle`: graphite, forest green, and a small ice-mint key light. Motion is slow
  and continuous.
- `preparing`: the seam brightens briefly, but the interface must never remain
  indefinitely in this state.
- `live`: the chamber gains cyan, violet, and warm coral reflections while the
  compact Yoyoo Orb appears as voice feedback.
- `muted`: saturation and motion reduce without hiding the Live controls.
- `loading` and `error`: the scene remains present so the product shell does not
  collapse; foreground copy communicates the actual state.

## Motion Rules

- Camera drift is below one degree and pointer parallax stays below `0.16` world
  units.
- Architectural geometry never spins. Only the material membrane, light seam,
  and illumination breathe.
- State transitions use color and intensity interpolation rather than sudden
  scene replacement.
- `prefers-reduced-motion` renders a stable frame and disables pointer parallax.
- Rendering pauses when the document is hidden.

## Performance And Fallback

- Cap device pixel ratio at `1.5` and reuse geometries and materials.
- Resize through `ResizeObserver`; dispose the renderer, geometries, and
  materials on unmount.
- If WebGL creation fails, retain the same dark material color field and all
  foreground product functionality. The failure is not logged as a console
  error because it has an intentional visual fallback.

## Acceptance

- Desktop and mobile show a nonblank full-bleed canvas with no horizontal
  overflow or overlap.
- Pixel probes confirm the canvas is nonblank and changes over time in normal
  motion mode.
- Entering Live changes the scene state and shows the compact Orb; leaving Live
  restores idle state.
- Text submission preserves the submitted text and explicitly says that an
  Agent is not connected instead of inventing a response or spinning forever.
- Lint, type checking, unit tests, production build, and Playwright all pass.
