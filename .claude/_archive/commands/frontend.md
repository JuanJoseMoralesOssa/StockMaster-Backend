# Frontend Web Development — Reference Skill

Use this document when working on frontend tasks in this project or any web project. Apply these standards by default unless the user specifies otherwise.

> **Design system:** When the task involves UI components, tokens, or visual design, also apply the `/designer` skill. It contains the full component catalog (Button, Badge, Modal, Form, DataTable, Feedback), design token conventions, architecture rules, and the pre-PR cognitive load checklist.

---

## Technology Stack Baseline

| Layer | Preferred | Alternatives |
|---|---|---|
| Markup | HTML5 semantic | — |
| Styling | CSS3 + Tailwind | SCSS, CSS Modules |
| Language | TypeScript (strict) | JavaScript ES2025+ |
| Framework | React 19 | Next.js, Remix |
| State | useState/useReducer + Context | Zustand, Jotai |
| Forms | React Hook Form + Zod | useActionState (React 19) |
| Testing | Vitest + React Testing Library | Jest |
| E2E | Playwright | Cypress |
| Bundler | Vite | Next.js built-in |
| CI/CD | GitHub Actions | — |

---

## HTML — Non-negotiables

- Use semantic elements: `<header>`, `<nav>`, `<main>`, `<section>`, `<article>`, `<aside>`, `<footer>`, `<figure>`, `<time>`.
- Every `<img>` needs a meaningful `alt`. Decorative images: `alt=""`.
- Forms: every input needs a `<label>` with a matching `for`/`id`. Group related fields with `<fieldset>` + `<legend>`.
- Use `<button>` for actions, `<a>` for navigation. Never `<div onClick>`.
- Always set `width` and `height` on images/video to prevent CLS.

---

## CSS — Modern Patterns

### Cascade Layers (use in new projects)
```css
@layer reset, tokens, base, layout, components, utilities;
/* Third-party: */ @import url("vendor.css") layer(vendor);
```

### Native Nesting
```css
.card {
  padding: 1rem;
  & h3 { margin: 0 0 .5rem; }
  &:hover { border-color: oklch(0.8 0.1 20); }
  @container (min-width: 30rem) { display: grid; }
}
```

### Container Queries — components, not pages
```css
.card-wrapper { container: card / inline-size; }
@container card (min-width: 400px) { .card { display: flex; } }
```
Use `@media` only for global layout shifts and user-preference queries (`prefers-reduced-motion`, `prefers-color-scheme`, `prefers-contrast`).

### `:has()` — fully supported 2025+
```css
form:has(:user-invalid) { border-color: red; }
.card:has(img) { display: grid; grid-template-columns: auto 1fr; }
```

### Subgrid — align nested cards
```css
.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; }
.card { display: grid; grid-template-rows: subgrid; grid-row: span 3; }
```

### Modern Color
```css
:root { --brand: oklch(0.72 0.18 250); }
.btn:hover { background: color-mix(in oklab, var(--brand) 60%, white); }
```
Prefer `oklch` for design tokens (perceptually uniform). Use `light-dark()` for dark mode:
```css
:root { color-scheme: light dark; }
.btn { background: light-dark(white, oklch(0.25 0.03 264)); }
```

### Animations — always gate on motion preference
```css
.element { opacity: 1; transform: none; } /* base: no motion */

@media (prefers-reduced-motion: no-preference) {
  .element { animation: slide-up 0.3s ease-out both; }
}
```
Animate only `transform` and `opacity` — these are GPU-composited. Never animate `width`, `height`, `top`, `left`, `box-shadow`.

Duration guidelines: UI transitions 150–300 ms, complex transitions up to 500 ms.

### Scroll-driven Animations (Chromium + Safari, gate with @supports)
```css
@media (prefers-reduced-motion: no-preference) {
  @supports (animation-timeline: view()) {
    .reveal {
      animation: fade-up linear both;
      animation-timeline: view();
      animation-range: entry 0% entry 100%;
    }
  }
}
```

### Logical Properties — required for RTL/i18n
Use `margin-inline`, `padding-block`, `inset-inline-start`, `border-inline-end` instead of directional equivalents.

### Viewport Units
Use `dvh`/`svh`/`lvh` to fix the mobile browser chrome problem. Avoid bare `100vh` on mobile.

