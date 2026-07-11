# MRL — Maintainability Review Loop

Skill para entrenar el ojo en deuda técnica, code smells y oportunidades de refactor antes de que el código se vuelva una jungla hostil. Inspirada en *The Pragmatic Programmer*, Carlos Ble y refactoring de Martin Fowler. **No es dogmática:** busca código fácil de cambiar.

> Mantra: **Read → Smell → Refactor small → Test → Commit cleaner than before.**
> Boy scout rule: deja el código un poco mejor de como lo encontraste.

---

## El loop — 5 pasadas, ordenadas de lo local a lo sistémico

### 1. Intent Pass — "¿Se entiende qué hace?"

**Preguntas:**
- ¿Los nombres expresan intención (qué hace y por qué), no mecánica (cómo)?
- ¿Necesito leer la implementación para entender el uso?
- ¿La estructura cuenta una historia lógica?

**Red flags:**
- `data`, `manager`, `utils`, `process`, `handleStuff`, `info`
- Comentarios que explican código obvio (compensan nombres pobres)
- Nombres inconsistentes para el mismo concepto (`user` vs `customer` vs `client`)
- Nombres que **parecen** descriptivos pero esconden efectos: `saveX` que también dispara analytics

**Mejoras:** rename, extraer concepto de dominio, partir en funciones nombradas por intención.

**Ejemplo realista (no caricaturesco):**

```ts
// ❌ El nombre parece bien hasta que descubres todo lo que hace
async function saveProduct(product: Product) {
  await api.put(`/products/${product.id}`, product)
  analytics.track("product_edited", { id: product.id })
  invalidateCache(product.id)
  notifyWatchers(product)
}

// ✅ Opción A — el nombre revela el alcance
async function saveProductAndPropagateChange(product: Product) { ... }

// ✅ Opción B (mejor) — partir y dejar que el caller orqueste
async function persistProduct(product: Product) { ... }
function trackProductEdit(product: Product) { ... }
function refreshProductCache(productId: string) { ... }
```

**Regla pragmática:** *si necesitas leer la implementación para entender el uso, el nombre falló.*

---

### 2. Complexity Pass — "¿Cuánto cuesta modificar esto?"

**Busca:**
- `if` anidados (>2 niveles)
- `switch` gigantes
- Funciones largas (>30–40 líneas, ojo en JSX)
- Boolean flags múltiples en la misma firma (`isEdit`, `isReadonly`, `showFooter` → señal de que faltan componentes)

**Smells:** Long Method · Conditional Complexity · Arrow Code · Flag Argument.

**Soluciones:** guard clauses · early return · extract method · strategy/lookup table.

```ts
// ❌
function process(user) {
  if (user) {
    if (user.active) {
      if (user.hasPermission) {
        // ...lógica real
      }
    }
  }
}

// ✅ Guard clauses
function process(user: User | null) {
  if (!user) return
  if (!user.active) return
  if (!user.hasPermission) return
  // lógica real, sin nesting
}
```

```ts
// ❌ Switch gigante por tipo
switch (status) {
  case "low_stock": return <Badge variant="warning">Bajo</Badge>
  case "ok":        return <Badge variant="success">OK</Badge>
  case "out":       return <Badge variant="danger">Agotado</Badge>
}

// ✅ Lookup table (datos, no control de flujo)
const STOCK_BADGE: Record<StockStatus, BadgeProps> = {
  low_stock: { variant: "warning", label: "Bajo" },
  ok:        { variant: "success", label: "OK" },
  out:       { variant: "danger",  label: "Agotado" },
}
return <Badge {...STOCK_BADGE[status]} />
```

---

### 3. Coupling Pass — "¿Qué se rompe si cambio esto?"

La pasada más difícil. Pregunta clave: **si cambio esta línea, ¿cuántos archivos tengo que tocar?**

**Smells:** Shotgun Surgery · God Object · Feature Envy · cadenas de dependencias frágiles.

```
OrderService → UserRepo → EmailService → PaymentGateway → Logger
```

Si todo depende de todo, cualquier cambio en `Logger` puede romper `OrderService`.

**Cómo romperlo (no solo identificarlo):**

```ts
// ❌ Antes — OrderService conoce 4 colaboradores
class OrderService {
  constructor(
    private users: UserRepo,
    private email: EmailService,
    private payments: PaymentGateway,
    private logger: Logger,
  ) {}

  async place(order: Order) {
    const user = await this.users.find(order.userId)
    const charge = await this.payments.charge(user, order.total)
    await this.email.send(user.email, "receipt", { order, charge })
    this.logger.info("order.placed", { orderId: order.id })
    return charge
  }
}

// ✅ Después — eventos / pub-sub
class OrderService {
  constructor(
    private payments: PaymentGateway,
    private events: EventBus,
  ) {}

  async place(order: Order) {
    const charge = await this.payments.charge(order.userId, order.total)
    this.events.emit("OrderPlaced", { order, charge })
    return charge
  }
}
// EmailService, Logger y cualquier futuro suscriptor se enganchan al evento.
// OrderService no sabe que existen → bajo acoplamiento, alta cohesión.
```

