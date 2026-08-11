# Flagship Conversation Surface Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `/conversation` the production-quality visual benchmark for Yoyoo without changing IM behavior.

**Architecture:** Extend existing semantic tokens and refine the current conversation CSS/DOM contract. Browser assertions lock readable typography, whole-surface selection, stable motion, and responsive behavior before visual implementation.

**Tech Stack:** Next.js 16, React 19, TypeScript, layered CSS, Vitest, Playwright.

---

### Task 1: Lock The Visual Contract

**Files:**
- Modify: `e2e/theme.spec.ts`
- Modify: `e2e/multi-agent-room.spec.ts`

1. Add computed-style assertions for metadata and message font-size floors.
2. Add an assertion that the active room pseudo-element does not render a side stripe.
3. Run the targeted Playwright tests and confirm they fail against V0.11.

### Task 2: Extend Semantic Tokens

**Files:**
- Modify: `src/styles/tokens.css`

1. Add typography roles and conversation material roles for both themes.
2. Keep existing public token names compatible.
3. Re-run the targeted browser contract.

### Task 3: Refine The Conversation Benchmark

**Files:**
- Modify: `src/styles/conversation.css`
- Modify: `src/styles/responsive.css`

1. Rebuild rail selection as a whole surface and raise the type scale.
2. Refine header, timeline width/rhythm, message surfaces, menus, details, and composer.
3. Replace width progress animation with a transform-based implementation.
4. Add state-driven transitions and reduced-motion fallbacks.
5. Run targeted unit/UI and Playwright tests until green.

### Task 4: Visual And Regression Acceptance

**Files:**
- Modify: `e2e/theme.spec.ts` only if an uncovered requirement needs a regression test.

1. Inspect light/dark at `1440x900` and `390x844`.
2. Check `1024x768` and `320x568` for overflow and overlap.
3. Exercise search, room menu, details, attachment, selection, send, and Agent state.
4. Run lint, typecheck, unit/UI, integration, build, and full Playwright gates.

### Task 5: Handoff

**Files:**
- Modify: `README.md`
- Modify: `开发过程/000_Roadmap.md`
- Create: `开发过程/029_Feature_旗舰对话界面.md`

1. Record decisions, rejected alternatives, files, test results, and remaining risks.
2. Keep external live-service verification separate from local acceptance.
