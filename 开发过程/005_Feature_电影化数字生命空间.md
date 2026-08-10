# Feature: 电影化数字生命空间

> Date: 2026-08-06
>
> Status: implemented and verified

## Background

The simplified homepage had a clear product scope but still read as interface
elements placed on a black page. Adding more glass, rings, labels, or dashboard
modules would increase decoration without creating the reference product's
depth. The missing layer was a coherent physical environment.

## Delivered Scope

- Added one original, full-bleed Three.js chamber built from graphite surfaces,
  architectural fins, a recessed aperture, a material membrane, and one light
  seam.
- Reserved negative space for the homepage greeting and composer instead of
  centering every element on the viewport.
- Added pointer parallax and restrained material breathing at approximately
  `30fps`, with page-visibility pausing and reduced-motion behavior.
- Mapped idle, Live, and muted product states to light color, intensity, and
  material response while keeping the compact fluid Orb exclusive to Live.
- Added a WebGL fallback, capped pixel ratio, resize handling, and complete
  geometry/material/renderer disposal.
- Replaced the permanent text-submission preparation state with a visible local
  message and an explicit notice that no Agent is connected.
- Added exact Three.js version pinning and MIT attribution.

No audio transport, conversation service, persistence, YOS adapter, image
asset, copied shader, weather data, dashboard module, or recent-conversation
surface was added.

## Key Decisions

1. The future feeling comes from one coherent environment, not from HUD lines,
   neon labels, or more cards. Scene geometry therefore lives behind the whole
   product and does not create another framed panel.
2. The homepage stays quiet. The digital life Orb remains voice feedback and
   appears only after Live begins; the chamber provides presence before that.
3. Text submission cannot imply a connected Agent. Until the real adapter is
   built, the UI preserves the user's text and clearly labels it as local-only.
4. Three.js is used directly. A React 3D abstraction was rejected because this
   scene needs one renderer and a small owned lifecycle, not a second component
   framework.
5. Headless WebGL acceptance runs one worker at a time. Four software-rendered
   WebGL sessions made Chromium unstable; serial execution verifies the same
   behavior without GPU-resource contention.

## Rejected Alternatives

- A generated bitmap environment was not used because the built-in image tool
  was unavailable in this runtime and a CLI fallback required a credential that
  was not present. The real-time scene also provides state and pointer response
  that a static image cannot.
- A large homepage Orb was rejected because it had already overwhelmed the
  product and confused persistent identity with voice-state feedback.
- Physical transmission materials were tested and rejected for this slice.
  They overloaded software WebGL during browser acceptance; the lighter
  standard material preserves the visual hierarchy and stable runtime.

## Test-first Evidence

Three component tests failed before implementation: the scene was absent, Live
did not change its mode, and text submission discarded the message while
remaining in preparation forever. After implementation, all six component
tests pass.

Playwright now verifies the canvas on desktop and mobile, measures it against
the viewport, reads real WebGL pixels to reject a blank scene, moves the pointer
and requires the pixel signature to change, and checks idle/Live/muted/exit
behavior.

## Visual Evidence

Screenshots were inspected at `1440x900` and `390x844`, plus desktop Live mode.
The final pass moved the light seam off the composer, reduced its brightness,
and scaled the mobile chamber to the right rear. No text, control, Orb,
navigation item, or scene element produces an incoherent overlap.

## Verification

- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm test`: 2 files and 6 tests passed.
- `npm run build`: Next.js `16.3.0` production build passed.
- `npm run test:e2e`: 10 checks passed across desktop and mobile.
- Canvas pixel probes: nonblank and pointer-responsive on both viewports.
- Browser screenshots: inspected for homepage desktop, homepage mobile, and
  desktop Live.

## Impact And Rollback

The change affects the homepage background, foreground composition, Live scene
state, local text feedback, browser-test concurrency, and the frontend bundle.
It does not affect any backend, API, data, or YOS contract.

Rollback is limited to removing the scene component and Three.js dependency,
restoring the prior homepage composition and submission state, and removing the
new scene assertions. No migration or data recovery is required.
