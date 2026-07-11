---
name: clean-code-maintainability
description: Clean code, mantenibilidad y arquitectura de este backend LoopBack 4 + TypeScript — código sostenible (4 reglas, ETC, TDD, POLA, primitivos, complejidad accidental), regla de dependencia, naming, errores, logging sin secretos ni PII, y checklist pre-commit. Úsala al escribir o revisar código acá: nombrar cosas, elegir capa, partir una función larga, crear una frontera, revisar un PR, o si el usuario dice "refactor", "limpiar", "está feo" o "arquitectura".
---

# Clean Code & Mantenibilidad — backend-inventory

Aplica a **este** repo: LoopBack 4 + TypeScript estricto + PostgreSQL (Neon). No hay React ni Python acá; si un ejemplo te suena a otro proyecto, es que no pertenece a esta skill.

## Principio guía

> Escribí el código pensando en quien lo va a cambiar en 6 meses con la mitad del contexto que tenés ahora. Esa persona probablemente seas vos.

La forma operativa es **ETC — Easier To Change**: ante cualquier duda, ¿esto deja el sistema más fácil o más difícil de cambiar? Casi todo lo demás (DRY, desacoplamiento, responsabilidad única, refactor diario) son casos particulares. Si dos reglas chocan, gana la que deje el sistema más fácil de cambiar.

## Las 4 reglas del código sostenible

1. **Cobertura de tests.** La lógica pura con decisiones (normalizador de extracción, redondeo de peso, parseo de texto OCR, diffs de transacción, cuotas) SIEMPRE tiene test unitario. Que un módulo sea "chico" no lo exime. La disciplina es **TDD**: para lógica nueva con decisiones y para TODO fix de bug, el test se escribe ANTES — en un bug, primero el test en rojo que lo reproduce. Las capas humildes (controllers) quedan fuera del mandato: su lógica se mueve a `services/` o `modules/`, donde sí se testea.
2. **Tests de calidad.** Afirman comportamiento observable, no implementación. Prohibido asertar detalles privados o configuración literal (la lista exacta de modelos Gemini rompe con un cambio de `.env` puro; se afirma la política: "cae al siguiente modelo en un 429"). Un test que es una carga termina borrado.
3. **Abstracciones precisas.** Del tamaño del problema: ni primitivos crudos cruzando capas, ni generalidad especulativa.
4. **Intención explícita.** Cada línea tiene una razón contable. Números de dominio con constante nombrada (`DEFAULT_GEMINI_TIMEOUT_MS`, no un `8000` suelto). Comentarios que explican el **porqué**, no el qué.

### POLA — Principio del Menor Asombro

El código hace exactamente lo que su nombre promete; la sorpresa es un bug de mantenibilidad.

- Un `get*`/`find*`/`is*` NO escribe, NO muta, NO hace I/O sorpresa.
- Efecto extra inevitable → el nombre o el docstring lo declaran (`GeminiQuotaTracker.settle` documenta que REEMPLAZA la reserva estimada por el conteo oficial; `release` documenta que NO debe llamarse en un intento ya despachado).
- Un helper cuyo nombre describe solo una de sus ramas miente en las demás.

### Lenguaje del dominio y obsesión por los primitivos

El núcleo habla el idioma del negocio; los primitivos (`string`, `number`, objetos sueltos) se quedan en los bordes: HTTP, DB, proveedores externos.

- Concepto de dominio comparado contra un string literal en 2+ sitios → union type o const object (así existen `Roles` y `VisionErrorKind`).
- **La fuente única manda**: `form-spec.ts` define los campos de producto y TODO lo demás deriva vía `Record<ProductField, …>` — el schema de Gemini, el parser de texto, los prompts, el enum OpenAPI. Agregar un producto es UNA edición ahí, y TypeScript rompe en cada mapa sin extender. Si agregás una copia de esa lista a mano, estás reintroduciendo la deriva silenciosa que ese diseño existe para impedir.
- Centinelas y magia (999, -1) → constante nombrada.
- La vara es abstracción **precisa**, no máxima: si una función alcanza, no construyas una clase.

### Complejidad accidental — síntomas

- **Código "por si acaso"**: parámetros que ningún caller pasa, flags que bifurcan una función en dos, config de features inexistentes. Se borra; git lo recuerda.
- **Solución enrevesada**: implementar la primera idea en vez de la más simple. Antes de escribir: ¿hay un camino más corto que resuelva exactamente esto?
- **Sobre-generalización**: nombres marcianos sin semántica de dominio (`Manager`, `Processor`, `Data`).
- **Indirección sin motivo**: una factory de una línea que solo reenvía al constructor es ruido.
- **Edición-escopeta**: cambiar UN concepto exige tocar N archivos → falta una abstracción.
- **Anti-megalomanía**: proyecto de un usuario. Antes de agregar amplitud (otro proveedor, otra capa, otro patrón enterprise), preguntá si el problema real lo pide HOY. Profundidad por restricciones reales (los fallbacks de visión existen porque las cuotas gratis se agotan de verdad) sí; amplitud especulativa no.

### Refactor diario, dos sombreros

