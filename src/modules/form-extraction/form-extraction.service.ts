import { BindingScope, inject, injectable } from '@loopback/core'
import {
  DomainError,
  RateLimitedError,
  TimeoutError,
  UnprocessableError,
} from '../../errors'
import { ExtractionResult, normalize } from './form-extraction.normalizer'
import {
  FORM_VISION_PROVIDER_BINDING,
  FormVisionProvider,
  VisionProviderError,
} from './form-extraction.provider'

export {
  ExtractedDetail,
  ExtractionResult,
  RawExtractionFields,
  SupplierMatch,
} from './form-extraction.normalizer'

/**
 * Orchestrates form extraction: a swappable vision provider reads the photo into
 * raw fields (Gemini by default), then the pure
 * normalizer turns those into a purchase prefill with confidence + review flags.
 * The image is processed in memory and never persisted.
 */
@injectable({ scope: BindingScope.TRANSIENT })
export class FormExtractionService {
  constructor(
    @inject(FORM_VISION_PROVIDER_BINDING)
    private readonly provider: FormVisionProvider,
  ) {}

  get providerName(): string {
    return this.provider.name
  }

  /**
   * @param clientSignal aborts the vision call when the HTTP client hangs up, so
   * an abandoned scan stops burning model calls instead of running the fallback
   * chain to completion for an answer nobody will read (audit Finding H5).
   */
  async extractForm(
    imageBuffer: Buffer,
    mimeType: string,
    people: Array<{ id: number; name: string }>,
    products: Array<{ id: number; name: string }>,
    clientSignal?: AbortSignal,
  ): Promise<ExtractionResult> {
    let raw
    try {
      raw = await this.provider.readForm(imageBuffer, mimeType, clientSignal)
    } catch (error) {
      throw this.toDomainError(error)
    }

    return normalize(raw, people, products)
  }

  /**
   * Maps a typed provider failure to an HTTP-agnostic domain error. The
   * classification is decided BELOW the seam (the provider throws a
   * VisionProviderError with a `kind`), so this agnostic orchestrator carries no
   * provider-specific error vocabulary — a second provider is classified by the
   * same table without rewording its messages (audit Finding M2).
   */
  private toDomainError(error: unknown): DomainError {
    const message = error instanceof Error ? error.message : String(error)

    // An abandoned scan is expected traffic, not a failure: log it as such so it
    // does not pollute the error signal we use to judge the feature's health.
    if (
      error instanceof VisionProviderError &&
      error.kind === 'client_aborted'
    ) {
      console.info('[purchase-extract] extraction cancelled by the client', {
        message,
      })
      return new UnprocessableError(error.message)
    }

    console.error('[purchase-extract] vision provider failed', { message })

    if (error instanceof VisionProviderError) {
      switch (error.kind) {
        case 'timeout':
          return new TimeoutError(error.message)
        case 'rate_limited':
          return new RateLimitedError(error.message)
        case 'unprocessable':
        case 'client_aborted':
          return new UnprocessableError(error.message)
      }
    }

    // Defensive fallback for a genuinely untyped failure (a provider that did
    // not wrap its error). No provider-specific strings here.
    return new UnprocessableError(
      'No se pudo leer el formulario con el servicio de visión. Intenta de nuevo.',
    )
  }
}
