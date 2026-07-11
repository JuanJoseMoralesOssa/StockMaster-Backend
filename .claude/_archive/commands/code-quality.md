# Code Quality — Revisión y Refactor Frontend (my-inventory)

Skill para revisar, escribir o mejorar código React + TypeScript en este proyecto. Aplica los principios SIEMPRE, sin excepción. Si ves una violación aunque no se haya pedido revisarla, señálala.

> Stack real (no improvisar): React 19 · TypeScript estricto · Vite 8 · Tailwind 4 · react-router-dom 7 · react-hook-form 7 + Zod 4 · Zustand 5 · Axios (vía service layer) · Vitest + RTL.
>
> **Ojo con dos divergencias frecuentes** entre principios genéricos de React y la realidad de este repo:
> - **Estado de servidor:** Este proyecto usa **Zustand con `createEntityStore` (TTL 5 min)**, NO TanStack Query. No sugieras instalar `@tanstack/react-query` salvo que el usuario lo pida explícitamente.
> - **Organización por dominios:** Este proyecto es **configuration-driven** vía `GenericPage` + `src/config/*PageConfig.tsx`, NO `src/features/`. No propongas reorganizar a `features/` salvo petición explícita; en su lugar, refuerza el patrón existente.

---

## 🏗️ Arquitectura y estructura (este repo)

- CRUD nuevos → SIEMPRE vía `GenericPage` + config en `src/config/`. El canónico es [src/config/productPageConfig.tsx](src/config/productPageConfig.tsx).
- Capas estables: `src/types/` · `src/services/` (extiende `ApiService<T>`) · `src/hooks/` · `src/config/` · `src/pages/` · `src/components/`.
- Componentes de página complejos viven en `src/pages/<dominio>/components/` (co-locación).
- Path aliases ya configurados vía `vite-tsconfig-paths`. Úsalos: `@/hooks/...`, `@/services/...`, `@/types/...`. No imports relativos profundos (`../../../`).
- Nunca mezclar lógica de negocio con presentación en el mismo archivo. Si un componente fetchea, transforma y pinta — sepáralo.

---

## 🧩 Componentes

- **Una responsabilidad por componente.** Si pasa de **150–200 líneas**, divídelo.
- **Tipado estricto.** Toda prop tiene interfaz. **Cero `any`** — usa `unknown` en bordes (API), genéricos en utilitarios, uniones discriminadas en variantes.
- **Prop drilling > 2 niveles ⇒ refactor.** Opciones en este proyecto:
  - Crear un Zustand store con `createEntityStore` o un store ad-hoc para estado compartido.
  - Subir el estado al contenedor real, no al ancestro común más arriba de lo necesario.
  - Extraer un Context local cuando sea estrictamente shared y no global.
- **Separar dumb vs smart.**
  ```tsx
  // ❌ Mal — el componente de presentación hace fetch y conoce filtros
  function InventoryTable({ fetchData, filters, onEdit }) { ... }

  // ✅ Bien
  function InventoryTable({ products, onEdit }: Props) { ... }       // presentación
  function InventoryTableContainer() { ... }                          // lógica + fetching
  ```
- **Composición sobre flags.** Mejor `<Modal.Footer>{children}</Modal.Footer>` que `<Modal hasFooter footerVariant="...">`.

---

## 📦 Manejo de estado — regla de oro

| ¿De dónde viene? | Solución en este repo |
|---|---|
| Servidor (lista de productos, detalles) | **Zustand store con `createEntityStore`** (cache TTL 5 min) o `useApiRequest` para llamadas one-off |
| Formulario | **react-hook-form + Zod** (`mode: "onBlur"`) |
| Local del componente | `useState` |
| Complejo o compartido entre rutas | **Zustand store** (`useShallow` al seleccionar varios campos) |
| Múltiples sub-estados relacionados (filtros con muchas dimensiones) | `useReducer` |

**Reglas:**
- Nunca copiar estado del servidor a `useState` local — el store ya cachea.
- **Estado derivado → calcúlalo en render** o con `useMemo` solo si es costoso. Nunca en `useState` + `useEffect` para "sincronizar" — es el anti-patrón #1.
- Normaliza datos: evita objetos anidados profundos en stores.

---

## ⚡ Performance

- **Listas grandes** → paginación server-side (ya provista por `useServerPagination`). Si necesitas virtualización por scroll infinito, justifica e instala `@tanstack/react-virtual` solo entonces.
- **React 19 tiene compilador**, así que `React.memo`, `useMemo`, `useCallback` solo cuando profiling demuestre cuello de botella real. No por superstición.
- **Code splitting por ruta:** `React.lazy` + `Suspense` para páginas pesadas (gráficos del dashboard, exportadores con `exceljs`).
- **Búsquedas y filtros con debounce ≥ 300 ms.** Implementa con `setTimeout` + cleanup en `useEffect`, o crea un `useDebouncedValue` en `src/hooks/`.
- Mide antes de optimizar: React DevTools Profiler.

---

## 🌐 Fetching y datos

