# Feature: 中央对话空间

> Date: 2026-08-06
>
> Status: implemented and verified

## Background

The previous right-weighted Three.js chamber made the homepage feel like a
visual demo rather than a conversation product. The approved replacement uses
the supplied rain-city image as a quiet full-page environment and gives every
primary interaction one stable center axis.

## Delivered Scope

- Added the 1672x941 user-provided rain-city image as an owned local asset.
- Removed the Three.js scene from the rendered homepage route.
- Centered online state, greeting, current conversation, composer, and Live Orb
  within the content area on desktop and mobile.
- Replaced the local submission callout with a semantic two-party conversation
  timeline while preserving the truthful not-connected message.
- Kept the Live Orb at 168px on desktop and 136px on mobile.
- Served the original image without Next.js responsive downsampling after a
  browser test proved the mobile optimizer selected a 390px source.

## Key Decisions

1. The background supplies atmosphere; it does not become another interactive
   product object.
2. Text and voice modes share one focal point so mode switching does not change
   the user's spatial model.
3. No decorative background motion was added. The Orb remains the only
   stateful motion surface.
4. The earlier scene source and dependency are retained temporarily as local
   rollback material, but the homepage no longer imports or renders them.

## Rejected Alternatives

- Repairing the right-side chamber was rejected because its visual mass still
  competed with the conversation.
- Layering the image over the active WebGL scene was rejected because it would
  waste GPU resources and combine two unrelated visual systems.
- A separate mobile background was deferred because the supplied image's center
  crop remains legible and preserves the same environment.

## Test-first Evidence

Three component assertions failed before implementation: the backdrop and
centered layout were absent, the conversation lacked a semantic region, and the
old scene still rendered. After implementation, all component tests pass.

The first browser run caught unintended image downsampling on desktop and
mobile. The image delivery was corrected to preserve the original bitmap, then
all ten browser checks passed.

## Visual Evidence

Screenshots were inspected at 1440x900 and 390x844, plus desktop submitted-text
and Live states. The background remains readable, the interaction rail stays
centered, and no control or text overlaps navigation.

## Verification

- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm test`: 2 files and 6 tests passed.
- `npm run test:e2e`: 10 checks passed across desktop and mobile.
- `npm run build`: Next.js 16.3.0 production build passed after the final
  image-delivery adjustment.

## Impact And Rollback

The change affects only homepage presentation, local conversation markup, and
browser acceptance. It does not modify an API, persistence model, Agent
contract, or YOS integration.

Rollback restores the previous homepage import and styles and removes the local
background asset. No data recovery or migration is involved.
