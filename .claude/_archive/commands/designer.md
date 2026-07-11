# Design System — Componentes, Tokens y Principios

> Este skill se activa automáticamente con `/frontend`. Úsalo también directamente con `/designer` cuando trabajes en componentes UI, tokens de diseño o revisión visual.

> **Stack activo:** React 19 + Vite 8 + Tailwind 4 + react-router-dom 7. Los archivos en `files/` son referencias de filosofía y patrones — usan `@radix-ui/*`, `class-variance-authority`, `clsx` y `tailwind-merge` que **no están instalados**. Adapta los ejemplos a Tailwind puro.

---

## Filosofía base

- **Color como señal, no decoración.** La interfaz base es casi monocromática. El color aparece para comunicar: acción, estado, feedback. Si todo tiene color, nada llama la atención.
- **Espaciado generoso reduce carga cognitiva.** Agrupa elementos relacionados con menos espacio, separa grupos distintos con más (Ley de Proximidad de Gestalt).
- **Los componentes `ui/` nunca tienen lógica de negocio ni fetch.** Reciben data como props y son altamente configurables.
- **Los componentes nunca consumen colores primitivos** (`--color-gray-900`). Siempre usan tokens semánticos (`--color-text-primary`). Así, cambiar el tema solo requiere tocar el bloque de tokens.

---

## Tokens de diseño (`globals.css`)

### Colores (OKLCH — perceptualmente uniforme)

```css
/* Primitivos — NO usar directamente en componentes */
--color-brand-500: oklch(0.52 0.20 264);
--color-danger-500: oklch(0.56 0.22 25);
--color-success-500: oklch(0.55 0.18 155);
--color-warning-500: oklch(0.75 0.18 85);

/* Semánticos — ESTOS son los que usan los componentes */
--color-bg-page:        var(--color-gray-50);
--color-bg-surface:     var(--color-gray-0);
--color-bg-subtle:      var(--color-gray-100);
--color-bg-muted:       var(--color-gray-200);
--color-border:         var(--color-gray-200);
--color-border-strong:  var(--color-gray-300);
--color-text-primary:   var(--color-gray-900);
--color-text-secondary: var(--color-gray-600);
--color-text-muted:     var(--color-gray-400);
--color-text-link:      var(--color-brand-600);
--color-action-bg:      var(--color-brand-600);
--color-action-bg-hover: var(--color-brand-700);
--color-focus-ring:     var(--color-brand-500);
```

### Radios, sombras, z-index, duración

```
Radius:  --radius-sm: 4px | --radius-md: 8px | --radius-lg: 12px | --radius-xl: 16px | --radius-full: 9999px
Shadows: xs → xl (sutiles, crean jerarquía sin ruido)
Z-index: base(0) raised(10) dropdown(100) sticky(200) modal(300) toast(400) tooltip(500)
Duration: fast(100ms) normal(200ms) slow(300ms) slower(500ms)
```

### Tipografía fluida

```css
/* clamp(min, preferred, max) — sin media queries */
--text-sm: clamp(0.80rem, 0.78rem + 0.11vw, 0.875rem);
--text-base: clamp(0.90rem, 0.88rem + 0.13vw, 1rem);
```

---

## Button

**Variantes — usa una prop `variant`, no props booleanas:**

| Variante | Uso | Regla |
|---|---|---|
| `primary` | CTA, submit | **UNO por página/sección** |
| `secondary` | Alternativa al primary | Complementa, no compite |
| `ghost` | Menú, iconos en tablas | No debe robar atención |
| `danger` | Acciones irreversibles | Siempre pide confirmación antes |
| `danger-outline` | Primer paso antes de danger | Menos alarma, misma semántica |
| `link` | Navegación inline | Solo cuando el espacio es reducido |

**Tamaños:** `xs` (tablas/chips) | `sm` (formularios) | `md` (default) | `lg` (CTA hero) | `icon` / `icon-sm` / `icon-xs`

**REGLA DE ORO:** Si tienes más de 2 botones en una fila, algo está mal. Jerarquía: primary > secondary > ghost. Un solo primary.

```tsx
// Botón con loading — bloquea automáticamente, previene doble submit
<Button loading={isSubmitting}>Guardar</Button>

// Navegar sin apariencia de botón — usa Link de react-router-dom
<Link to="/about" className={buttonVariants({ variant: "link" })}>Ir</Link>

// Icono en tabla
<Button variant="ghost" size="icon-sm" aria-label="Editar">
  <Pencil size={14} />
</Button>
```