**Variantes según el contexto:**
- En frontend React: estado compartido en una store dedicada (Zustand) en lugar de prop drilling cruzado.
- En componentes: composición (`<Modal.Footer>{children}</Modal.Footer>`) en vez de props que controlan internos.
- En servicios: dependency injection o inyección por parámetro, no `import` directo en el cuerpo.

**Meta:** alta cohesión, bajo acoplamiento. Que cada módulo sepa lo mínimo del resto.

---

### 4. Duplication Pass — "¿Estoy copiando conocimiento?"

No solo líneas. También duplicas:
- Reglas de negocio (validaciones repetidas en 3 forms)
- Estructuras condicionales (los mismos 4 `if` en 5 archivos)
- Conocimiento implícito (todos saben que `status === "X"` significa `Y`, pero está hardcoded)

**Smells:** Duplicate Code · Parallel Change (cambiar X obliga a tocar Y e Z también).

**Soluciones:** extract function · shared policy · constante con `as const` · hook reusable.

**Regla de Carlos Ble — diseño sostenible:**

> Duplica un poco antes de abstraer demasiado pronto.

No abstraigas tras la primera repetición. Espera al **patrón estable** (regla del 3: 3 ocurrencias casi idénticas → toca extraer). Una abstracción incorrecta es peor que duplicación: te ata a una forma equivocada y se vuelve costoso desandar.

---

### 5. Changeability Pass — "¿Qué tan barato es evolucionarlo?"

La pregunta del Pragmatic Programmer: ***How easy is it to change?***

Esta pasada cubre dos dimensiones distintas — revísalas por separado:

**5a. Evolucionabilidad — ¿puedo agregar/cambiar sin romper otras cosas?**
- ¿Hay boundaries claros (módulos, capas, interfaces)?
- ¿Los side effects están encapsulados o salpicados?
- ¿Hay dependencias globales escondidas (singletons, mutables compartidos)?

**5b. Testabilidad — ¿hay protección contra regresión?**
- ¿Existen tests que cubran el comportamiento clave?
- ¿Las dependencias son inyectables o `import`-ed hard?
- ¿Las funciones puras dominan donde es razonable, o todo tiene side effects?

Smells: código rígido · side effects ocultos · dependencias globales · funciones imposibles de testear sin levantar medio sistema.

---

## Cuándo NO refactorizar

Esta sección importa tanto como las pasadas. Sin ella, la skill genera ansiedad de refactor en código que no la merece.

**Acepta deuda conscientemente cuando:**
- El código es legacy estable y nadie lo va a tocar
- Va a morir pronto (deprecación planeada, MVP de validación, prototipo)
- Funciona en producción y la prioridad de negocio es entregar
- No hay tests **y** no hay tiempo de escribirlos → riesgo del refactor > beneficio
- El "refactor" es cuestión de gusto personal, no mejora medible

**Documenta la deuda aceptada** con un comentario corto y específico:

```ts
// TODO: refactor a state machine cuando agreguemos el flujo de devoluciones (PR-1234).
//       Hoy 3 booleanos bastan; el cuarto sería el quiebre.
```

Eso vale más que un refactor preventivo que rompe algo en uso.

---

## Checklist de 1 minuto (antes de merge)

- [ ] ¿Nombres claros y consistentes?
- [ ] ¿Funciones pequeñas, sin nesting innecesario?
- [ ] ¿Acoplamiento controlado (cuántos archivos rompo si cambio esto)?
- [ ] ¿Duplicación tolerable (no abstrajiste demasiado pronto)?
- [ ] ¿Tests cubren el cambio que hiciste?
- [ ] ¿El código es **más fácil de cambiar** que antes?

Si no mejoró ninguna dimensión, probablemente solo moviste barro.

---

## Tabla de priorización — cuándo invertir esfuerzo

Usa esto para decidir qué pasada atacar primero cuando el tiempo es limitado:

| Pasada         | Riesgo de tocar | Costo de no tocar              |
|----------------|-----------------|--------------------------------|
| Intent         | Muy bajo        | Alto (confusión acumulada)     |
| Complexity     | Medio           | Alto (bugs ocultos)            |
| Coupling       | Alto            | Muy alto (fragilidad sistémica)|
| Duplication    | Bajo-medio      | Medio                          |
| Changeability  | Alto            | Crítico a largo plazo          |

**Lectura práctica:** empieza por **Intent** (alto retorno, bajo riesgo). Deja **Coupling** y **Changeability** para cuando tengas cobertura de tests o ventana de refactor. **Duplication** es seguro pero no urgente.

---

## Herramientas que ayudan (no sustituyen criterio)

ESLint · TypeScript estricto · SonarQube · Code Climate · PMD · Semgrep · Pylint.

Detectan smells, no diseño. El criterio sigue siendo humano.

---

## Mantra operativo

Cuando edites código, pregúntate:

1. ¿Lo entiendo rápido?
2. ¿Lo puedo cambiar barato?
3. ¿Lo puede entender otro mañana?

Si alguna respuesta es **"no"**, ahí hay trabajo. Si las tres son **"sí"** y aun así quieres refactorizar, vuelve a la sección "Cuándo NO refactorizar".
