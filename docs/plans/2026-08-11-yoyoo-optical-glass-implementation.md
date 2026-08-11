# Optical Glass Material Implementation Plan

**Goal:** Upgrade Yoyoo's structural surfaces to a reusable optical-glass system
without changing product behavior.

**Architecture:** Extend semantic CSS tokens, then map existing shared and
conversation selectors to the new material roles. Keep the DOM and application
state unchanged. Playwright computed-style assertions define the material
contract before implementation.

## Task 1: Lock The Material Contract

- Modify `e2e/theme.spec.ts`.
- Assert translucent backgrounds, 18-32px blur, non-empty optical shadows, and
  non-blurred message surfaces in light and dark themes.
- Run the focused tests and confirm the expected RED state.

## Task 2: Add Reusable Glass Roles

- Modify `src/styles/tokens.css`.
- Add navigation, panel, control, floating, highlight, lowlight, blur,
  saturation, and shadow roles for both themes.

## Task 3: Apply The Material Hierarchy

- Modify `src/styles/home.css`, `src/styles/conversation.css`, and
  `src/styles/responsive.css`.
- Apply glass only to global navigation, room framing, composer, drawers, and
  menus. Preserve solid timeline and message materials.
- Add sensible non-support fallbacks through the opaque token values already in
  the cascade.

## Task 4: Verify And Hand Off

- Inspect desktop/mobile, light/dark, details, menu, focus, and reduced-motion
  states from a production build.
- Run detector, lint, typecheck, unit/UI, integration, build, and Playwright.
- Record evidence in `开发过程/030_Feature_光学毛玻璃材质系统.md`, roadmap, and
  README.
