# Plan de validación — Escaneo de compras con Gemini (J.A.A.G)

> Prompt listo para entregar a un equipo de QA/backend/frontend o a un LLM.
> A diferencia de un plan genérico de "lectura de recibos", este documento describe
> el sistema **tal como está implementado** y qué falta por validar.
>
> **Estado (2026-07-01): plan ejecutado.** B13–B20 y F1–F12 cubiertos con tests en
> verde; recomendaciones §9 implementadas (validación de tipos post-parse, abort en
> timeout de UI, celda de proveedor vacía sin match). Queda abierta solo la decisión
> de producto sobre fechas futuras (B18 / Anexo §3) — el comportamiento actual está
> documentado con un unit test.

---

## Prompt principal

Actúa como QA Engineer Senior con experiencia en flujos de extracción estructurada
desde imágenes con LLMs. Tu tarea es **validar el sistema existente** (no diseñarlo
desde cero). El sistema ya está implementado y parcialmente probado; abajo está su
comportamiento real, el contrato de datos, los casos ya cubiertos y los huecos a cubrir.

### Contexto real del sistema

Es un **extractor de formulario fijo**, no un lector genérico de recibos. El
formulario es la papelería preimpresa de J.A.A.G (el negocio dueño del sistema) con
campos manuscritos. El membrete "J.A.A.G" y el teléfono impreso **no son datos a
extraer**: el proveedor real es quien aparece en **"Recibí del Sr."**.

Campos extraídos (schema fijo, JSON mode de Gemini — no hay `items[]` libres):

| Campo del formulario | Campo extraído | Tipo |
|---|---|---|
| Fecha: | `fecha` | string \| null (como aparece escrito) |
| LIBRAS | `librasTotal` | number \| null (total de cruce, NO es un producto) |
| PIELES | `pieles` | number \| null (libras) |
| Libra de Sebo | `sebo` | number \| null (libras; alias "Cebo") |
| Hueso | `hueso` | number \| null (libras) |
| Recibí del Sr. | `recibiDelSr` | string \| null (**este es el proveedor**) |
| Firma | — | se ignora deliberadamente |

Cada campo llega con una confianza 0–1 en `fieldConfidences`.

### 1. Flujo end-to-end real

1. **Frontend** (`my-inventory/src/pages/purchase/scan/ScanPurchase.tsx`, paso `upload`):
   el usuario toma/sube foto (`accept="image/*" capture="environment"`). Se genera
   preview local y se sugiere un **recorte automático** (detección de papel + tinta
   azul en `scanImagePreprocessor`), editable con sliders por lado.
2. Al presionar "Procesar": el cliente **optimiza la imagen** (recorte + reescalado +
   compresión) y envía `POST /purchases/extract` como `multipart/form-data`, campo
   `image`, más metadatos de telemetría (`optimizedSizeBytes`, `optimizedWidth`,
   `optimizedHeight`, `cropX/Y/Width/Height`). Timeout axios: **25 s**; timeout de UI:
   **28 s**; el spinner se muestra mínimo 700 ms.
3. **Backend** (`purchase-extract.controller.ts`): exige JWT válido con rol
   **OFFICE o ADMIN**. Multer parsea en memoria (máx **15 MB**, solo `image/*`).
   La imagen **nunca se persiste** (decisión de producto, prometida en la UI).
4. Se cargan los catálogos `person` y `product` (solo id + name) de la BD.
5. **Provider chain** (`src/modules/form-extraction/form-extraction.provider.ts`):
   Gemini es el proveedor principal para este flujo; los datos del formulario no
   requieren el modo de privacidad estricta de la tesis. La configuración
   recomendada es `FORM_VISION_PROVIDER=chain` con
   `FORM_VISION_PROVIDER_CHAIN=gemini,ollama,groq,ocrspace`. Si Gemini falla por
   cuota, timeout o respuesta no utilizable, el adaptador prueba el siguiente
   proveedor configurado.
