# Feature: 首页与对话页分离

> Date: 2026-08-06
>
> Status: implemented and verified

## User Story

As the owner, I want the homepage to remain calm and immediately actionable,
while long conversations use the full viewport and keep the composer at the
bottom, so reading and continuing work does not happen inside a cramped panel.

## Key Decisions

1. `/` is an entrance, not a transcript. It shows presence, greeting, one
   quick-start composer, and one truthful continuation link when history exists.
2. `/conversation` owns persisted messages, streaming state, retry, stop, Live
   entry, and an independently scrolling timeline.
3. The existing conversation client, API, persistence, and Agent adapters are
   reused unchanged. This is an information-architecture and layout change.
4. The homepage does not show fabricated priorities or task cards before a
   trustworthy product data source exists.
5. The rejected alternative was enlarging the homepage message window. It
   would preserve the same structural conflict between a landing surface and a
   long-form work surface.

## Files Changed

- `src/app/conversation/page.tsx`
- `src/components/home/home-experience.tsx`
- `src/components/shell/sidebar.tsx`
- `src/styles/home.css`
- `src/styles/responsive.css`
- `tests/ui/home-experience.test.tsx`
- `e2e/home.spec.ts`
- Product and delivery documentation

## Test Evidence

- Component tests were written first and failed because the homepage still
  rendered history and no full-height workspace existed.
- The focused component suite passes 8 of 8 checks.
- The new desktop and mobile browser geometry checks pass 2 of 2 checks.
- Desktop and mobile screenshots were inspected for message height, composer
  position, navigation clearance, text wrapping, and backdrop legibility.
- `npm run lint` and `npm run typecheck`: passed.
- `npm test`: 27 of 27 checks passed.
- `npm run test:integration`: 18 of 18 default integration checks passed; the
  three separately gated real-YOS live checks were skipped by the default suite.
- `npm run build`: passed and emitted static `/` and `/conversation` routes.
- `npm run test:e2e`: 12 of 12 desktop and mobile browser checks passed.

## Remaining Risk

- The homepage currently has no real task or priority feed. Adding one requires
  a product object and data contract; it must not be simulated with static data.
