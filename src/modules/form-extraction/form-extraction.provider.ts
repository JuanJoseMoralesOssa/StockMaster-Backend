// Vision-provider seam for reading a J.A.A.G form photo into raw fields.
// The provider only does OCR/vision -> RawExtractionFields; all domain logic
// (matching, lb->kg, totals) lives in form-extraction.normalizer.ts.
//
// Swap providers via the FORM_VISION_PROVIDER env var. Gemini is the default.
//
// The Gemini default is composed of three single-purpose collaborators:
//   - GeminiTransport       — one HTTP call to one model (gemini-transport.ts)
//   - GeminiQuotaTracker    — per-model local rate guard (gemini-quota-tracker.ts)
//   - GeminiFormVisionProvider (this file) — the fallback-chain orchestrator
// Both collaborators are injected with sensible defaults, so the provider is
// trivially constructable (new GeminiFormVisionProvider()) yet swappable in
// tests, and quota state is instance-scoped rather than a module global.

import { RawExtractionFields } from './form-extraction.normalizer'
import { GeminiQuotaTracker } from './gemini/gemini-quota-tracker'
import {
  ClientAbortedError,
  consumedRemoteQuota,
  estimateGeminiRequestTokens,
  GeminiTransport,
  RetryableGeminiError,
} from './gemini/gemini-transport'

/**
 * Failure category a provider exposes to the (provider-agnostic) orchestrator.
 * Keeping this a small typed enum is the whole point of the seam: the
 * FormExtractionService maps `kind` → HTTP status without knowing ANY provider's
 * error vocabulary, so a second provider does not have to reword Gemini's
 * strings to be classified correctly (audit Finding M2).
 */
export type VisionErrorKind =
  | 'timeout'
  | 'rate_limited'
  | 'unprocessable'
  | 'client_aborted'

/** Typed failure thrown by a FormVisionProvider; carries an end-user message. */
export class VisionProviderError extends Error {
  constructor(
    readonly kind: VisionErrorKind,
    message: string,
  ) {
    super(message)
    this.name = 'VisionProviderError'
  }
}

export interface FormVisionProvider {
  /** Human-readable provider id, for logging/telemetry. */
  readonly name: string
  /**
   * Read the handwritten fields off a form image. On failure it throws a
   * {@link VisionProviderError} whose `kind` the orchestrator maps to an HTTP
   * status — provider-specific error classification stays behind this seam.
   *
   * @param clientSignal aborts the read when the HTTP client hangs up. Honouring
   * it is what stops a provider from billing model calls whose answer nobody is
   * left to read (audit Finding H5).
   */
  readForm(
    imageBuffer: Buffer,
    mimeType: string,
    clientSignal?: AbortSignal,
  ): Promise<RawExtractionFields>
}

export const FORM_VISION_PROVIDER_BINDING = 'services.FormVisionProvider'

const DEFAULT_PROVIDER_CHAIN = ['gemini', 'ollama', 'ocrspace', 'groq']

// User-facing messages for the Gemini provider. They live here (not in the
// agnostic FormExtractionService) because only this layer is allowed to know it
// is Gemini and to name Gemini-specific config such as GEMINI_VISION_MODEL.
const GEMINI_TIMEOUT_MESSAGE =
  'El servicio de lectura del formulario tardó demasiado. Intenta de nuevo.'
const GEMINI_RATE_LIMITED_MESSAGE =
  'El servicio de lectura del formulario está ocupado temporalmente. Intenta de nuevo en unos minutos.'
const GEMINI_CONFIG_MESSAGE =
  'El servicio de lectura del formulario no está configurado correctamente. Revisa la API key y el modelo (GEMINI_VISION_MODEL) del servidor.'
const GEMINI_PARSE_MESSAGE =
  'El servicio de visión respondió, pero no devolvió un JSON de extracción válido. Intenta de nuevo o revisa el modelo configurado.'
const GEMINI_GENERIC_MESSAGE =
  'No se pudo leer el formulario con el servicio de visión. Intenta de nuevo.'
// Nobody is listening when this one is produced (the client already hung up);
// it exists so the failure is CLASSIFIED rather than logged as a mystery error.
const GEMINI_ABORTED_MESSAGE = 'La lectura del formulario fue cancelada.'

// Operational guards, not Google-documented latency targets. Keep them
// configurable and use the per-attempt logs below to tune with real traffic.
const DEFAULT_GEMINI_TIMEOUT_MS = 8000
const DEFAULT_GEMINI_TOTAL_TIMEOUT_MS = 26000
const DEFAULT_GEMINI_MEDIA_RESOLUTION = 'MEDIA_RESOLUTION_HIGH'
const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash'
// Ordered by likelihood of being available under load: 3.1-flash-lite first
// (highest local RPD), then the 3.x preview, then the sunsetting 2.5 pair, and
// finally the multimodal Gemma 4 models as a last resort. Gemma 4 accepts image
// input and honors responseMimeType/responseSchema on the Gemini API, so it is a
// valid vision fallback; keep it LAST because it is the least battle-tested in
// this pipeline. Kept in sync with .env.example and .env.deployment.example.
const DEFAULT_GEMINI_FALLBACK_MODELS = [
  'gemini-3.1-flash-lite',
  'gemini-3-flash-preview',
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemma-4-31b-it',
  'gemma-4-26b-a4b-it',
]