6. **Provider Gemini** (`src/modules/form-extraction/gemini/gemini-transport.ts` + `src/modules/form-extraction/form-extraction.provider.ts`):
   una llamada `generateContent` con `system_instruction` + `responseSchema`
   estructurado. Cadena de fallback de modelos (por defecto: `gemini-3.5-flash` →
   `gemini-3.1-flash-lite` → `gemini-3-flash-preview` → `gemini-2.5-flash-lite` →
   `gemini-2.5-flash`). Timeout por modelo **8 s**, deadline total **26 s**. Guarda
   local de cuota por modelo (RPM/TPM) antes de cada intento.
7. **Normalizador puro** (`src/modules/form-extraction/form-extraction.normalizer.ts`, sin I/O — unit-testeable):
   - Fecha: `DD/MM/YYYY` o `DD/MM/YY` con separadores `/`, `-`, `.` → ISO
     (`2026-12-01`), confianza 0.95. Ilegible/inválida → `null` + `needsReview`.
   - Proveedor: `recibiDelSr` contra tabla `person`. Normalización: minúsculas, sin
     acentos, sin puntuación, espacios colapsados. Score = similitud Levenshtein
     (1 − dist/maxLen) + bonus 0.1 por contención. **Umbral 0.75**: score ≥ 0.75 →
     `personId` asignado; < 0.75 → `personId: undefined`, `needsReview: true` y
     **top-3 `candidates`** con score (esto ya existe, no hay que diseñarlo).
   - Productos: cada campo (`pieles`/`sebo`/`hueso`) se mapea al catálogo por
     **aliases fijos** (p. ej. `sebo`: sebo, cebo, tallow, grasa) con matching por
     contención. Sin match → `productId: undefined` + razón de revisión.
   - Conversión: `weightKg = weightLb × 0.45359237`, redondeado a 3 decimales.
   - Confianza por campo < **0.7** → `needsReview` en ese detalle.
   - **Check de totales**: `|librasTotal − Σ detalles| ≤ 5%` de la suma; si falla,
     razón "Total de libras no coincide". Ausencia de total NO falla el check.
8. **Respuesta del backend**: el `ExtractionResult` (contrato abajo). No se guarda
   nada en BD en este paso; es un **prefill**.
9. **Frontend** (paso `review`): badges "Valores detectados / Requiere revisión",
   razones de revisión, alerta "Proveedor por confirmar" con **chips del top-3** que
   aplican el proveedor a todas las filas, fecha editable (si no se detectó, se
   precarga hoy/Bogotá), tabla de detalles editable (producto, proveedor, peso kg).
10. **Confirmación**: al guardar se valida que cada fila tenga `productId > 0`,
   `personId > 0` y `weight_kg > 0`; luego `POST /purchases/with-details` (el flujo
   transaccional normal: actualiza balance + Kardex atómicamente) y navega a
   `/compras`.

### 2. Contrato JSON de Gemini (ya implementado — NO proponer otro)

El prompt a Gemini vive en código (`SYSTEM_PROMPT` + `FIELD_EXTRACTION_SCHEMA` en
`src/modules/form-extraction/gemini/gemini-transport.ts`) y se fuerza con `responseMimeType: application/json` +
`responseSchema`. Estructura que devuelve el modelo:

```json
{
  "fecha": "1/12/2026",
  "librasTotal": 50,
  "pieles": 20,
  "sebo": 50,
  "hueso": 70,
  "recibiDelSr": "Juan Jose",
  "fieldConfidences": {
    "fecha": 0.95, "librasTotal": 0.9, "pieles": 0.92,
    "sebo": 0.88, "hueso": 0.87, "recibiDelSr": 0.9
  }
}
```

Cualquier ajuste al prompt de Gemini se hace en
`src/modules/form-extraction/gemini/gemini-transport.ts` (con su unit test), no en
tiempo de ejecución.

### 3. Contrato de respuesta del backend (`ExtractionResult`)

```ts
{
  date:        { value: string | null, confidence: number, needsReview: boolean },
  librasTotal: { value: number | null, confidence: number },
  supplier: {
    rawName: string | null,
    personId?: number,            // solo si score >= 0.75
    confidence: number,
    needsReview: boolean,
    candidates: [{ id, name, score }]   // top 3, siempre presente
  },
  details: [{
    fieldName: 'pieles' | 'sebo' | 'hueso',
    productId?: number,           // undefined si no hay match en catálogo
    productName: string,
    weightLb: number,
    weightKg: number,             // lb × 0.45359237, 3 decimales
    confidence: number,
    needsReview: boolean          // confianza < 0.7
  }],
  totalWeightCheck: { passed: boolean, formTotalLb: number | null, sumLb: number },
  needsReview: boolean,           // true si hay CUALQUIER razón
  reviewReasons: string[]
}
```

