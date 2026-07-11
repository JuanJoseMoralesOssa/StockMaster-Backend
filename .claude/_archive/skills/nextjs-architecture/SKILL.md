---
name: nextjs-architecture
description: Convenciones y patrones de arquitectura para `web/` (Next.js 15 + React 19, App Router, Server/Client Components, data fetching contra el API FastAPI, caching, estilos). Usa esta skill SIEMPRE que crees o modifiques rutas, layouts, páginas, route handlers o componentes en `web/` — incluso si el usuario no menciona "arquitectura". También aplica al decidir si un componente debe ser server o client, al definir patrones de data fetching hacia `api/`, error/loading boundaries, y al escribir o migrar estilos con Tailwind.
---

# Arquitectura Next.js 15 + React 19 — `web/`

Esta skill captura cómo trabajamos en `web/`, la interfaz de gráficos del proyecto de trading. Es opinionada: hay UNA forma correcta por defecto, y las excepciones se justifican.

## Stack confirmado

Next 15 (App Router) · React 19 · TypeScript estricto · dos librerías de gráficos con roles distintos: `lightweight-charts` para el candlestick de `PriceChart` (canvas imperativo, necesita valores de color ya resueltos) y `recharts` para los gráficos analíticos (`BudgetChart`, `PerformanceChart` — SVG/HTML, puede leer `var(--token)` directo, theming compartido en `src/lib/recharts.ts`) · sin base de datos ni auth del lado de Next (proyecto personal de un solo usuario, corre en loopback) · todo el estado vive en `api/` (FastAPI) sobre SQLite, consumido desde Next vía `fetch` con el helper `src/lib/api.ts` · Tailwind v4 **instalado y con la migración de `globals.css` a utilities completa** (`tailwindcss` + `@tailwindcss/postcss`, `postcss.config.mjs`; ver sección de estilos más abajo) · `npm`.

## Estructura de carpetas actual

```
web/
  src/
    app/
      page.tsx              # panel — hoy Client Component
      BudgetChart.tsx        # co-locado: barras de uso de API (Recharts), usado solo por page.tsx
      ticker/[symbol]/      # detalle de un ticker: page.tsx (client, use(params)) +
                            #   ChartCard.tsx y AnalysisCard.tsx co-locados, cada uno con su propio fetch y error
      posiciones/           # page.tsx + TradeForm.tsx co-locado (mutación real — ver sección Mutaciones)
      historial/, diario/
      rendimiento/           # page.tsx + PerformanceChart.tsx co-locado (barras agrupadas, Recharts)
      globals.css           # tokens de color + estilos globales (Tailwind — ver sección de estilos)
      layout.tsx
    components/              # compartidos: StatTile, VerdictBadge, ScoreBar, PriceChart, CriteriaTable, Nav, AsyncTableBody, ErrorBanner
      chart/                 # subcomponentes de PriceChart: ChartLegend, ChartTooltip, zone-band-primitive (ISeriesPrimitive de lightweight-charts)
    lib/
      api.ts                 # cliente fetch (apiFetch) + ApiError + errorMessage (mensaje para la UI desde un catch)
      hooks.ts               # usePageTitle + useApiData (fetch client con estado data/error/reload y guarda de carrera)
      format.ts              # formatters de presentación puros (fmtPct, fmtMoney, fmtDate, fmtDateTime...) — sin side effects
      screener.ts            # reconstruye spy_bullish desde ScreenerRunOut.notes (parche hasta que el API lo tipe)
      chart-utils.ts         # helpers de PriceChart (cssVar por tema, asof sobre PricePoint) — lightweight-charts
      recharts.ts            # theming compartido de los charts Recharts (axisTick, tooltipStyle, GRID_STROKE...) — BudgetChart y PerformanceChart lo importan, no dupliques estilos de eje/tooltip ahí
      verdict.ts              # fuente única de íconos/labels/orden/color por veredicto (VERDICT_ICON, VERDICT_LABEL, VERDICT_ORDER, VERDICT_FILL para Recharts, VERDICT_TEXT_COLOR para className) — VerdictBadge y PerformanceChart lo comparten
      types.ts               # tipos espejo de api/src/api/schemas.py — mantenidos A MANO (ver flujo abajo)
      # api-schema.d.ts      # NO existe en el repo hasta correr `npm run gen:api`; se genera bajo demanda
                             #   como referencia para diffear contra types.ts, no está versionado ni lo importa nadie
```

