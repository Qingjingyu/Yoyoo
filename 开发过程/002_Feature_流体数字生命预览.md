# Feature: 流体数字生命预览

> Date: 2026-08-05
>
> Status: isolated preview implemented and verified; homepage replacement not approved

## Background

The first digital-life visual used hand-built concentric CSS paths. Its
rotation read as a loading indicator and became visually mechanical. The next
step is to judge a materially different visual before changing the accepted
homepage.

## Delivered Scope

- An isolated `/orb-preview` route; the current homepage remains unchanged.
- A Yoyoo-owned `YoyooOrb` component with idle, preparing, listening,
  thinking, speaking, and muted states.
- A simulated amplitude signal for previewing listening and speaking without
  requesting microphone permission or implying a real voice connection.
- A responsive state selector, reduced-motion fallback, and accessible status
  labels.
- A cyber-spectrum palette using cyan, mint, electric blue, and coral-magenta
  light over a deep field.

## Key Decisions

1. SmoothUI's MIT-licensed Siri Orb is a visual and motion reference. Its
   registered angle field and layered conic-gradient technique were adapted
   into Yoyoo markup, timing, state names, palette, responsive layout, and
   plain CSS. Seven gradient layers move at different directions and angle
   multipliers so the material flows internally instead of rotating as one
   texture.
2. Only `motion@12.43.0` was added. SmoothUI and Tailwind were not installed,
   keeping the existing styling architecture intact.
3. Idle uses a restrained 30-second mesh rotation; thinking uses roughly 13
   seconds. State changes alter material, brightness, and reactivity without
   turning the orb into a fast spinner.
4. The preview does not request microphone permission. Real audio amplitude is
   a later transport and privacy slice.
5. White is a small specular highlight, not a primary color. A separate
   chromatic refraction layer keeps multiple hues visible while the main field
   moves, and an outer spectrum aura breathes on an independent cycle.

## Rejected Alternatives

- Continue polishing the concentric rings: rejected because the underlying
  visual metaphor, not only its timing, caused the loading-indicator feel.
- Use React Bits Orb: rejected because it remains ring-shaped and has a more
  restrictive Commons Clause license.
- Use ferrofluid as the compact identity: rejected because it is better suited
  to a full Live-mode atmosphere and carries a larger rendering cost.
- Replace the homepage immediately: rejected until the isolated visual is
  accepted in motion on desktop and mobile.

## Test-First Evidence

`tests/ui/orb-preview.test.tsx` was added before the preview component. The
first run failed because `@/components/orb/orb-preview` did not exist. The
cyber-spectrum revision added a failing `data-palette="cyber-spectrum"`
assertion before changing the material. After implementation, the test passed
and verified the palette contract, state switching, and accessible status
updates.

## Verification

- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm test`: 6 tests passed.
- `npm run build`: Next.js production build passed and prerendered
  `/orb-preview`.
- Real browser: checked at `1440x900` and `390x844`.
- Mobile document width and height matched the viewport with no overflow.
- Browser console: zero errors and zero warnings.
- Motion probe: the registered angle changed from `273.312deg` to `293.991deg`
  across a 900ms sample.
- Reduced-motion probe: mesh and spectrum-aura animations computed to `none`.

## Impact And Rollback

The homepage and Live interface do not import the new component, so the study
does not change their accepted behavior. Rollback is limited to removing the
preview route, orb component files, test, `motion` dependency, and this record.
