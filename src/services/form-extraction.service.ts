import { BindingScope, inject, injectable } from '@loopback/core'
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

  async extractForm(
    imageBuffer: Buffer,
    mimeType: string,
    people: Array<{ id: number; name: string }>,
    products: Array<{ id: number; name: string }>,
  ): Promise<ExtractionResult> {
    const raw = await this.provider.readForm(imageBuffer, mimeType)
    return normalize(raw, people, products)
  }
}
