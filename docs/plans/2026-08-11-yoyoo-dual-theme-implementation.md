# Yoyoo Dual-Theme Spatial Interface Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Deliver a complete, image-free light and dark Yoyoo interface without changing collaboration behavior or persistence.

**Architecture:** Introduce primitive and semantic CSS tokens, then resolve `light`, `dark`, and `system` through one small client theme boundary. Migrate existing pages by surface responsibility while preserving markup and behavior; verify each migration in both desktop and mobile browsers.

**Tech Stack:** Next.js 16, React 19, TypeScript 6, CSS custom properties, Vitest, Testing Library, Playwright.

---

### Task 1: Theme preference contract

**Files:**
- Create: `src/theme/theme.ts`
- Create: `tests/ui/theme.test.ts`

1. Write failing tests for valid preference parsing, system resolution, and
   storage fallback.
2. Run `npm test -- tests/ui/theme.test.ts` and confirm the missing module fails.
3. Implement the minimal pure theme helpers.
4. Re-run the targeted test and confirm it passes.

### Task 2: Flicker-free theme runtime

**Files:**
- Create: `src/components/theme/theme-provider.tsx`
- Create: `src/components/theme/theme-script.tsx`
- Modify: `src/app/layout.tsx`
- Create: `tests/ui/theme-provider.test.tsx`

1. Write failing tests for initial preference, explicit switching, local
   persistence, and live system preference changes.
2. Implement the provider and a pre-hydration script using `data-theme`.
3. Update metadata theme colors without forcing dark-only color scheme.
4. Verify targeted tests, lint, and type checking.

### Task 3: Semantic visual tokens

**Files:**
- Modify: `src/styles/tokens.css`
- Modify: `src/styles/base.css`
- Modify: `src/app/globals.css`

1. Add a browser assertion that both resolved themes expose valid canvas,
   surface, text, border, accent, and danger tokens.
2. Define primitive values and semantic light/dark mappings.
3. Replace global dark-only background, selection, focus, and color-scheme
   rules.
4. Verify no first-paint theme mismatch.

### Task 4: Navigation and settings selector

**Files:**
- Create: `src/components/theme/theme-selector.tsx`
- Modify: `src/components/shell/sidebar.tsx`
- Modify: `src/components/settings/agent-directory.tsx`
- Modify: `src/styles/settings.css`
- Test: `tests/ui/agent-directory.test.tsx`

1. Write failing UI tests for a low-frequency settings selector and persisted
   choice.
2. Implement the segmented `system / light / dark` control in settings.
3. Migrate shared navigation and settings surfaces to semantic tokens.
4. Verify loading, empty, error, success, narrow labels, and keyboard focus.

### Task 5: Image-free homepage and Live mode

**Files:**
- Modify: `src/components/home/home-experience.tsx`
- Modify: `src/styles/home.css`
- Modify: `src/styles/responsive.css`
- Modify: `src/components/orb/orb-preview.module.css`
- Test: `e2e/home.spec.ts`

1. Replace the image-specific browser assertion with failing image-free,
   dual-theme composition assertions.
2. Remove the scenery image and image overlays without adding dashboard content.
3. Apply semantic surfaces and restrained spatial details.
4. Verify Orb sizing, halo, reduced motion, navigation, composer, and all four
   target viewports.

### Task 6: Conversation system migration

**Files:**
- Modify: `src/styles/conversation.css`
- Modify: `src/components/conversation/collaboration-room.tsx` only when a
  semantic state hook or accessibility label is required.
- Test: `e2e/im-daily-use.spec.ts`
- Test: `e2e/multi-agent-room.spec.ts`
- Test: `e2e/im-message-actions.spec.ts`
- Test: `e2e/im-attachments.spec.ts`
- Test: `e2e/im-search.spec.ts`

1. Add failing dual-theme assertions for the three-column shell, selected room,
   message surfaces, composer, menus, and details pane.
2. Replace raw dark colors with semantic surfaces in bounded CSS sections.
3. Preserve every existing room, ID routing, file, search, message action, and
   Agent behavior.
4. Verify desktop, compact desktop, mobile drawer, full-width mobile details,
   long content, and four UI states.

### Task 7: Full visual and behavioral acceptance

**Files:**
- Create: `e2e/theme.spec.ts`
- Update: `README.md`
- Update: `开发过程/000_Roadmap.md`
- Create: `开发过程/028_Feature_无背景双主题视觉系统.md`

1. Test theme persistence, system changes, direct route loads, and no horizontal
   overflow in all target viewports.
2. Capture and inspect light/dark screenshots for homepage, conversation,
   details, settings, and Live.
3. Run `npm run lint`, `npm run typecheck`, `npm test`,
   `npm run test:integration`, `npm run build`, and `npm run test:e2e`.
4. Record exact results, skipped external gates, remaining real-device risk, and
   affected surfaces.