---

## Badge

**Solo para estados, categorías y conteos. Máx. 3-4 variantes distintas en una tabla.**

| Variante | Uso |
|---|---|
| `success` | Activo, completado, aprobado |
| `warning` | Pendiente, en revisión |
| `danger` | Error, rechazado, vencido |
| `brand` | Nuevo, destacado |
| `outline` | Categorías, tags (sin semántica de color) |
| `default` | Neutro |

```tsx
<Badge variant="warning" withDot>Pendiente</Badge>  // withDot → punto de estado en tiempo real
<Badge variant="outline">Premium</Badge>             // sin dot, sin semántica de color
```

**Accesibilidad:** El texto debe ser suficiente sin depender del color. Mal: `<Badge variant="danger">•</Badge>`. Bien: `<Badge variant="danger" withDot>Vencido</Badge>`.

---

## Modal

**En este proyecto los modales se implementan con el componente propio del proyecto o con SweetAlert2 para confirmaciones rápidas. El patrón de `files/modal.tsx` usa Radix Dialog (no instalado) — úsalo como referencia de estructura y filosofía.**

**Cuándo usar:**
- ✅ Confirmación de acción destructiva
- ✅ Formulario rápido (<5 campos)
- ✅ Detalle ampliado de un item en tabla

**Cuándo NO usar:**
- ❌ Mensajes de éxito → SweetAlert2 toast
- ❌ Formularios largos (>5 campos) → página dedicada
- ❌ Información que el usuario necesita consultar mientras trabaja → panel lateral
- ❌ Alertas no bloqueantes → Banner o toast

**Tamaños:** `sm` (confirmaciones) | `md` (formularios medianos) | `lg` (tablas de selección) | `xl` (editores)

**Reglas de contenido:**
- El título debe ser el nombre de la acción. "Eliminar producto" es claro. "Advertencia" no.
- El botón de acción confirma con palabras: "Eliminar producto" > "Aceptar".
- Un modal hace UNA cosa. Si necesitas tabs dentro, probablemente necesitas una página.
- Orden en footer: `[Cancelar]` a la izquierda, `[Acción principal]` a la derecha.
- En móvil los botones van en columna, full-width.

```tsx
// Confirmación destructiva con SweetAlert2
import Swal from "sweetalert2"

const result = await Swal.fire({
  title: "Eliminar producto",
  text: "Esta acción no se puede deshacer.",
  icon: "warning",
  showCancelButton: true,
  confirmButtonText: "Eliminar producto",
  cancelButtonText: "Cancelar",
})
if (result.isConfirmed) handleDelete()
```

---

## Form

**Principios:**

1. **Una columna (casi siempre).** Dos columnas parecen eficientes pero aumentan errores. Los usuarios escanean en F-pattern. Excepción: campos cortos relacionados (ciudad/código postal).
2. **Label siempre visible.** Placeholder no reemplaza al label — al escribir desaparece y el usuario pierde contexto.
3. **Mensajes de error específicos.** Mal: "Email inválido". Bien: "El correo debe tener el formato usuario@dominio.com".
4. **Validar en el momento correcto.** `onBlur` al salir del campo. `onSubmit` para revisión final. NUNCA `onChange`.
5. **Siempre define `autocomplete`** — ayuda a gestores de contraseñas y usuarios con problemas motores.

**Componentes:**
- `Label` — con prop `required` para mostrar `*` semántico
- `Input` / `Textarea` — con `hasError` para estado visual de error
- `FieldGroup` — agrupa label + input + error/hint con IDs generados automáticamente
- `FormSection` — agrupa campos relacionados con fieldset semántico

```tsx
// Con react-hook-form + zod (mode: "onBlur")
<FieldGroup label="Correo electrónico" required error={errors.email?.message}
  hint="Recibirás confirmaciones en esta dirección">
  <Input {...register("email")} type="email" autoComplete="email" />
</FieldGroup>
```

---

## DataTable

**Una tabla tiene 4 estados obligatorios. Si falta uno, la UX se rompe:**
1. **Loading** → skeleton animado (no spinner centrado)
2. **Empty** → mensaje claro con acción
3. **Error** → qué salió mal + cómo recuperarse
4. **Con data** → la tabla real

