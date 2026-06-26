import { inject, service } from '@loopback/core'
import { repository } from '@loopback/repository'
import {
  HttpErrors,
  RestBindings,
  Response,
  Request,
  post,
  response,
} from '@loopback/rest'
import multer from 'multer'
import { Roles, requireRoles } from '../../../auth'
import { PersonRepository, ProductRepository } from '../../../repositories'
import { ExtractionResult, FormExtractionService } from '../../../services'
import { PRODUCT_FIELDS } from '../../../services/form-spec'

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15 MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true)
    else cb(new Error('Only image files are allowed'))
  },
})

const EXTRACTION_RESULT_SCHEMA = {
  type: 'object',
  required: [
    'date',
    'librasTotal',
    'supplier',
    'details',
    'totalWeightCheck',
    'needsReview',
    'reviewReasons',
  ],
  properties: {
    date: {
      type: 'object',
      properties: {
        value: { type: 'string', nullable: true },
        confidence: { type: 'number' },
        needsReview: { type: 'boolean' },
      },
    },
    librasTotal: {
      type: 'object',
      properties: {
        value: { type: 'number', nullable: true },
        confidence: { type: 'number' },
      },
    },
    supplier: {
      type: 'object',
      properties: {
        rawName: { type: 'string', nullable: true },
        personId: { type: 'number', nullable: true },
        confidence: { type: 'number' },
        needsReview: { type: 'boolean' },
        candidates: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'number' },
              name: { type: 'string' },
              score: { type: 'number' },
            },
          },
        },
      },
    },
    details: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          fieldName: { type: 'string', enum: [...PRODUCT_FIELDS] },
          productId: { type: 'number', nullable: true },
          productName: { type: 'string' },
          weightLb: { type: 'number' },
          weightKg: { type: 'number' },
          confidence: { type: 'number' },
          needsReview: { type: 'boolean' },
        },
      },
    },
    totalWeightCheck: {
      type: 'object',
      properties: {
        passed: { type: 'boolean' },
        formTotalLb: { type: 'number', nullable: true },
        sumLb: { type: 'number' },
      },
    },
    needsReview: { type: 'boolean' },
    reviewReasons: { type: 'array', items: { type: 'string' } },
  },
} as const

export class PurchaseExtractController {
  constructor(
    @service(FormExtractionService)
    private formExtractionService: FormExtractionService,
    @repository(PersonRepository)
    private personRepository: PersonRepository,
    @repository(ProductRepository)
    private productRepository: ProductRepository,
  ) {}

  @requireRoles(Roles.OFFICE, Roles.ADMIN)
  @post('/purchases/extract')
  @response(200, {
    description:
      'Extracted and normalised form fields ready to pre-fill a purchase',
    content: { 'application/json': { schema: EXTRACTION_RESULT_SCHEMA } },
  })
  async extract(
    @inject(RestBindings.Http.REQUEST) request: Request,
    @inject(RestBindings.Http.RESPONSE) res: Response,
  ): Promise<ExtractionResult> {
    // Apply multer to parse the uploaded image into memory (request.file)
    const single = upload.single('image') as unknown as (
      req: Request,
      res: Response,
      cb: (err: unknown) => void,
    ) => void
    await new Promise<void>((resolve, reject) => {
      single(request, res, (err: unknown) => {
        if (err) reject(new HttpErrors.BadRequest(String(err)))
        else resolve()
      })
    })

    const file = (
      request as Request & { file?: { buffer: Buffer; mimetype: string } }
    ).file
    if (!file)
      throw new HttpErrors.BadRequest(
        'No se adjuntó ninguna imagen (campo: image)',
      )

    const body = (request as Request & { body?: Record<string, unknown> }).body
    console.info('[purchase-extract] image received', {
      mimetype: file.mimetype,
      sizeBytes: file.buffer.length,
      provider: this.formExtractionService.providerName,
      clientMetadata: {
        optimizedSizeBytes: body?.optimizedSizeBytes,
        optimizedWidth: body?.optimizedWidth,
        optimizedHeight: body?.optimizedHeight,
        cropX: body?.cropX,
        cropY: body?.cropY,
        cropWidth: body?.cropWidth,
        cropHeight: body?.cropHeight,
      },
    })

    const [people, products] = await Promise.all([
      this.personRepository.find({ fields: { id: true, name: true } }),
      this.productRepository.find({ fields: { id: true, name: true } }),
    ])

    const result = await this.formExtractionService.extractForm(
      file.buffer,
      file.mimetype,
      people.map(p => ({ id: p.id!, name: p.name })),
      products.map(p => ({ id: p.id!, name: p.name })),
    )

    console.info('[purchase-extract] extraction result', {
      detailsCount: result.details.length,
      details: result.details.map(detail => ({
        fieldName: detail.fieldName,
        weightLb: detail.weightLb,
        weightKg: detail.weightKg,
        confidence: detail.confidence,
        needsReview: detail.needsReview,
        productId: detail.productId,
      })),
      date: result.date,
      librasTotal: result.librasTotal,
      // Supplier name (PII) is intentionally omitted from logs; only the
      // resolved id + match quality are recorded for telemetry.
      supplier: {
        personId: result.supplier.personId,
        confidence: result.supplier.confidence,
        needsReview: result.supplier.needsReview,
      },
      totalWeightCheck: result.totalWeightCheck,
      needsReview: result.needsReview,
      reviewReasons: result.reviewReasons,
    })

    return result
  }
}