function getGeminiTimeoutMs(): number {
  const configured = Number(process.env.GEMINI_TIMEOUT_MS)
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_GEMINI_TIMEOUT_MS
}

function getGeminiTotalTimeoutMs(): number {
  const configured = Number(process.env.GEMINI_TOTAL_TIMEOUT_MS)
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_GEMINI_TOTAL_TIMEOUT_MS
}

function getGeminiMediaResolution(): string {
  return process.env.GEMINI_MEDIA_RESOLUTION ?? DEFAULT_GEMINI_MEDIA_RESOLUTION
}

function getGeminiModelChain(): string[] {
  const primaryModel = process.env.GEMINI_VISION_MODEL ?? DEFAULT_GEMINI_MODEL
  const configuredFallbacks =
    process.env.GEMINI_VISION_FALLBACK_MODELS?.split(',') ??
    DEFAULT_GEMINI_FALLBACK_MODELS

  return Array.from(
    new Set([
      primaryModel,
      ...configuredFallbacks.map(model => model.trim()).filter(Boolean),
    ]),
  )
}

/**
 * Default provider: orchestrates the Gemini model fallback chain. For each
 * model it reserves local quota, then delegates the single call to the
 * transport, falling through to the next model on retryable failures
 * (timeout / quota / 5xx) until one succeeds or the total deadline passes.
 */
export class GeminiFormVisionProvider implements FormVisionProvider {
  readonly name = 'gemini'

  constructor(
    private readonly transport: GeminiTransport = new GeminiTransport(),
    private readonly quota: GeminiQuotaTracker = new GeminiQuotaTracker(),
  ) {}

  async readForm(
    imageBuffer: Buffer,
    mimeType: string,
    clientSignal?: AbortSignal,
  ): Promise<RawExtractionFields> {
    const models = getGeminiModelChain()
    const mediaResolution = getGeminiMediaResolution()
    const estimatedTokens = estimateGeminiRequestTokens(mediaResolution)
    const startedAt = Date.now()
    const perModelTimeoutMs = getGeminiTimeoutMs()
    const totalTimeoutMs = getGeminiTotalTimeoutMs()
    const deadline = startedAt + totalTimeoutMs
    let lastRetryableError: RetryableGeminiError | undefined
    // One logical extraction can bill several model calls. Counting them is the
    // only way to read cost PER TASK instead of per request (audit Finding H3).
    let billedAttempts = 0

    console.info('[purchase-extract] Gemini extraction start', {
      models,
      mediaResolution,
      estimatedTokens,
      imageBytes: imageBuffer.length,
      mimeType,
      perModelTimeoutMs,
      totalTimeoutMs,
    })

    for (const model of models) {
      const attemptStartedAt = Date.now()
      let reserved = false
      try {
        const remainingTimeoutMs = deadline - Date.now()
        if (remainingTimeoutMs <= 500) {
          throw new RetryableGeminiError(
            `Gemini extraction reached total timeout after ${Date.now() - startedAt}ms`,
            'timeout',
          )
        }
        const reservation = this.quota.reserve(model, estimatedTokens)
        if (!reservation.ok) {
          throw new RetryableGeminiError(reservation.reason)
        }
        reserved = true
        billedAttempts += 1
        const { fields, usage } = await this.transport.requestModel(
          model,
          imageBuffer,
          mimeType,
          mediaResolution,
          Math.min(perModelTimeoutMs, remainingTimeoutMs),
          clientSignal,
        )
        // Swap the pre-flight guess for what Gemini says it actually billed.
        this.quota.settle(model, estimatedTokens, usage.totalTokens)
        console.info('[purchase-extract] Gemini model succeeded', {
          model,
          durationMs: Date.now() - attemptStartedAt,
          totalDurationMs: Date.now() - startedAt,
          // Cost of the whole task, not of this call: `billedAttempts` counts
          // every model the chain paid for before this one answered.
          billedAttempts,
          estimatedTokens,
          usage,
        })
        return fields
      } catch (error) {
        // Refund ONLY what never reached Gemini. A dispatched attempt (timeout,
        // 429, bad answer) already counted against the remote RPM/RPD, so
        // handing the budget back here would only invite remote 429s later.
        if (reserved && !consumedRemoteQuota(error)) {
          billedAttempts -= 1
          this.quota.release(model, estimatedTokens)
        }
        if (error instanceof ClientAbortedError) {
          console.info('[purchase-extract] client hung up; chain stopped', {
            model,
            billedAttempts,
            remainingModels: models.length - models.indexOf(model) - 1,
            totalDurationMs: Date.now() - startedAt,
          })
          throw this.toVisionError(error)
        }
        if (!(error instanceof RetryableGeminiError)) {
          console.warn('[purchase-extract] Gemini model failed', {
            model,
            durationMs: Date.now() - attemptStartedAt,
            totalDurationMs: Date.now() - startedAt,
            retryable: false,
            billedAttempts,
            reason: error instanceof Error ? error.message : String(error),
          })
          throw this.toVisionError(error)
        }
        lastRetryableError = error
        console.warn('[purchase-extract] Gemini model fallback', {
          failedModel: model,
          remainingModels: models.length - models.indexOf(model) - 1,
          durationMs: Date.now() - attemptStartedAt,
          totalDurationMs: Date.now() - startedAt,
          billedAttempts,
          reason: error.message,
        })
      }
    }

    console.warn('[purchase-extract] Gemini chain exhausted', {
      models,
      billedAttempts,
      totalDurationMs: Date.now() - startedAt,
    })
    throw this.toVisionError(
      lastRetryableError ?? new Error('Gemini extraction failed'),
    )
  }

