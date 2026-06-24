import { BindingScope, inject, injectable } from '@loopback/core'
import { HttpErrors } from '@loopback/rest'
import { ExtractionResult, normalize } from './form-extraction.normalizer'
import {
  FORM_VISION_PROVIDER_BINDING,
  FormVisionProvider,
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

  async extractForm(
    imageBuffer: Buffer,
    mimeType: string,
    people: Array<{ id: number; name: string }>,
    products: Array<{ id: number; name: string }>,
  ): Promise<ExtractionResult> {
    let raw
    try {
      raw = await this.provider.readForm(imageBuffer, mimeType)
    } catch (error) {
      throw this.toHttpError(error)
    }

    return normalize(raw, people, products)
  }

  private toHttpError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error)

    if (/timed out|timeout|abort|DEADLINE_EXCEEDED/i.test(message)) {
      return new HttpErrors.RequestTimeout(
        'El servicio de lectura del formulario tardó demasiado. Intenta de nuevo.',
      )
    }

    if (
      /api key not valid|api_key|environment variable is not set/i.test(message)
    ) {
      return new HttpErrors.UnprocessableEntity(
        'El servicio de lectura del formulario no está configurado correctamente. Revisa la API key del servidor.',
      )
    }

    if (
      /RESOURCE_EXHAUSTED|UNAVAILABLE|quota|rate limit|high demand|try again later|límite local|limite local/i.test(
        message,
      )
    ) {
      return new HttpErrors.TooManyRequests(
        'El servicio de lectura del formulario está ocupado temporalmente. Intenta de nuevo en unos minutos.',
      )
    }

    return new HttpErrors.UnprocessableEntity(
      'No se pudo leer el formulario con el servicio de visión. Intenta de nuevo.',
    )
  }
}