- **Toda llamada a API va en un service** (`src/services/*.ts` extendiendo `ApiService<T>`). Nunca `axios` o `httpClient` directo en un componente o página.
- Cubrir SIEMPRE los tres estados en la UI: **loading, error, empty**. Si falta uno, la pantalla rompe.
- Tipado completo de respuestas: nunca `any`. Considera DTOs explícitos: `CreateProductInput`, `UpdateProductInput`. Evita `Partial<T>` en métodos de escritura.
- **Cancelación de requests:** `useApiRequest` aún no acepta `AbortController`. Si tu efecto puede desmontarse durante una petición, abrirlo es el patrón requerido (ver pendiente P2 en `/improve`).
- Optimistic updates para acciones frecuentes (cambiar stock, marcar pagado) cuando el riesgo de rollback sea bajo.

---

## 🎯 Calidad y mantenibilidad

- **ESLint + TypeScript estricto en CI.** Cualquier `any`, import no usado o efecto sin deps explícitas se reporta.
- **Custom hooks para lógica reutilizable.** Nombres con intención y dominio:
  - ✅ `useStockAdjustment`, `useProductSearch`, `useDebouncedValue`
  - ❌ `useData`, `useStuff`, `useHandler`
- **Nombres de handlers con la acción real.**
  - ❌ `handleClick`, `onChange`, `submit`
  - ✅ `handleAddProductToStock`, `handleConfirmDeleteExpense`
- **Constantes para magic strings/numbers.** Si aparecen 2+ veces, extrae:
  ```ts
  // ❌ if (status === 'low_stock') ...
  // ✅
  export const STOCK_STATUS = { LOW: 'low_stock', OK: 'ok', OUT: 'out' } as const
  if (status === STOCK_STATUS.LOW) ...
  ```
  Si un dominio acumula >5 strings de UI, créalos en `src/constants/<dominio>Messages.ts`.
- **Tests** con Vitest + RTL. Probar **comportamiento, no implementación**. Queries por `role`/`label`/`text`, nunca por clase o test ID.
- **JSDoc** en hooks y componentes con API no obvia (1–2 líneas, no novelas).

---

## 🚨 Anti-patrones — bloquéalo siempre

1. ❌ `useEffect` para sincronizar estado derivado del estado de otro `useState`.
2. ❌ `axios` o `httpClient` directo en un componente o página (debe ir vía service).
3. ❌ `any` en props, retornos de API, o argumentos de hooks reutilizables.
4. ❌ Lógica de negocio dentro del JSX: ternarios anidados, cálculos largos inline, casts.
5. ❌ Copiar el resultado de un store/`useApiRequest` a un `useState` local.
6. ❌ Cadenas de re-renders sin memoización justificada (medir primero).
7. ❌ "Componentes Dios" — un componente que hace fetch + filtros + tabla + modal + edición.
8. ❌ Magic strings/numbers hardcodeados repetidos en >1 archivo.
9. ❌ Bypass de `GenericPage` para CRUDs estándar sin justificación escrita.
10. ❌ `dangerouslySetInnerHTML` con contenido del usuario.

---

## ✅ Flujo de revisión (sigue este orden)

Cuando revises código existente o un PR, recorre los puntos en este orden y para cada hallazgo reporta **(1) qué está mal, (2) por qué es problema, (3) cómo corregirlo con código concreto**.

1. **Estructura y separación de responsabilidades** — ¿el archivo mezcla fetching con render? ¿supera 200 líneas? ¿hay un CRUD ad-hoc que debería ser `GenericPage`?
2. **Tipado TypeScript** — props, DTOs de servicios, respuestas de API. Buscar `any`, `as unknown as`, retornos implícitos.
3. **Estado** — ¿está en el lugar correcto según la regla de oro? ¿hay copia de servidor → useState? ¿prop drilling >2 niveles?
4. **Fetching y sincronización** — ¿pasa por service? ¿maneja loading/error/empty? ¿cancela en unmount? ¿hay duplicación con el store existente?
5. **Performance** — listas grandes sin paginación, búsquedas sin debounce, gráficos pesados sin lazy, memoización supersticiosa.
6. **Nombres, constantes, legibilidad** — handlers genéricos, magic strings, mensajes inline.
7. **Cobertura de estados UI** — loading (skeleton), error (qué pasó + cómo recuperarse), empty (qué hacer ahora).
8. **Custom hooks por extraer** — lógica que se repite o sería reusable: extracción a `src/hooks/`.

Reporta primero los hallazgos críticos (P0 — seguridad, rotura de invariantes), luego mejoras (P1 — tipos, estado), luego pulido (P2 — nombres, microperformance).

---

## Definition of Done

Una tarea está completa solo si:

- [ ] TypeScript estricto pasa en archivos tocados.
- [ ] Tests existentes pasan; nuevo comportamiento tiene test cuando corresponde.
- [ ] Cero `any` nuevos.
- [ ] No se rompió ningún invariante (`GenericPage`, services, store TTL, no `httpClient` directo).
- [ ] UX consistente en español; mensajes accionables.
- [ ] Ningún anti-patrón de la lista presente en el diff.