No hay `app/api/` propio (las mutaciones y lecturas de datos las sirve `api/` en Python, en otro proceso) ni `src/domain/` — la lógica de negocio (checklist, scoring, indicadores) vive en `engine/` (Python), no en Next. `web/` es una capa de presentación delgada.

## Contrato de tipos con el API (`gen:api`)

`src/lib/types.ts` se mantiene **a mano** — `npm run gen:api` NO lo regenera. Lo que hace es generar `src/lib/api-schema.d.ts` (con `openapi-typescript`) a partir de `web/openapi.json`, y ese archivo sirve solo como referencia para comparar; nada lo importa. El flujo completo cuando cambia `api/src/api/schemas.py`:

```powershell
# Windows PowerShell (shell primario del repo): NO uses `>` — la redirección de
# PowerShell 5.1 escribe UTF-16 LE con BOM y `gen:api` revienta con
# "null byte is not allowed in input". Usá Out-File -Encoding utf8:
uv run python -m api.export_openapi | Out-File web/openapi.json -Encoding utf8
cd web; npm run gen:api
```

```bash
# Desde Git Bash o cmd el `>` sí produce UTF-8 y funciona tal cual:
uv run python -m api.export_openapi > web/openapi.json && (cd web && npm run gen:api)
```

y luego se diffea `api-schema.d.ts` contra `types.ts` y se actualiza `types.ts` a mano (conservando sus doc comments y nombres semánticos). No borres ni sobrescribas `types.ts` pensando que es un artefacto generado — no lo es.

## Server vs Client Components — la regla por defecto

**Server Component por defecto. `'use client'` solo cuando lo necesites de verdad.** Razones válidas:
- `useState`, `useReducer`, `useEffect`, `useRef`
- Handlers de eventos del DOM (`onClick`, `onChange`)
- APIs del browser (`window`, `document.title`, `localStorage`)
- `lightweight-charts` monta un canvas imperativo → el componente que lo envuelve (`PriceChart`) necesariamente es client.

**Estado actual (migración completada, verificado 2026-07-10):** las seis páginas son Server Components con `export const metadata` y fetch en el servidor; la interactividad vive en islas client co-locadas (charts, formularios, filtros como `HistorialFilters`). `useApiData`/`usePageTitle` quedan solo para componentes client que refrescan datos tras una mutación. Como el backend es una API HTTP normal, un Server Component puede hacer `await fetch(...)` directamente contra `api/` sin pasar por el cliente — es más simple y evita el parpadeo de "…" mientras carga. Reserva `'use client'` para el widget que de verdad necesita interactividad (el chart, un botón de reintento, un formulario) y deja el resto (fetch inicial, layout) en el server. Migrar páginas existentes a este patrón es una mejora incremental, no un bloqueante. El título de página lo setea el hook `usePageTitle(title)` (`src/lib/hooks.ts`) mientras las páginas sean client; al migrar una a Server Component, reemplazá `usePageTitle` por `export const metadata` — o `generateMetadata` cuando el título depende de `params`, como en el detalle de un ticker.

```tsx
// ejemplo del patrón recomendado para páginas nuevas — SERVER
// La env var es NEXT_PUBLIC_API_URL (la misma que usa src/lib/api.ts) — no existe
// `process.env.API_URL`. Acá `API_URL` es solo el nombre de la constante local.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8000";

async function getStatus(): Promise<ScreenerStatus> {
  const res = await fetch(`${API_URL}/api/screener/status`, { cache: "no-store" });
  if (!res.ok) throw new Error(`API respondió ${res.status}`);
  return res.json();
}

export default async function Page() {
  const status = await getStatus();
  return <PanelView status={status} />; // PanelView puede ser server; solo el chart interno es client
}
```

Si dudas, mantenlo server. Pasa datos de server a client por props serializables. Las funciones normales no cruzan el boundary (las Server Actions `'use server'` sí — ver Mutaciones). `Date` técnicamente sí se serializa, pero acá los timestamps ya vienen del API como string ISO: déjalos así en el boundary en vez de reconstruir `Date` en el server solo para volver a serializarlo.

## `params` y `searchParams` son `Promise` en Next 15+

Breaking change desde Next 15. Siempre `await`:

```ts
export default async function Page({
  params,
}: {
  params: Promise<{ symbol: string }>;
}) {
  const { symbol } = await params;
  // ...
}
```