No existen (ni deben inventarse en los tests): `matched_supplier`,
`supplier_suggestions_top_3`, `image_id`, `llm_raw_response_id`, `raw_text`,
`confidence_level`. Sus equivalentes reales son `supplier.personId`,
`supplier.candidates`, `needsReview` y `reviewReasons`.

### 4. Reglas de matching (valores exactos del código)

| Regla | Valor | Constante |
|---|---|---|
| Match directo de proveedor | score ≥ 0.75 | `SUPPLIER_MATCH_THRESHOLD` |
| Sugerencias (top 3) | siempre en `candidates`; sin `personId` si score < 0.75 | — |
| Revisión por campo | confianza < 0.7 | `FIELD_CONFIDENCE_THRESHOLD` |
| Tolerancia del total | 5 % de la suma | `TOTAL_TOLERANCE` |
| Conversión lb→kg | 0.45359237 | `LB_TO_KG` |
| Normalización de nombres | minúsculas, sin tildes, sin puntuación | `normalizeForMatch` |

**Fuera de alcance hoy** (requieren decisión de producto, no son bugs):
- Matching por teléfono: la tabla `person` solo tiene `id` y `name`.
- Persistir imagen original / respuesta cruda del LLM: contradice la promesa de la
  UI ("La imagen no se almacena") y el diseño en memoria. Ya existe telemetría
  estructurada en logs **sin PII** (se omite el nombre del proveedor).

### 5. Casos de prueba backend

✅ = ya cubierto (`src/__tests__/`) · 🔲 = falta (prioridad A/B)

