# Project Improvement Skill — my-inventory

Use this skill when improving, fixing, refactoring, or extending the my-inventory React/TypeScript project.

---

## Project Overview

**Product:** Inventory management system for Spanish-speaking users.

**Core modules:** Productos · Compras · Gastos · Kardex · Personas · Usuarios · Autenticación JWT

**Main UX patterns:**
- CRUD flows standardized through configuration

**Tech stack:** React 18 · TypeScript (strict) · Vite · Tailwind CSS v4 · Zustand · Axios · Vitest · React Testing Library · SweetAlert2 · Recharts

---

## Critical Architecture Rule (Read First)

This project is **configuration-driven**. Do NOT create new CRUD components for new entities.

All CRUD pages are built through `GenericPage`. To add or modify an entity page:
1. Define types
2. Create service
3. Create config object
4. Register route and navigation

**Canonical example:** [src/config/productPageConfig.tsx](src/config/productPageConfig.tsx)

Before touching any CRUD page, read `GenericPage` and `productPageConfig.tsx`.

---

## Improvement Priorities

### P0 — Security (before any new feature)

**1. Remove bcryptjs from client**
- `bcryptjs` must not exist in the frontend.
- Search for usage. If unused: remove the dependency entirely.
- If somehow used: move that logic to the backend.

**2. Improve auth token storage**
- Current: JWT in `localStorage` → vulnerable to XSS.
- Preferred: `httpOnly` cookies (requires backend support).
- If migrating: update `httpClient.ts`, interceptors, and `AuthService` together. Do not partially migrate.

**3. Handle token expiration during active requests**
- Current: expiration checked only on app load via `checkAuth()`.
- Required: interceptor-level handling for mid-session expiry.
- Expected behavior: clear auth state → redirect to `/login` → maintain error consistency.

---

### P1 — Type Safety

Reduce unsafe typing before adding new forms or features.

**`useGenericForm.ts` and `GenericForm`**
- Remove all `any`. Use generics, mapped types, or discriminated unions.

**API boundaries**
- Never trust API responses directly. Type incoming data as `unknown`, then validate/parse.

**Service method signatures**
- Replace broad `Partial<T>` with explicit DTOs: `CreateProductInput`, `UpdateProductInput`.

---

### P2 — Stability / Memory Safety

**`useApiRequest` missing `AbortController`**
- Current: deduplicates concurrent requests but does not cancel on unmount.
- Required pattern:

```ts
useEffect(() => {
  const controller = new AbortController();
  fetchData({ signal: controller.signal });
  return () => controller.abort();
}, []);
```

---

### P3 — Validation Refactor

**Duplicated validation in `useGenericForm`**
- `handleBlur` and `validateForm` run the same logic.
- Extract a pure `validateField(field, value)` function and call it from both.

---

## Testing Strategy

**Current coverage:** ~6% (service integration tests only). Zero coverage on hooks, components, stores.

### Priority order

| Order | Target | Why |
|---|---|---|
| 1 | `useApiRequest`, `useServerPagination` | Highest ROI — foundation for every data fetch |
| 2 | `GenericPage` + child components | Most used UI, zero tests |
| 3 | `useGenericForm` | Complex validation logic, regression risk |
| 4 | Zustand stores, `createEntityStore` | Cache TTL behavior is invisible without tests |

### Conventions

- **Services:** `axios-mock-adapter` (follow existing patterns in `src/services/__tests__/`)
- **UI / hooks:** React Testing Library + Vitest
- **Query by:** role, label, text — never class selectors or test IDs unless unavoidable
- **Test behavior, not implementation**

### Commands

```bash
npm test                # watch mode
npm run test:coverage   # coverage report
```

Coverage config in `vite.config.ts`. Current `include` covers only `src/services/**/*.ts` — expand it when adding hook or component tests.

---

## Invariants (Do Not Break)

### HTTP access
Never call `httpClient` directly from components or hooks. Always go through a service extending `ApiService<T>`. This centralizes URL building, error extraction, and consistency.

### Store access
When an entity has a Zustand store (`createEntityStore`), use it. Do not bypass the store's 5-minute TTL cache with direct fetches.

### Error handling flow
```
ApiService → useApiRequest → component error state → useToast / useCrudToast
```
Do not short-circuit this chain. No direct alerting inside services.

### Strings
No i18n exists. Keep all user-facing text in Spanish. If adding more than 5 strings in one domain, create a constants file (e.g., `src/constants/expenseMessages.ts`) instead of scattering literals.

---

## Common Workflows

### Add a new CRUD page
1. Create type in `src/types/`
2. Create service extending `ApiService<T>` in `src/services/`
3. Create config in `src/config/`
4. Add route in `src/App.tsx`
5. Add nav item in `src/constants/NavItems.tsx`
6. Add service integration tests

### Add a field to an existing form
1. Update the type
2. Update the config
3. Update the service if needed
4. Update test fixtures

### Debug API issues
- Enable `VITE_DEBUG_MODE=true`
- Inspect `src/services/httpClient.ts`
- Expected: 401/403 clears auth and redirects to `/login`

---

## Environment Variables

```env
VITE_API_URL_PROD=http://localhost:3000
VITE_APP_TITLE=My Inventory
VITE_DEBUG_MODE=false
VITE_REQUEST_TIMEOUT=30000
```

Copy `.env.example` → `.env` for local dev.

---

## Forbidden Changes

- Add dependencies without strong justification
- Use `dangerouslySetInnerHTML`
- Store sensitive data in `localStorage` / `sessionStorage` beyond the current token
- Introduce new `any`
- Bypass `GenericPage` for CRUD pages without written justification
- Add or expand client-side password hashing (`bcryptjs`)

---

## Definition of Done

A task is complete only when:

- [ ] TypeScript passes in strict mode
- [ ] Existing tests pass
- [ ] New behavior is tested where relevant
- [ ] No architecture invariants were violated
- [ ] No new `any` introduced
- [ ] Spanish UX consistency maintained