En un Client Component (una página existente que sigue siendo `"use client"`) no puede haber `async`/`await` en el cuerpo del componente — desenvuelve la Promise con el hook `use` de React 19, como ya hace `ticker/[symbol]/page.tsx`. No conviertas una página a Server Component solo para poder leer `params`:

```tsx
"use client";
import { use } from "react";

export default function TickerPage({ params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = use(params);
  // ...
}
```

Lo mismo con `cookies()`, `headers()` si los usas — son `async`.

## Data fetching: dónde y cómo

| Caso | Patrón |
|---|---|
| Leer datos en page/layout | `await fetch(...)` directo en el Server Component contra `${API_URL}/...`, con `cache: "no-store"` si el dato cambia seguido (precios, veredictos) |
| Datos que cambian poco (metadata, perfiles) | `fetch` con `next: { revalidate: N }` en vez de `no-store` |
| Interacción client (reintentar, cambiar de ticker sin recargar) | el helper `apiFetch<T>()` de `src/lib/api.ts` desde un Client Component, como hoy |

**No** uses `useEffect` para el fetch inicial de una página si el dato puede venir del server — es el anti-patrón más común a evitar aquí.

Nota sobre el `API_BASE` de `src/lib/api.ts`: en Server Components corriendo en el propio Next server, `127.0.0.1:8000` sigue siendo válido porque ambos procesos corren en la misma máquina (loopback). No hace falta una URL pública. La var de entorno es `NEXT_PUBLIC_API_URL` (legible tanto en server como en client — es solo una URL de loopback, no un secreto); no existe una `API_URL` separada.

## Mutaciones: cliente + `apiFetch`, no Server Actions

`web/` ya no es de solo lectura: `posiciones/TradeForm.tsx` registra trades reales (`POST /api/trades`). El patrón que quedó establecido **no** es una Server Action — es un Client Component con `apiFetch` directo dentro del handler de submit:

```ts
// dentro de un "use client", dentro del handler de submit
try {
  await apiFetch("/api/trades", { method: "POST", body: JSON.stringify(payload) });
  onRegistered(); // el padre re-dispara sus useApiData — ver posiciones/page.tsx
} catch (e: unknown) {
  setError(errorMessage(e));
} finally {
  setSaving(false);
}
```

Seguí este patrón (no la Server Action del ejemplo anterior de esta skill) cuando la mutación necesita algo de esto, que es lo normal en formularios con dinero real: validación de campos antes del POST (evitar mandar `NaN` serializado como `null`), un `window.confirm(...)` de resumen antes de escribir, y estado local `saving`/`ok`/`error` para dar feedback inmediato. Nada de eso encaja bien con el ciclo submit→redirect/revalidate de una Server Action. El padre no revalida cache de Next (no hay `revalidatePath` porque no hay Server Component leyendo esos datos) — simplemente vuelve a llamar `reload()` de sus `useApiData` vía el callback `onRegistered`.

Reservá una Server Action de verdad (con `revalidatePath`, como en versiones previas de este ejemplo) solo para el caso que todavía no existe en el repo: una página migrada a Server Component que necesita invalidar su propio cache tras mutar — ahí sí un `<form action={...}>` nativo tiene sentido porque no hay validación cliente previa que bloquee el submit.

No hay sesión que validar (proyecto de un solo usuario, sin auth) — si eso cambia algún día, agrega la verificación al inicio de cada mutación (Server Action o handler) antes que nada más.

## Loading y error boundaries por segmento

Cada segmento con fetch server-side debería tener `loading.tsx` (Suspense) y `error.tsx` (boundary). Hoy el manejo de error es manual dentro del componente (`if (error) return ...`) porque todo es client — al migrar una página a Server Component, preferí el boundary de Next:

```tsx
// loading.tsx — server, simple skeleton
export default function Loading() { return <p className="text-muted">Cargando…</p>; }

// error.tsx — DEBE ser client. Mismas utilities que ErrorBanner.tsx — si
// preferís no duplicar el string, extraé este boundary para que use el
// componente ErrorBanner directamente (onRetry={reset}).
"use client";
export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div role="alert" className="border border-status-critical text-status-critical-text rounded-[10px] px-3.5 py-2.5 mb-4">
      <p>Algo falló cargando esta vista.</p>
      <button className="ml-2.5" onClick={reset}>Reintentar</button>
    </div>
  );
}
```

