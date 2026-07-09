// Alternative FormVisionProvider backed by OCR.space's OCR API.
// Opt in with FORM_VISION_PROVIDER=ocrspace.
//
// OCR.space is OCR-only: it returns parsed text, not a structured form object.
// This provider converts the OCR text to RawExtractionFields with the shared
// text parser, so downstream normalization stays identical to the LLM providers.

import { RawExtractionFields } from '../form-extraction.normalizer'
import {
  EMPTY_TEXT_EXTRACTION_MESSAGE,
  parseExtractionText,
} from '../form-extraction.text-parser'
import {
  FormVisionProvider,
  VisionProviderError,
} from '../form-extraction.provider'
import { sanitizeRawExtraction } from '../gemini/gemini-transport'

const DEFAULT_OCRSPACE_BASE_URL = 'https://api.ocr.space/parse/image'
const DEFAULT_OCRSPACE_LANGUAGE = 'spa'
const DEFAULT_OCRSPACE_ENGINE = '2'
const DEFAULT_OCRSPACE_TIMEOUT_MS = 15000
const INVALID_OCRSPACE_JSON_MESSAGE =
  'OCR.space returned invalid extraction JSON'

const OCRSPACE_TIMEOUT_MESSAGE =
  'El servicio de lectura OCR tardó demasiado. Intenta de nuevo.'
const OCRSPACE_RATE_LIMITED_MESSAGE =
  'El servicio de lectura OCR está ocupado temporalmente. Intenta de nuevo en unos minutos.'
const OCRSPACE_CONFIG_MESSAGE =
  'El servicio OCR no está configurado correctamente. Revisa OCRSPACE_API_KEY y OCRSPACE_BASE_URL del servidor.'
const OCRSPACE_PARSE_MESSAGE =
  'El servicio OCR respondió, pero no se pudieron reconocer campos del formulario. Intenta de nuevo o revisa la imagen.'
const OCRSPACE_GENERIC_MESSAGE =
  'No se pudo leer el formulario con el servicio OCR. Intenta de nuevo.'

interface OcrSpaceResponse {
  ParsedResults?: Array<{ ParsedText?: string }>
  IsErroredOnProcessing?: boolean
  ErrorMessage?: string | string[]
  ErrorDetails?: string
}

type OcrSpaceRetryKind = 'timeout' | 'rate_limited'

class RetryableOcrSpaceError extends Error {
  constructor(
    message: string,
    readonly retryKind: OcrSpaceRetryKind = 'rate_limited',
  ) {
    super(message)
    this.name = 'RetryableOcrSpaceError'
  }
}

function getOcrSpaceBaseUrl(): string {
  return process.env.OCRSPACE_BASE_URL ?? DEFAULT_OCRSPACE_BASE_URL
}

function getOcrSpaceTimeoutMs(): number {
  const configured = Number(process.env.OCRSPACE_TIMEOUT_MS)
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_OCRSPACE_TIMEOUT_MS
}

function getOcrSpaceLanguage(): string {
  return process.env.OCRSPACE_LANGUAGE ?? DEFAULT_OCRSPACE_LANGUAGE
}

function getOcrSpaceEngine(): string {
  return process.env.OCRSPACE_ENGINE ?? DEFAULT_OCRSPACE_ENGINE
}

function ocrSpaceErrorMessage(payload: OcrSpaceResponse): string {
  const raw = payload.ErrorMessage
  const message = Array.isArray(raw) ? raw.join('; ') : raw
  return message ?? payload.ErrorDetails ?? 'OCR.space processing failed'
}

function isRetryableOcrSpaceFailure(status: number, message: string): boolean {
  if ([408, 409, 425, 429, 500, 502, 503, 504].includes(status)) return true
  return /rate limit|too many requests|quota|overloaded|unavailable|timeout|timed out|try again/i.test(
    message,
  )
}

function ocrSpaceRetryKind(status: number, message: string): OcrSpaceRetryKind {
  if (status === 408 || status === 504) return 'timeout'
  if (/timeout|timed out|aborted/i.test(message)) return 'timeout'
  return 'rate_limited'
}

export class OcrSpaceFormVisionProvider implements FormVisionProvider {
  readonly name = 'ocrspace'