---

## TypeScript — Required Settings

```json
{
  "strict": true,
  "noUncheckedIndexedAccess": true,
  "exactOptionalPropertyTypes": true
}
```

Patterns:
- `unknown` over `any` at API/external boundaries.
- Zod or Valibot for runtime validation that mirrors TypeScript types.
- Branded types for IDs: `type UserId = string & { readonly __brand: 'UserId' }`.
- `satisfies` over type assertions: `const cfg = { ... } satisfies Config`.
- `using` / `await using` for explicit resource management.

---

## React 19 — Key Patterns

### Actions and async transitions
```jsx
'use client';
import { useOptimistic } from 'react';

function Likes({ post, like }) {
  const [optimistic, addOptimistic] = useOptimistic(post.likes, (n) => n + 1);
  return (
    <form action={async () => { addOptimistic(); await like(post.id); }}>
      <button>♥ {optimistic}</button>
    </form>
  );
}
```

### What changed in React 19
- `ref` is now a prop in function components — stop using `forwardRef`.
- `useActionState`, `useFormStatus`, `useOptimistic` for forms.
- `use()` reads promises and context conditionally.
- **React Compiler** (stable in React 19 / Next.js 16) auto-memoizes — stop writing `useMemo`, `useCallback`, `React.memo` by default.
- Server Components + Server Actions are stable in framework context.

### Component patterns
- Prefer composition over inheritance.
- Keep components small: one responsibility per component.
- Lift state only as high as needed.
- Colocate data fetching with the route, not deeply nested components.
- Use `Suspense` + `lazy()` for code splitting at route and heavy-component level.

---

## Performance — Core Web Vitals (current as of 2024)

| Metric | Good | Needs Work | Poor |
|---|---|---|---|
| LCP (Largest Contentful Paint) | ≤ 2.5 s | ≤ 4.0 s | > 4.0 s |
| INP (Interaction to Next Paint) | ≤ 200 ms | ≤ 500 ms | > 500 ms |
| CLS (Cumulative Layout Shift) | ≤ 0.1 | ≤ 0.25 | > 0.25 |

**Note:** FID is retired. INP replaced it in March 2024 — it measures the worst interaction latency during a full visit, which is a harder bar.

### LCP checklist
- Add `fetchpriority="high"` + `<link rel="preload">` for the hero image.
- Never `loading="lazy"` on the LCP image.
- Inline critical CSS; defer non-critical with `media` swap.
- Self-host fonts, use `font-display: swap`, preload only the variable font needed.

### INP checklist
- Break up long tasks with `scheduler.yield()` or `await new Promise(r => setTimeout(r))`.
- Defer non-essential work with `requestIdleCallback` or `scheduler.postTask({ priority: 'background' })`.
- Move heavy computation to Web Workers (use Comlink).
- Use `content-visibility: auto` on off-screen sections.

### CLS checklist
- Always set `width` + `height` (or `aspect-ratio`) on images, videos, iframes.
- Reserve space with skeletons or `min-height` for async content.
- Use `font-size-adjust` + `size-adjust` in `@font-face` to match fallback metrics.

### Image stack
```html
<picture>
  <source type="image/avif" srcset="hero-800.avif 800w, hero-1600.avif 1600w"
          sizes="(max-width: 800px) 100vw, 800px">
  <source type="image/webp" srcset="hero-800.webp 800w, hero-1600.webp 1600w"
          sizes="(max-width: 800px) 100vw, 800px">
  <img src="hero-800.jpg" alt="..." width="1600" height="900"
       loading="eager" fetchpriority="high" decoding="async">
</picture>
```
- AVIF first (30–50% smaller than JPEG), WebP fallback, JPEG/PNG legacy.
- SVG for logos and icons. Avoid icon fonts.
- `<video>` instead of GIF for animations.

---

## Accessibility (WCAG 2.2 — current baseline)

WCAG 2.2 is the working baseline (ISO/IEC 40500:2025). Target AA minimum. Key additions over 2.1:

| Criterion | Level | What to do |
|---|---|---|
| 2.4.11 Focus Not Obscured | AA | Sticky headers/banners must not fully hide focused elements. |
| 2.5.7 Dragging Movements | AA | Every drag operation needs a single-pointer alternative. |
| 2.5.8 Target Size | AA | Pointer targets ≥ 24×24 CSS px. Aim for 44×44 on mobile. |
| 3.3.7 Redundant Entry | A | Don't ask for information already entered in the same session. |
| 3.3.8 Accessible Authentication | AA | Allow paste, password managers, OAuth, magic links. No cognitive puzzles without alternative. |

### Practical checklist
- Keyboard navigation: all interactive elements reachable and operable.
- Visible focus indicator: ≥ 2 px outline, 3:1 contrast ratio minimum.
- Color contrast: 4.5:1 for normal text, 3:1 for large text and UI components.
- ARIA: use only when native HTML semantics are insufficient. Prefer `<button>` over `role="button"`.
- Screen readers: test with NVDA+Firefox or VoiceOver+Safari.
- `prefers-reduced-motion`: always respected — see Animation section.

---

## Security — Frontend Baseline

- **Never** trust client-side data. Validate on the server.
- Sanitize HTML before rendering (`DOMPurify` or framework sanitizers). Never `dangerouslySetInnerHTML` with user content.
- Use `Content-Security-Policy` headers. Avoid `unsafe-inline` for scripts.
- Store tokens in `httpOnly` cookies, not `localStorage`.
- Apply `SameSite=Strict` or `SameSite=Lax` on auth cookies to prevent CSRF.
- Always use HTTPS. Redirect HTTP → HTTPS at the server level.
- Use `rel="noopener noreferrer"` on `target="_blank"` links.
- Validate and sanitize all URL parameters before use.

---

## Testing Strategy

### Unit / component tests (Vitest + React Testing Library)
```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

test('increments count', async () => {
  render(<Counter />);
  await userEvent.click(screen.getByRole('button', { name: /increment/i }));
  expect(screen.getByText('1')).toBeInTheDocument();
});
```
- Test behavior, not implementation. Query by role, label, text — not by class or test ID.
- Aim for 70%+ coverage on business logic. 100% coverage is not the goal.

### E2E tests (Playwright)
```ts
test('user can log in', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill('test@example.com');
  await page.getByLabel('Password').fill('password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL('/dashboard');
});
```

### CI pipeline minimum
```yaml
# .github/workflows/ci.yml
- run: npm ci
- run: npm run type-check
- run: npm run lint
- run: npm run test -- --coverage
- run: npm run build
```
Add E2E tests on staging, not every PR (slow). Run unit + type-check + lint on every push.

---

## Git Workflow

- `main` — always deployable.
- `feat/`, `fix/`, `chore/` prefixes for branch names.
- Atomic commits: one logical change per commit.
- PR template: description, test plan, screenshots for UI changes.
- Squash merge feature branches into main.

---

## Design System Principles

A complete design system includes:
1. **Design tokens** — color, spacing, typography, elevation in W3C DTCG-compatible JSON.
2. **Headless / primitive components** — accessibility and logic, no visual opinions.
3. **Styled components** — visual layer consuming tokens.
4. **Motion, color, typography scales** — documented and versioned.
5. **Patterns** — login flows, error/empty/loading states, data tables, form patterns.

Drive dark mode from semantic tokens, not component-level overrides.

---

## Competency Levels (quick reference)

| Area | Baseline | Production-ready | Senior |
|---|---|---|---|
| HTML/CSS | Semantic HTML, responsive Flexbox/Grid | Design systems, CSS layers, container queries | Subgrid, scroll-driven animations, WCAG audits |
| JavaScript | ES6+, DOM, fetch | TypeScript strict, modules, Web Workers | Signals, Web Components, performance profiling |
| React | Components, hooks, routing | React 19 features, RSC, Suspense | Compiler, micro-frontends, SSR/SSG with Next.js |
| Testing | Manual + basic unit tests | RTL + Playwright, CI integration | Full QA strategy, coverage gates, visual regression |
| Performance | HTTPS, basic optimization | Core Web Vitals monitoring, LCP/INP/CLS fixes | RUM analysis, advanced profiling, CDN config |
| Security | Input validation, HTTPS | CSP, httpOnly cookies, sanitization | Penetration testing awareness, security headers audit |