Mientras las páginas sigan siendo client, ya hay patrones establecidos para los 4 estados (checklist punto 3), reusalos en vez de reinventarlos:
- **`useApiData(fetcher, deps?)` para el fetch de datos** (`src/lib/hooks.ts`): devuelve `{ data, error, reload }` con `error` ya formateado para la UI y guarda de carrera incorporada (una respuesta vieja no pisa a una nueva al cambiar un filtro). Reemplaza el par `reload`(`useCallback`)+`useEffect` que estaba repetido en cada página. Para varios fetch independientes en una misma vista, llamalo varias veces (el panel lo hace 4 veces, una por endpoint) en vez de encadenarlos. `loading` se deriva con `data === null && !error`.
- **`<ErrorBanner message onRetry />`** para el estado de error (mensaje + botón "Reintentar", con `role="alert"`). No repitas ese bloque JSX.
- **`errorMessage(e, fallback?)`** (`src/lib/api.ts`) para sacar el texto del `catch`: confía en el mensaje de `ApiError`, y para lo demás usa el fallback. No repitas `e instanceof ApiError ? e.message : "…"` inline.
- **Aislar el error por sección con componentes co-locados**: en la ruta `ticker/[symbol]/`, `ChartCard` y `AnalysisCard` hacen cada uno su propio `apiFetch` y manejan su propio error, así que si falla una sección (p. ej. se agota el presupuesto del LLM para la tesis) el resto de la vista sigue en pie. Si una página client tiene secciones con fetch independiente, extraé una por sección en vez de un `useEffect` gigante con varios `try/catch`. (Estos cards no usan `useApiData` porque además reportan el resultado al padre por callback.)
- **`AsyncTableBody` para tablas alimentadas por fetch**: centraliza los estados cargando / vacía / con-filas y el cálculo de `colSpan`. No repitas ese condicional en cada tabla — pasale `rows`, `loading`, `colSpan`, `emptyMessage` y `renderRow`.

## Performance y bundle

- `import dynamic from "next/dynamic"` para `PriceChart` si `lightweight-charts` empieza a pesar en el bundle inicial del panel (no es crítico hoy con pocas páginas).
- `next/image` si en algún momento se sirven imágenes propias (hoy no hay).
- El React Compiler es un plugin de build aparte (`babel-plugin-react-compiler`), no viene incluido en React 19; en Next 15 se activa con `experimental: { reactCompiler: true }` en `next.config.ts` tras instalar el plugin (hoy no está ni instalado ni configurado). Si se adopta, borra los `useMemo`/`useCallback` defensivos.

## Anti-patrones a evitar

- `useEffect(() => { fetch(...) }, [])` para data inicial en páginas nuevas, cuando podría venir del server.
- `params.symbol` directo sin desenvolver la Promise (`await` en server, `use()` en client) — Next 15+.
- Pasar funciones normales definidas en el server como props a un client component (no son serializables). Una Server Action con `'use server'` sí puede pasarse — regla general de Next, aunque hoy la única mutación del repo (`TradeForm`) no la usa: ver sección Mutaciones para por qué.
- `any` en boundaries (props públicos, respuestas de `fetch`, payloads del API). Tipa contra `src/lib/types.ts`.
- Actualizar `types.ts` "de memoria" cuando cambió `api/src/api/schemas.py`, sin regenerar el contrato de referencia — corré el flujo de `gen:api` (ver sección arriba) y compará contra `api-schema.d.ts` antes de tocar `types.ts`.

## Checklist antes de mergear una feature en `web/`

1. ¿La página nueva es Server Component salvo que necesite interactividad real?
2. ¿`params`/`searchParams` se desenvuelven bien (`await` en server, `use()` en client)?
3. ¿Las llamadas al API manejan `ApiError` y muestran los 4 estados (loading/vacío/error/éxito)?
4. ¿Si cambió el contrato del API, regeneraste `openapi.json` + `api-schema.d.ts` y actualizaste `types.ts` a mano (ver flujo `gen:api`)?
5. ¿No quedan `console.log`?
6. ¿`npm run lint` pasa? — es el único gate real de CI para `web/` (job `web` en `.github/workflows/ci.yml`). `npx tsc --noEmit` corrélo también: es buena práctica y lo pide esta skill, pero **CI todavía no lo corre** — no asumas que un PR verde garantiza cero errores de tipos.

---

## Estilos — Tailwind v4 (instalado y migrado)

