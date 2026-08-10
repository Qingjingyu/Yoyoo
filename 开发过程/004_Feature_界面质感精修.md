# Feature: 界面质感精修

> Date: 2026-08-06
>
> Status: implemented and verified

## Background

The simplified homepage had the right product scope but several details made it
feel mechanically assembled. Desktop navigation was vertically centered in the
entire rail, spacing values were locally improvised, the composer used a broad
decorative shadow, and the loading skeleton described a visual that no longer
existed in the ready state.

## Delivered Scope

- Desktop primary navigation now sits `24px` beneath the brand; settings remains
  independently anchored to the bottom of the rail.
- The desktop rail is reduced from `72px` to `64px` while its interactive
  controls retain a `44x44px` target.
- Shared 4pt-based spacing, control-size, content-measure, and mobile-navigation
  tokens replace the most visible one-off layout values.
- The decorative page grid and non-functional `01` marker are removed.
- The composer keeps one purposeful glass surface but drops the broad shadow;
  its hierarchy now comes from border, inner highlight, contrast, and space.
- Homepage typography uses a fixed product-UI size instead of viewport-scaled
  display text.
- Loading now mirrors the online signal, heading, and composer footprint rather
  than presenting a temporary `160px` visual.
- Mobile navigation accounts for the safe-area inset. At `320px` width, composer
  and navigation controls no longer shrink below `44px`.

No dependency, conversation behavior, Live state, Agent contract, or backend
code changed.

## Key Decisions

1. The sidebar is a one-dimensional functional hierarchy, so desktop uses a
   vertical flex flow. Centering a navigation group inside a three-row grid was
   geometrically neat but semantically wrong.
2. Product quality comes from consistent dimensions and state behavior, not
   extra decoration. The ambient grid, broad shadow, and arbitrary page number
   were removed instead of replaced with new effects.
3. The active navigation control remains visually quiet. It may be easier to
   locate than inactive controls, but it must not compete with the composer.
4. Mobile keeps structural bottom navigation. Safe-area padding and touch-target
   preservation are functional requirements, not optional polish.

## Rejected Alternative

A fully expanded sidebar with permanent text labels was rejected. The current
homepage has only two destinations and one settings action; expanding it would
increase density without adding navigation value. The icon rail remains the
simpler and more stable product surface.

## Independent Assessment

Two isolated reviews ran before implementation. The subjective assessment found
the sidebar grouping, loading mismatch, arbitrary spacing, narrow-screen touch
targets, and decorative index. The mechanical layout detector returned an empty
finding list but confirmed there was no documented spacing scale. Their combined
result supported a systematic, small refinement instead of a redesign.

Legacy `.digital-life` and `.presence-status` rules retain older one-off values
as a deliberate rollback exception. They are not imported by the formal
homepage and were not mixed into the new spacing system.

## Test-First Evidence

Playwright assertions were added before production changes. The first run failed
because `01` still existed and compact composer controls measured `41.6px`.
After the implementation, the focused two-test run passed and additionally
locked the desktop brand-to-navigation gap at `24px`.

## Visual Evidence

Browser screenshots were inspected at `1440x900`, `1024x768`, `390x844`, and
`320x568`, including compact Live mode. The hierarchy remains composer first,
greeting second, status and navigation third. No text or controls overlap.

Measured key text contrast ranges from `5.20:1` to `17.47:1`, meeting the
`4.5:1` body-text requirement.

## Final Verification

- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm test`: 2 files and 6 tests passed.
- `npm run build`: Next.js `16.3.0` production build passed.
- `npm run test:e2e`: 8 checks passed across desktop, mobile, and the explicit
  `320x568` compact viewport.
- Post-change layout detector: zero findings.
- Browser console inspection: zero errors and zero warnings.

## Impact And Rollback

The change affects the application shell, homepage and Live presentation, and
loading geometry. It does not affect form submission or state transitions.
Rollback is limited to the shell/header markup and CSS tokens; no data migration
or API rollback is required.

## Final Visual Baseline Pass

After the cinematic rain-city background was locked, the final pass kept the
single centered task and refined the visual language instead of adding new
features. Status text, inactive navigation, placeholder contrast, composer
focus treatment, and disabled controls now read clearly against the moving
photographic backdrop.

Live mode no longer presents the fluid visual as a standalone saturated demo.
The orb is reduced to the same ice-cyan and blue-gray atmosphere as the city,
while its original diffuse glow remains the only surrounding visual. A tested
ring treatment was rejected because the hard lines made the digital life feel
like an instrument dial rather than a soft presence. Home, Live, status, and
controls retain coordinated arrival timing and the reduced-motion fallback.

The visual pass deliberately does not simulate microphone permission,
connection, streaming, or Agent responses. Those states belong to the real
product integration phase and must be driven by actual runtime events rather
than decorative timers.