| # | Caso | Estado |
|---|---|---|
| B1 | Imagen válida → extracción normalizada completa (provider inyectado) | ✅ acceptance |
| B2 | JPEG optimizado del cliente aceptado | ✅ acceptance |
| B3 | Sin valores detectados → 200 con `needsReview`, no error | ✅ acceptance |
| B4 | Request sin campo `image` → 400 | ✅ acceptance |
| B5 | Archivo no-imagen → 400 | ✅ acceptance |
| B6 | Rate limit del endpoint → 429 antes de llamar a Gemini | ✅ acceptance |
| B7 | Fallback de modelo por cuota de Gemini | ✅ unit provider |
| B8 | Fallback de modelo por timeout | ✅ unit provider |
| B9 | Fechas: DD/MM/YYYY, YY, separadores, fuera de rango, vacía | ✅ unit normalizer |
| B10 | Proveedor: exacto sin tildes, confiable, dudoso, vacío | ✅ unit normalizer |
| B11 | Producto: mapeo por campo, alias "Cebo", sin match | ✅ unit normalizer |
| B12 | Total: dentro/fuera de tolerancia, ausente | ✅ unit normalizer |
| B13 | Imagen > 15 MB → 400 vía multer | ✅ acceptance |
| B14 | Gemini devuelve JSON malformado / con fences ``` → 422 (fallback de `parseExtractionJson`) | ✅ unit provider + acceptance |
| B15 | Timeout agotado en toda la cadena → **408** end-to-end (acceptance) | ✅ acceptance |
| B16 | Cuota agotada en toda la cadena → **429** end-to-end (acceptance) | ✅ acceptance |
| B17 | `fieldConfidences` ausente en la respuesta → default 0.5 y revisión | ✅ unit normalizer + unit transport |
| B18 | Fecha futura (p. ej. "1/12/2026" hoy 07/2026): hoy pasa con confianza 0.95 — decidir si debe marcar revisión | ✅ unit documenta el comportamiento ACTUAL; el cambio sigue pendiente de decisión de producto (Anexo §3) |
| B19 | Sin JWT → 401; rol `operator` → 403 | ✅ 401 en acceptance de extract; 403 ya vivía en `auth-roles.acceptance.ts` |
| B20 | BD sin personas / sin productos → `candidates: []`, `productId` undefined, razones de revisión | ✅ unit normalizer (catálogos vacíos; la BD compartida no se puede vaciar en acceptance) |

### 6. Casos de prueba frontend (cubiertos: `ScanPurchase.test.tsx`)

Todos implementados en
`my-inventory/src/pages/purchase/scan/__tests__/ScanPurchase.test.tsx`
(Vitest + Testing Library, timers falsos para spinner mínimo y timeout de UI;
servicios y `DocumentDetailsTable` mockeados). El servicio suma un test de
passthrough del `AbortSignal`.

| # | Caso | Estado |
|---|---|---|
| F1 | Selección de archivo → preview + sugerencia de recorte | ✅ |
| F2 | "Procesar" → paso `processing` con spinner; respuesta OK → paso `review` | ✅ |
| F3 | Respuesta con `supplier.needsReview` → alerta "Proveedor por confirmar" con chips top-3; clic en chip aplica proveedor a TODAS las filas | ✅ (verifica además que la celda inicia vacía, ver §9) |
| F4 | Respuesta sin detalles → alerta "sin valores", no se puede guardar | ✅ |
| F5 | Guardar con fila incompleta (producto/proveedor/peso ≤ 0) → toast de error, no llama al API | ✅ |
| F6 | Guardar válido → `POST purchases/with-details` con `{date, purchase_details}` y navegación a `/compras` | ✅ |
| F7 | Error del API (408/422/429/500) → vuelve a `upload` con alerta y mensaje del backend | ✅ |
| F8 | Timeout de UI (28 s) → alerta "no terminó a tiempo", vuelve a `upload` | ✅ (verifica además el abort de la request) |
| F9 | `reviewReasons` visibles en la alerta de revisión (filtrando la de "sin valores") | ✅ |
| F10 | Fecha no detectada → input precargado con hoy (Bogotá) y razón de revisión visible | ✅ |
| F11 | "Escanear otra" / "Ajustar imagen" limpian estado y revocan object URLs | ✅ |
| F12 | Editar recorte: sliders actualizan overlay; "Quitar recorte" lo resetea | ✅ |

### 7. Criterios de aceptación (Given / When / Then)

**Match directo de proveedor**
- Given la BD tiene la persona "Juan José" y la foto dice "Recibí del Sr.: Juan Jose"
- When se procesa la imagen
- Then `supplier.personId` es el id de "Juan José", `confidence = 1` (las tildes no
  penalizan), `needsReview = false` y las filas del review llegan con ese proveedor.

**Sugerencias sin match directo**
- Given la BD tiene "Juan José Gómez", "Juan Pérez" y "José Juárez", y la foto dice
  "Juan Jose"
- When se procesa la imagen
- Then ningún score alcanza 0.75, `personId` es undefined, `candidates` trae los 3
  ordenados por score, y el frontend muestra los chips; al hacer clic en uno, todas
  las filas quedan con ese proveedor.

**Check de totales (caso base de la imagen de ejemplo)**
- Given la foto dice LIBRAS=50, PIELES=20, Sebo=50, Hueso=70
- When se procesa la imagen
- Then la suma es 140, `totalWeightCheck.passed = false`, `needsReview = true` y
  `reviewReasons` incluye "Total de libras no coincide: formulario=50, suma=140.00".
  (Ojo: el plan original trataba este caso como éxito con 4 productos — es
  incorrecto; LIBRAS no es un producto.)

**Campo ilegible**
- Given Gemini devuelve `hueso: 70` con confianza 0.4
- When se normaliza
- Then el detalle de hueso trae `needsReview = true` y `reviewReasons` incluye
  "Campo Hueso con baja confianza"; el frontend lo lista en la alerta de revisión.

**Fallo del servicio de visión**
- Given todos los modelos de la cadena fallan por timeout dentro del deadline de 26 s
- When se procesa la imagen
- Then el backend responde **408** con mensaje en español para el usuario, y el
  frontend vuelve al paso `upload` mostrando ese mensaje (no un spinner infinito).

**Guardado final**
- Given el usuario confirmó proveedor, productos y pesos en el review
- When presiona "Guardar compra"
- Then se crea la compra vía `purchases/with-details` (balance + Kardex atómicos),
  se muestra "Compra creada exitosamente" y se navega a `/compras`. La imagen nunca
  se persistió.

### 8. Payloads de ejemplo

**Request**

```bash
curl -X POST "$API/purchases/extract" \
  -H "Authorization: Bearer $JWT" \
  -F "image=@formulario.jpg" \
  -F "optimizedSizeBytes=412303" -F "optimizedWidth=1280" -F "optimizedHeight=960" \
  -F "cropX=40" -F "cropY=12" -F "cropWidth=1200" -F "cropHeight=900"