`web/` tiene Tailwind v4 instalado (`tailwindcss` + `@tailwindcss/postcss`, `postcss.config.mjs`) y **la migración del CSS custom a utilities ya se hizo completa** — no queda ningún componente usando las clases viejas (`.muted`, `.ink2`, `.up`, `.down`, `.badge`, `.nav`, `.container`, `.tile`, `.warn-banner`, `.error-banner`, `.disclaimer`, `.grid-2`, `.mb-12`, `.table-wrap`, `.entry-meta`, `.entry-question`, `.row-between`, `.indent-list`, `.gate-icon`, `.legend`, `.chip`, `.scorebar`, `.spread`, `.brand`, `.active` — todas eliminadas de `globals.css`).

**Estructura final de `globals.css`:**
1. `@import "tailwindcss";`
2. Bloque `@theme` — puentea cada custom property de color (`--page`, `--surface`, `--ink`, `--status-good-text`, `--series-1`, etc.) al namespace `--color-*` que Tailwind exige para generar utilities, por `var()` (no duplica valores — el override de `prefers-color-scheme: light` se sigue resolviendo solo).
3. `:root` + su `@media (prefers-color-scheme: light)` — la paleta original, sin tocar. Los charts (`lightweight-charts` vía `chart-utils.ts`, Recharts vía `lib/recharts.ts`) siguen leyendo estos tokens directo por `var(--token)` en JS/inline style — no se migran a clases porque esas libs necesitan el string o el valor resuelto, no un `className`.
4. `@layer base` — reset (`*`), tipografía de `body`/`h1`/`h2`, `a`/`a:hover`, foco visible, estilos base de `button`/`input`/`select`, `table`/`th`/`td`/`tr:hover`. Selectores de elemento HTML puro, no clases — se quedan en CSS a propósito (Tailwind no reemplaza esto, es lo que `@layer base` existe para hacer).
5. `@layer components` — solo 5 clases sobreviven como `@apply`, todas reutilizadas 2+ veces y con estructura no trivial: `.card`, `.tiles`, `.controls`, `.seg` (+ `.seg button`, `.seg button.on`), `.primary`.

**Todo lo demás se inlineó** en su componente, siguiendo la regla ya establecida: mapeos de una sola utility (`.muted`→`text-muted`, `.up`→`text-status-good-text`, `.mb-12`→`mb-3`, `.table-wrap`→`overflow-x-auto`) se reemplazaron directo sin dejar alias; patrones usados en un solo archivo (`.nav`, `.badge`, `.scorebar`, `.legend`+`.chip`, `.grid-2`, `.disclaimer`, `.warn-banner`, `.error-banner`, `.entry-meta`, etc.) se escribieron como utilities ahí mismo. `VerdictBadge.tsx` es el ejemplo más elaborado: el color por veredicto vive en `VERDICT_TEXT_COLOR` (`src/lib/verdict.ts`), un mapa `verdict → clase Tailwind`, hermano de `VERDICT_FILL` (mismo mapa pero con `var(--token)` crudo, para el `fill` de Recharts) — mismo concepto, dos representaciones porque cada consumidor necesita una distinta; no dupliques esa lógica de color en un tercer lugar.

**Por qué Tailwind-first (y no solo preferencia de estilo):** en desarrollo asistido por IA, Tailwind no ahorra tokens porque las clases sean más cortas que CSS — de hecho el `className` inline puede pesar más. El ahorro real está en el *contexto total* que el modelo necesita cargar por sesión: con utilities en el JSX no hace falta abrir ni mantener sincronizado un `globals.css` growing con reglas repetidas, y un modelo como Claude ya conoce bien el vocabulario de utilities de Tailwind, así que razona sobre el diseño con menos texto explicativo. El ahorro crece más todavía con componentes reutilizables (la misma cadena de utilities no se vuelve a explicar cada vez). Por eso esta skill prioriza utilities + componentes compartidos sobre CSS separado, más allá del gusto estético.

