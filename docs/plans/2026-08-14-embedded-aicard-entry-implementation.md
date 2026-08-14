# Embedded AI Card Entry Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Let users log in or create their authoritative AI Card from the Yoyoo login page without a visible identity-site hop.

**Architecture:** The browser talks directly to a strictly allowlisted AI Card origin for credential verification, then resolves the existing OAuth authorization request with AI Card's host-only session and CSRF token. Yoyoo keeps the existing PKCE callback and local session mapping, and never receives the password.

**Tech Stack:** Next.js App Router, React, TypeScript, Zod, PostgreSQL, Vitest, Testing Library, Playwright, CSS custom-property design tokens.

---

### Task 1: Lock the product contract

**Files:**
- Modify: `Product-Spec.md`
- Modify: `DEV-PLAN.md`
- Modify in AI Card repo: `Product-Spec.md`
- Modify in AI Card repo: `DEV-PLAN.md`

**Steps:**
1. Replace the visible redirect requirement with an embedded first-party entry requirement.
2. State that credentials go directly from the browser to AI Card and never through Yoyoo.
3. Preserve OAuth/PKCE, pairwise Subject, authorization, revocation, and fail-closed behavior.
4. Run `rg -n "内置|第一方|密码|PKCE" Product-Spec.md DEV-PLAN.md` in both repositories.

### Task 2: Add exact trusted-origin handling to AI Card

**Files:**
- Modify: `src/server/config.ts`
- Create: `src/server/authentication/trusted-product-cors.ts`
- Modify: `tests/unit/config.test.ts`
- Create: `tests/unit/trusted-product-cors.test.ts`

**Steps:**
1. Write failing tests for an empty default list, normalized exact origins, production HTTPS enforcement, wildcard/path rejection, preflight headers, credential headers, and untrusted-origin rejection.
2. Run the two tests and confirm they fail for missing behavior.
3. Parse `TRUSTED_PRODUCT_ORIGINS` as a comma-separated exact-origin allowlist.
4. Add helpers to verify mutation origins and attach narrow CORS headers without wildcards.
5. Run the focused tests and confirm they pass.

### Task 3: Allow trusted products to authenticate and authorize

**Files:**
- Modify: `src/app/api/v1/auth/password/login/route.ts`
- Modify: `src/app/api/v1/auth/password/register/route.ts`
- Modify: `src/app/api/v1/authorize/route.ts`
- Modify: `tests/unit/password-auth-routes.test.ts`
- Create: `tests/unit/embedded-authorization-route.test.ts`

**Steps:**
1. Write failing route tests for trusted and rejected origins, OPTIONS, credentials headers, returned CSRF token, and unchanged same-origin behavior.
2. Run focused tests and confirm the new assertions fail.
3. Reuse existing password services, rate limits, session cookies, CSRF checks, consent resolution, and error envelopes.
4. Return the non-secret CSRF value from successful password routes and attach CORS headers to success and error responses.
5. Allow the standard authorization POST from exact trusted origins while retaining session, CSRF, client, redirect URI, scope, state, and PKCE validation.
6. Run focused tests and confirm they pass.

### Task 4: Expose a JSON authorization transaction from Yoyoo

**Files:**
- Modify: `src/app/api/v1/auth/aicard/start/route.ts`
- Modify: `tests/integration/aicard-authorization-http.test.ts`
- Modify: `tests/agents/aicard-client.test.ts`

**Steps:**
1. Add failing tests for `format=json`, structured authorization request fields, no-store headers, callback-scoped encrypted Cookie, and preserved redirect mode.
2. Run focused tests and confirm they fail.
3. Derive the JSON request from the existing `AICardClient.createAuthorizationTransaction` URL to avoid duplicate OAuth field construction.
4. Return only issuer, request fields, and expiry metadata; never return the verifier or sealed authorization state.
5. Run focused tests and confirm both JSON and legacy redirect paths pass.

### Task 5: Replace the Yoyoo login UI

**Files:**
- Modify: `src/components/auth/human-login.tsx`
- Modify: `src/styles/login.css`
- Modify: `tests/ui/human-login.test.tsx`

**Steps:**
1. Write failing UI tests for product introduction, login/create modes, correct fields, loading/error/success states, Card ID display, and no external-link/local-account controls.
2. Run the UI test and confirm it fails.
3. Implement a small state machine that obtains a Yoyoo transaction, authenticates directly against AI Card with `credentials: include`, approves the authorization request, and navigates only to the verified Yoyoo callback URL.
4. Use existing tokens for surfaces, borders, typography, focus, danger, shadows, radii, motion, and dual themes.
5. Preserve safe `next` handling and prevent duplicate submissions.
6. Run the UI test and confirm it passes.

### Task 6: Configure and document deployment

**Files:**
- Modify in AI Card repo: `.env.example`
- Modify in AI Card repo: `infra/production/.env.example`
- Modify in AI Card repo: `infra/production/docker-compose.yml`
- Modify: `开发过程/000_Roadmap.md`
- Create: `开发过程/037_Feature_Yoyoo内置AI_Card入口.md`
- Modify in AI Card repo: `开发过程/000_Roadmap.md`
- Create in AI Card repo: `开发过程/016_Feature_第一方产品内置身份入口.md`

**Steps:**
1. Pass `TRUSTED_PRODUCT_ORIGINS` through Compose and document exact production value `https://app.yoyooai.com` without writing secrets.
2. Record decisions, rejected alternatives, tests, residual risks, and rollback boundaries.
3. Confirm `.env*` files contain no real credentials.

### Task 7: Full verification

**Steps:**
1. Run Yoyoo `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:integration`, and `npm run build`.
2. Run AI Card `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:integration`, and `npm run build`.
3. Start both local services with exact trusted origins and use Playwright to validate login, registration, errors, desktop, dark/light themes, 390px mobile, reduced motion, and no horizontal overflow.
4. Run a credential-flow check proving the Yoyoo origin receives no password request.
5. Review changed files for secrets and authentication regressions.
6. Commit the two repositories in atomic concern-based commits; do not deploy until production backup, rollback checks, and explicit user confirmation.