Mejoras de minutos (rename, extract method, inline) cada vez que tocás un archivo — nunca el "gran refactor" anual. Condición innegociable: suite en verde antes y después.

**Dos sombreros — nunca a la vez**: refactorizar y agregar funcionalidad son actividades distintas; un mismo cambio hace una u otra. Si en medio de una feature aparece un refactor necesario, se hace como paso propio, con la suite en verde entre medio. Un diff que mezcla renombres con lógica nueva es imposible de revisar.

## Arquitectura — regla de dependencia

Las dependencias apuntan hacia adentro, hacia las reglas de negocio.

- **`controllers/` son humildes**: parsean HTTP, delegan, serializan. Sin reglas de negocio.
- **`services/` y `modules/` son la política**: no conocen HTTP. Lanzan `DomainError` (ver `src/errors`), nunca `HttpErrors`; el interceptor global los mapea a status. Un service que importa `@loopback/rest` es un olor.
- **`repositories/` y `datasources/` son detalles**: acceso a datos, nada más.
- **Fronteras por interfaz**: `FormVisionProvider` es el gateway canónico — el módulo define el contrato y `VisionErrorKind`, y Gemini/Groq/Ollama/OCR-Space lo implementan afuera. La clasificación del error vive DEBAJO de la costura: el orquestador hace `switch (error.kind)` sin conocer el vocabulario de ningún proveedor. Una interfaz se justifica con implementaciones reales o una necesidad real de testeo (acá: 4 proveedores + fakes ✓); una interfaz de implementación única "por si acaso" es ruido.

**Invariante crítico del dominio**: toda mutación de detalles de compra/pago actualiza atómicamente el balance del producto e inserta un Kardex, dentro de una transacción DB. Eso vive en `TransactionService` + `StockReconciliationService`, nunca en un controller.

**Duplicación deliberada**: el par write-model / `*WithTotal` (vista de solo lectura) duplica columnas a propósito y cada archivo lo documenta. No los unifiques: evolucionan por razones distintas (tabla escribible vs vista calculada). La regla general es la misma — **si dos cosas se parecen pero cambian por motivos distintos, no las unifiques**.

## Reglas de código

**TypeScript**: `any` prohibido — usá `unknown` + type guard (`sanitizeRawExtraction` es el ejemplo: la respuesta del modelo entra como `unknown` y sale tipada o nula). `@ts-expect-error` solo con comentario que explique por qué. Boundaries (payloads externos, respuestas de proveedores) siempre tipados explícitos.

**Naming**: identificadores en **inglés**; mensajes al usuario final en **español** (así está el repo, mantenelo). Funciones = verbos (`extractForm`, `reserve`); predicados = booleanos con prefijo (`isRetryable`, `consumedRemoteQuota`). Sin abreviaturas crípticas, sin sufijos vagos tipo `helper`/`util`.

**Tamaño**: función > ~40 líneas o > 3 niveles de anidamiento → probablemente hace dos cosas. **Early return siempre.** Más de 3 argumentos posicionales → pasá un objeto.

**Inmutabilidad**: `const` por defecto; `let` solo con reasignación real. No mutes argumentos.

**Errores**: esperables (proveedor caído, timeout, cuota) → error de dominio tipado que la capa superior clasifica. Inesperables (bug real) → que se propaguen al interceptor. `catch (e: unknown)`, nunca `any`.

**Logging**: `console.info/warn/error` con el módulo entre corchetes (`[purchase-extract]`). **Nunca** loguees secretos (`GEMINI_API_KEY`, `JWT_SECRET`, credenciales de DB) ni PII: el controller de extracción omite deliberadamente el nombre del proveedor y registra solo el id resuelto y la calidad del match. Un log útil es el que te deja tunear con tráfico real (modelo, duración, tokens oficiales, motivo del fallback).

**Reutilización**: rule of three. La primera vez lo escribís, la segunda lo duplicás, la tercera (cuando la duplicación dolió) abstraés. Una abstracción mala cuesta más que duplicar.

## Antes de commitear

- [ ] `npm run build` compila
- [ ] `npm run lint` pasa (eslint + prettier)
- [ ] Tests del área en verde (`npx lb-mocha --allow-console-logs "dist/__tests__/unit/<archivo>.js"` para iterar rápido; la suite completa tarda ~4-5 min porque la DB es remota)
- [ ] Sin `any`, sin `console.log` olvidados, sin TODO sin contexto
- [ ] Secretos solo en `.env`; nada de credenciales ni PII en logs
- [ ] Una idea por commit; commits convencionales (`feat(...)`, `fix(...)`, `refactor(...)`)

## Cómo decidir entre alternativas

En orden: ¿cuál es más fácil de **leer** sin contexto? ¿más fácil de **borrar** si mañana sobra? ¿tiene **menos acoplamiento**? ¿es más fácil de **testear**? ¿es más **simple**? Si una opción gana 3 de 5, esa.

## La pregunta antes de mergear

> Si mañana entra alguien nuevo, ¿puede leer esto y entender qué hace y por qué, sin preguntarle a nadie?

Si la respuesta es no, faltó claridad: rename, comentario del porqué, o separación.