- **Tailwind-first**: todo estilo nuevo se escribe con utilities en el `className` del JSX. Por defecto, no crear clases nuevas en `globals.css`.
- **Excepción deliberada — clases compartidas vía `@apply`**: para un patrón puramente visual (sin lógica ni props condicionales) que se repite 3+ veces, definí una clase en `@layer components` componiendo utilities con `@apply` (ver los 5 ejemplos reales arriba: `.card`, `.tiles`, `.controls`, `.seg`, `.primary`). Sigue siendo Tailwind-first — no es CSS a mano, es composición de utilities detrás de un nombre reutilizable. Si además hay lógica o variantes por props, es un componente React, no una clase (ver `StatTile`/`VerdictBadge`/`AsyncTableBody`/`ErrorBanner`).
- **Los tokens ya están puenteados a `@theme`, no los reinventes**: si agregás un token de color nuevo a `:root`, sumale también su entrada `--color-*` en `@theme` (una línea, por `var()`) o Tailwind no genera utility para él. **Cuidado con los estados:** hay dos familias deliberadas — relleno (`--status-good`/`-warning`/`-serious`/`-critical`, para velas, marcadores y el `fill` de barras de Recharts) y texto (`--status-*-text`, tematizadas para contraste AA 4.5:1 sobre `--surface`; difieren de las de relleno en `critical` y `serious`). Para colorear **texto** usá siempre la familia `-text` (`text-status-good-text`, como en `StatTile`/`VerdictBadge`/`CriteriaTable`), nunca la de relleno.
- **No inline `style={{…}}`** salvo valores genuinamente data-driven: el color por `tone` de `StatTile.tsx`, el `width` dinámico de `ScoreBar.tsx`, los swatches de `ChartLegend.tsx` (colores/gradiente por serie, ya iterando datos de a uno) y cualquier prop que reciba `lightweight-charts`/Recharts (necesitan el string `var(--token)` o el valor resuelto, no una clase) son la excepción legítima — no la generalices a estilos que sí podrían ser una utility fija.
- Breakpoints: el proyecto sigue usando `max-[900px]:` (desktop-first, ej. `ticker/[symbol]/page.tsx`) porque así era el comportamiento original — no lo tomes como convención a seguir en pantallas nuevas; para layouts nuevos preferí el `min-width` mobile-first por defecto de Tailwind (`sm:`, `md:`, etc.) salvo que haya una razón real para desktop-first.
- Un componente/página nuevo con un patrón repetido: primero mirá si `.card`/`.controls`/`.seg`/`.primary`/`.tiles` ya lo resuelven antes de escribir utilities sueltas o crear una clase nueva.

---

## UX — leyes de comportamiento de la interfaz (adoptadas 2026-07)

Complemento de las secciones técnicas: no *cómo se construye* la vista sino *cómo se comporta para quien la usa*. Meta transversal: **reducir carga cognitiva**. Que el proyecto tenga UN usuario no relaja nada — es el mismo usuario con prisa a las 16:35 ET operando dinero real.

- **Ley de Jakob (convenciones)**: la interfaz se comporta como los sitios que el usuario ya conoce — el brand del Nav linkea al home, el buscador va arriba a la derecha, las tablas llevan encabezado. No inventes una interacción nueva sin un argumento claro de que mejora la principal. Su versión interna es la **consistencia entre vistas**: el patrón de formulario de `TradeForm.tsx` (label visible chico arriba del input, un solo botón `.primary`, ok/error al lado con `role`) es el canon — un formulario nuevo lo copia, no improvisa otro.
- **Ley de Fitts (objetivos alcanzables)**: la base ya está en `globals.css` (`min-height: 40px` + fuente 16px bajo `pointer: coarse`, WCAG 2.5.8) y los labels **envuelven** a su input (click en el texto enfoca el campo) — mantené ambas cosas. Todo control nuevo: área de toque ≥24×24 px CSS incluso en desktop. Un control visualmente chico (el ✕ de un chip) amplía su área con padding aunque el glifo siga chico.
- **Ley de Hick (menos opciones, decisión más rápida)**: pocas acciones visibles por vista y UNA resaltada — nunca dos `.primary` en pantalla a la vez. Campos opcionales de un formulario van colapsados tras un `<details>` ("Más opciones") que se auto-abre cuando ya traen datos (modo edición). Las opciones de filtrado aparecen donde se usan, no antes.
- **Jerarquía visual (Krug)**: lo más importante es lo más prominente. Un `h1` por página; lo que requiere atención usa `tone` de `StatTile`/`Banner`, no un párrafo más. Si todo resalta, nada resalta.
- **Divulgación progresiva**: primero lo esencial, el detalle bajo demanda — `hint` en los tiles, `<details>`, secciones que cargan y fallan por separado (`ChartCard`/`AnalysisCard`).
- **Placeholder no es label**: todo campo de formulario lleva label visible; el placeholder es solo ejemplo de formato (`225.50`). Excepción deliberada: el buscador del Nav — el patrón universal de búsqueda se entiende sin label (acá Jakob gana).