```

**200 — match directo, sin revisión** (LIBRAS=140 coincide; "Juan José" existe):

```json
{
  "date": { "value": "2026-12-01", "confidence": 0.95, "needsReview": false },
  "librasTotal": { "value": 140, "confidence": 0.9 },
  "supplier": {
    "rawName": "Juan Jose", "personId": 12, "confidence": 1, "needsReview": false,
    "candidates": [
      { "id": 12, "name": "Juan José", "score": 1 },
      { "id": 7, "name": "Juan Pérez", "score": 0.55 },
      { "id": 21, "name": "José Juárez", "score": 0.42 }
    ]
  },
  "details": [
    { "fieldName": "pieles", "productId": 3, "productName": "Pieles", "weightLb": 20, "weightKg": 9.072,  "confidence": 0.92, "needsReview": false },
    { "fieldName": "sebo",   "productId": 4, "productName": "Sebo",   "weightLb": 50, "weightKg": 22.68,  "confidence": 0.88, "needsReview": false },
    { "fieldName": "hueso",  "productId": 5, "productName": "Hueso",  "weightLb": 70, "weightKg": 31.751, "confidence": 0.87, "needsReview": false }
  ],
  "totalWeightCheck": { "passed": true, "formTotalLb": 140, "sumLb": 140 },
  "needsReview": false,
  "reviewReasons": []
}
```

**200 — sugerencias + revisión** (caso base: LIBRAS=50 no cuadra y el proveedor es dudoso):

```json
{
  "date": { "value": "2026-12-01", "confidence": 0.95, "needsReview": false },
  "librasTotal": { "value": 50, "confidence": 0.9 },
  "supplier": {
    "rawName": "Juan Jose", "confidence": 0.7, "needsReview": true,
    "candidates": [
      { "id": 12, "name": "Juan José Gómez", "score": 0.7 },
      { "id": 7,  "name": "Juan Pérez",      "score": 0.5 },
      { "id": 21, "name": "José Juárez",     "score": 0.41 }
    ]
  },
  "details": [
    { "fieldName": "pieles", "productId": 3, "productName": "Pieles", "weightLb": 20, "weightKg": 9.072,  "confidence": 0.92, "needsReview": false },
    { "fieldName": "sebo",   "productId": 4, "productName": "Sebo",   "weightLb": 50, "weightKg": 22.68,  "confidence": 0.88, "needsReview": false },
    { "fieldName": "hueso",  "productId": 5, "productName": "Hueso",  "weightLb": 70, "weightKg": 31.751, "confidence": 0.87, "needsReview": false }
  ],
  "totalWeightCheck": { "passed": false, "formTotalLb": 50, "sumLb": 140 },
  "needsReview": true,
  "reviewReasons": [
    "Proveedor no identificado con confianza",
    "Total de libras no coincide: formulario=50, suma=140.00"
  ]
}
```

**200 — imagen procesada sin valores** (no es error):

```json
{
  "date": { "value": null, "confidence": 0, "needsReview": true },
  "librasTotal": { "value": null, "confidence": 0 },
  "supplier": { "rawName": null, "confidence": 0, "needsReview": true, "candidates": [] },
  "details": [],
  "totalWeightCheck": { "passed": true, "formTotalLb": null, "sumLb": 0 },
  "needsReview": true,
  "reviewReasons": [
    "Fecha no reconocida o ilegible",
    "Proveedor no identificado con confianza",
    "No se detectaron valores de productos"
  ]
}
```

**Errores** (formato LoopBack `{ "error": { statusCode, name, message } }`):

| HTTP | Cuándo | Mensaje (es) |
|---|---|---|
| 400 | Sin campo `image`, archivo no-imagen, > 15 MB | "No se adjuntó ninguna imagen (campo: image)" / error multer |
| 401 | Sin JWT o inválido | — |
| 403 | Rol sin permiso (operator) | — |
| 408 | Deadline total de la cadena Gemini agotado | "El servicio de lectura del formulario tardó demasiado…" |
| 422 | JSON de Gemini inválido o API key/modelo mal configurados | "…no devolvió un JSON de extracción válido…" / "…no está configurado correctamente…" |
| 429 | Rate limit del endpoint (50/min, 618/día por IP) o cuota Gemini agotada | "…está ocupado temporalmente…" |

### 9. Recomendaciones técnicas (alineadas al diseño actual)

- **Prompt de Gemini**: ya usa `system_instruction` + `responseSchema` (JSON mode) —
  mantener; cualquier tuning va acompañado de su unit test en
  `form-extraction.provider.unit.ts`.
- **Validación del JSON**: ✅ hecho — `sanitizeRawExtraction` en
  `src/modules/form-extraction/gemini/gemini-transport.ts` valida/coacciona tipos post-parse (strings numéricos con
  coma decimal se convierten, tipos basura se anulan, confianzas se recortan a
  [0,1]); unit tests en `gemini-transport.unit.ts` (B14/B17).
- **Logs**: ya hay telemetría estructurada por intento y por resultado, sin PII.
  Mantener la política de no loguear `rawName`.
- **Trazabilidad de confirmación**: la compra creada pasa por el flujo transaccional
  normal (Kardex con provenance) — la auditoría de "quién confirmó" ya existe ahí.
- **Abort real en timeout de UI**: ✅ hecho — `handleProcess` crea un
  `AbortController`, `FormExtractionService.extractFromImage` acepta `signal` y lo
  pasa a axios; al ganar el timeout se aborta la request (test F8 lo verifica) y
  el aborto no dispara un toast duplicado.
- **No precargar el nombre del top-1 sin match**: ✅ hecho — sin `personId`,
  `buildDetails` deja la celda de proveedor vacía para forzar la selección
  consciente (test F3 lo verifica).
- **Fecha**: decidir si una fecha futura debe marcar revisión (hoy no lo hace) y si
  precargar "hoy" cuando no se detectó fecha invita a no revisar.

### 10. Riesgos y mitigaciones

| Riesgo | Mitigación existente | Pendiente |
|---|---|---|
| Alucinación del LLM | Schema fijo + "no inventes valores" + confianzas por campo + umbral 0.7 + validación de tipos post-parse (`sanitizeRawExtraction`) | — |
| Proveedor mal asignado | Umbral 0.75 + top-3 + confirmación humana obligatoria + celda vacía sin match | — |
| Costo/cuota Gemini | Rate limit endpoint + guarda local RPM/TPM + cadena de fallback + abort en timeout de UI | — |
| Latencia | Timeouts escalonados 8 s/modelo, 26 s total, 25 s axios, 28 s UI | — |
| Datos erróneos guardados | Validación por fila al guardar + flujo transaccional con Kardex + tests F5/F6 | — |
| Ambigüedad DD/MM vs MM/DD | Se asume DD/MM (formato colombiano) documentado en el prompt del modelo | Marcar revisión si día ≤ 12 y mes ≤ 12 (opcional) |
| PII en logs | Nombre del proveedor omitido de los logs | — |

---

## Anexo — Mejoras futuras que requieren decisión de producto (NO son bugs)

1. **Teléfono del proveedor**: agregar columna a `person` + migración; solo entonces
   tiene sentido el matching por teléfono.
2. **Persistencia de imagen + respuesta cruda para auditoría**: contradice la promesa
   actual de la UI; si se adopta, definir retención, cifrado y actualizar el texto.
3. **Validación de fecha futura / muy antigua** en `parseDate`.
4. **Umbral configurable** por env para `SUPPLIER_MATCH_THRESHOLD` si el catálogo
   crece y 0.75 queda corto o largo.