  async readForm(
    imageBuffer: Buffer,
    mimeType: string,
  ): Promise<RawExtractionFields> {
    const apiKey = process.env.OCRSPACE_API_KEY
    if (!apiKey) {
      throw this.toVisionError(
        new Error('OCRSPACE_API_KEY environment variable is not set'),
      )
    }

    const timeoutMs = getOcrSpaceTimeoutMs()
    const startedAt = Date.now()

    console.info('[purchase-extract] OCR.space extraction start', {
      imageBytes: imageBuffer.length,
      mimeType,
      timeoutMs,
      language: getOcrSpaceLanguage(),
      engine: getOcrSpaceEngine(),
    })

    try {
      const result = await this.requestOcr(imageBuffer, mimeType, apiKey)
      console.info('[purchase-extract] OCR.space extraction succeeded', {
        durationMs: Date.now() - startedAt,
      })
      return result
    } catch (error) {
      console.warn('[purchase-extract] OCR.space extraction failed', {
        durationMs: Date.now() - startedAt,
        reason: error instanceof Error ? error.message : String(error),
      })
      throw this.toVisionError(error)
    }
  }

  private async requestOcr(
    imageBuffer: Buffer,
    mimeType: string,
    apiKey: string,
  ): Promise<RawExtractionFields> {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), getOcrSpaceTimeoutMs())
    const form = new FormData()
    form.set('apikey', apiKey)
    form.set('language', getOcrSpaceLanguage())
    form.set('OCREngine', getOcrSpaceEngine())
    form.set('isOverlayRequired', 'false')
    form.set('scale', 'true')
    form.set('detectOrientation', 'true')
    form.set(
      'base64Image',
      `data:${mimeType};base64,${imageBuffer.toString('base64')}`,
    )

    let response: Response
    try {
      response = await fetch(getOcrSpaceBaseUrl(), {
        method: 'POST',
        signal: controller.signal,
        body: form,
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new RetryableOcrSpaceError(
          `OCR.space extraction timed out after ${getOcrSpaceTimeoutMs()}ms`,
          'timeout',
        )
      }
      throw error
    } finally {
      clearTimeout(timeout)
    }

    const responseText = await response.text()
    const payload = this.parseResponse(responseText, response.statusText)
    if (!response.ok || payload.IsErroredOnProcessing) {
      const message = ocrSpaceErrorMessage(payload)
      const formatted = `OCR.space extraction failed: ${message}`
      if (isRetryableOcrSpaceFailure(response.status, message)) {
        throw new RetryableOcrSpaceError(
          formatted,
          ocrSpaceRetryKind(response.status, message),
        )
      }
      throw new Error(formatted)
    }

    const parsedText = payload.ParsedResults?.map(
      result => result.ParsedText ?? '',
    )
      .join('\n')
      .trim()
    if (!parsedText) throw new Error(EMPTY_TEXT_EXTRACTION_MESSAGE)

    return parseExtractionText(
      parsedText,
      sanitizeRawExtraction,
      INVALID_OCRSPACE_JSON_MESSAGE,
    )
  }

  private parseResponse(text: string, statusText: string): OcrSpaceResponse {
    if (!text) return {}
    try {
      return JSON.parse(text) as OcrSpaceResponse
    } catch {
      throw new Error(`OCR.space returned a non-JSON response: ${statusText}`)
    }
  }

  private toVisionError(error: unknown): VisionProviderError {
    if (error instanceof VisionProviderError) return error
    if (error instanceof RetryableOcrSpaceError) {
      return error.retryKind === 'timeout'
        ? new VisionProviderError('timeout', OCRSPACE_TIMEOUT_MESSAGE)
        : new VisionProviderError('rate_limited', OCRSPACE_RATE_LIMITED_MESSAGE)
    }

    const message = error instanceof Error ? error.message : String(error)
    if (
      /api key|api_key|environment variable|unauthorized|forbidden|not found|401|403|404/i.test(
        message,
      )
    ) {
      return new VisionProviderError('unprocessable', OCRSPACE_CONFIG_MESSAGE)
    }
    if (
      /invalid extraction JSON|non-JSON|recognized extraction fields|recognized key-value|recognize/i.test(
        message,
      ) ||
      message === EMPTY_TEXT_EXTRACTION_MESSAGE
    ) {
      return new VisionProviderError('unprocessable', OCRSPACE_PARSE_MESSAGE)
    }
    return new VisionProviderError('unprocessable', OCRSPACE_GENERIC_MESSAGE)
  }
}