  /**
   * Translates a Gemini-layer failure into a typed, provider-agnostic
   * {@link VisionProviderError}. All Gemini error-vocabulary matching lives
   * HERE, below the seam, so FormExtractionService only ever switches on `kind`.
   */
  private toVisionError(error: unknown): VisionProviderError {
    if (error instanceof VisionProviderError) return error
    if (error instanceof ClientAbortedError) {
      return new VisionProviderError('client_aborted', GEMINI_ABORTED_MESSAGE)
    }
    if (error instanceof RetryableGeminiError) {
      return error.retryKind === 'timeout'
        ? new VisionProviderError('timeout', GEMINI_TIMEOUT_MESSAGE)
        : new VisionProviderError('rate_limited', GEMINI_RATE_LIMITED_MESSAGE)
    }

    const message = error instanceof Error ? error.message : String(error)
    if (
      /api key|api_key|environment variable is not set|not found|not supported|404|model/i.test(
        message,
      )
    ) {
      return new VisionProviderError('unprocessable', GEMINI_CONFIG_MESSAGE)
    }
    if (
      /did not return extraction JSON|invalid extraction JSON|non-JSON/i.test(
        message,
      )
    ) {
      return new VisionProviderError('unprocessable', GEMINI_PARSE_MESSAGE)
    }
    return new VisionProviderError('unprocessable', GEMINI_GENERIC_MESSAGE)
  }
}

export class FallbackFormVisionProvider implements FormVisionProvider {
  readonly name: string

  constructor(private readonly providers: FormVisionProvider[]) {
    if (providers.length === 0) {
      throw new Error('At least one form vision provider is required')
    }
    this.name = providers.map(provider => provider.name).join('->')
  }

  async readForm(
    imageBuffer: Buffer,
    mimeType: string,
    clientSignal?: AbortSignal,
  ): Promise<RawExtractionFields> {
    let lastError: unknown

    for (const provider of this.providers) {
      try {
        return await provider.readForm(imageBuffer, mimeType, clientSignal)
      } catch (error) {
        // A client hang-up is not a provider defect: falling through would bill
        // the next provider for an answer nobody will read.
        if (
          error instanceof VisionProviderError &&
          error.kind === 'client_aborted'
        ) {
          throw error
        }
        lastError = error
        const reason = error instanceof Error ? error.message : String(error)
        console.warn('[purchase-extract] provider fallback', {
          failedProvider: provider.name,
          remainingProviders:
            this.providers.length - this.providers.indexOf(provider) - 1,
          reason,
        })
      }
    }

    if (lastError instanceof VisionProviderError) {
      throw lastError
    }
    throw new VisionProviderError(
      'unprocessable',
      'No se pudo leer el formulario con los proveedores de visión configurados. Intenta de nuevo.',
    )
  }
}

/** Select the vision provider from env (default: gemini). */
export function createFormVisionProvider(): FormVisionProvider {
  const choice = (process.env.FORM_VISION_PROVIDER ?? 'gemini').toLowerCase()
  if (choice === 'chain') {
    const configuredChain =
      process.env.FORM_VISION_PROVIDER_CHAIN?.split(',') ??
      DEFAULT_PROVIDER_CHAIN
    const providers = configuredChain
      .map(provider => provider.trim().toLowerCase())
      .filter(Boolean)
      .map(createSingleFormVisionProvider)
    return new FallbackFormVisionProvider(providers)
  }
  return createSingleFormVisionProvider(choice)
}

function createSingleFormVisionProvider(choice: string): FormVisionProvider {
  switch (choice) {
    case 'ocrspace':
      return new (require('./providers/ocrspace-form-vision.provider').OcrSpaceFormVisionProvider)()
    case 'ollama':
      // Lazy require avoids a load-time cycle and keeps optional providers
      // outside the default Gemini path.
      return new (require('./providers/ollama-form-vision.provider').OllamaFormVisionProvider)()
    case 'groq':
      // Lazy require avoids a load-time cycle: groq-form-vision.provider imports
      // VisionProviderError/FormVisionProvider from this module.
      return new (require('./providers/groq-form-vision.provider').GroqFormVisionProvider)()
    case 'gemini':
    default:
      return new GeminiFormVisionProvider()
  }
}