**Alineación de columnas:**
- Texto → izquierda
- Números → derecha (facilita comparación vertical)
- Estado (badge/icon pequeño) → centrado
- Acciones → derecha, siempre última columna

**Densidad:** `compact` (logs, monitoreo) | `default` (gestión de entidades) | `relaxed` (contenido visual)

```tsx
<DataTable
  columns={columns}
  data={products}
  rowKey={(p) => p.id}
  loading={isLoading}
  error={error?.message}
  emptyMessage="No hay productos"
  emptyDescription="Agrega tu primer producto para empezar."
  emptyAction={<Button size="sm">Agregar producto</Button>}
  onSort={(col, dir) => { setSortCol(col); setSortDir(dir) }}
  onRowClick={(p) => navigate(`/products/${p.id}`)}
/>
```

---

## Feedback (Alert, EmptyState, Skeleton)

**Jerarquía de feedback (de menos a más intrusivo):**
1. Inline error/success — dentro del formulario
2. Toast — esquina de pantalla, desaparece solo
3. Alert/Banner — dentro de la página, persiste
4. Modal de confirmación — bloquea pantalla, requiere acción

**Alert variantes:** `info` | `success` | `warning` | `danger`

**Regla de color en feedback:** Color solo con texto, nunca solo. Un usuario daltónico debe entender el estado sin depender del color. Siempre: ícono semántico + texto descriptivo + (color de apoyo).

**EmptyState bien diseñado:**
- ✅ Explica POR QUÉ está vacío
- ✅ Ofrece la SIGUIENTE ACCIÓN obvia
- ✅ Es amigable, no técnico
- ❌ No dice solo "No hay resultados"

**Skeleton vs Spinner:**
- Skeleton → casi siempre. Muestra DÓNDE van a aparecer los datos, reduce percepción de carga.
- Spinner → solo si la operación es muy rápida (<300ms) o el contenido no tiene forma definida.

```tsx
// Alert con acción
<Alert variant="warning" title="Tu plan vence pronto" onDismiss={() => dismiss()}
  action={<Button size="sm" variant="secondary">Renovar plan</Button>}>
  Tienes 3 días restantes en tu plan Professional.
</Alert>

// Estado vacío
<EmptyState
  icon={<Package size={32} />}
  title="No tienes productos aún"
  description="Agrega tu primer producto para comenzar a gestionar tu inventario."
  action={<Button leftIcon={<Plus size={16} />}>Agregar producto</Button>}
/>

// Skeleton durante carga
{isLoading
  ? <div className="grid grid-cols-3 gap-4">{Array.from({length:6}).map((_,i) => <SkeletonCard key={i}/>)}</div>
  : <ProductGrid products={products} />}
```

---

## Arquitectura de componentes

```
components/
├── ui/          → Design system. Sin lógica de negocio. Sin fetch.
│                  Altamente configurables con props y variantes.
├── shared/      → Componentes de negocio reutilizables entre rutas.
│                  Pueden tener lógica de dominio.
└── (route)/_components/  → Privados a esa ruta. Prefijo _ los excluye del routing.
                             Pueden hacer fetch, llamar a API, tener estado local.
                             No se importan desde otras rutas.
```

**Importar desde el barrel, no directamente:**
```ts
✅ import { Button, Badge, Modal } from "@/components/ui"
❌ import { Button } from "@/components/ui/button"
```

---

## Checklist de revisión UI (antes de PR)

- [ ] ¿El usuario sabe qué hace cada botón? (texto descriptivo, no solo "OK")
- [ ] ¿Hay un máximo de 1 acción primaria por sección/vista?
- [ ] ¿Los errores dicen qué hacer, no solo qué salió mal?
- [ ] ¿El estado de carga es visible? (skeleton o spinner en el botón)
- [ ] ¿El estado vacío ofrece una acción para salir de él?
- [ ] ¿Los colores se usan con significado, no decoración?
- [ ] ¿El formulario valida onBlur, no onChange?
- [ ] ¿Los modales son de un solo propósito?
- [ ] ¿La tabla tiene los 4 estados: loading, error, empty, data?
- [ ] ¿Los iconos tienen `aria-label` o texto visible alternativo?
