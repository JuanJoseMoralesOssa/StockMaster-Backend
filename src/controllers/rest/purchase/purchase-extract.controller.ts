import {inject, service} from '@loopback/core'
import {repository} from '@loopback/repository'
import {HttpErrors, RestBindings, Response, Request, post, response} from '@loopback/rest'
import multer from 'multer'
import {requireAuth} from '../../../auth'
import {PersonRepository, ProductRepository} from '../../../repositories'
import {ExtractionResult, FormExtractionService} from '../../../services'

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {fileSize: 15 * 1024 * 1024}, // 15 MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true)
    else cb(new Error('Only image files are allowed'))
  },
})

export class PurchaseExtractController {
  constructor(
    @service(FormExtractionService)
    private formExtractionService: FormExtractionService,
    @repository(PersonRepository)
    private personRepository: PersonRepository,
    @repository(ProductRepository)
    private productRepository: ProductRepository,
  ) {}

  @requireAuth()
  @post('/purchases/extract')
  @response(200, {
    description: 'Extracted and normalised form fields ready to pre-fill a purchase',
    content: {'application/json': {schema: {type: 'object'}}},
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

    const file = (request as Request & {file?: {buffer: Buffer; mimetype: string}}).file
    if (!file) throw new HttpErrors.BadRequest('No se adjuntó ninguna imagen (campo: image)')

    const [people, products] = await Promise.all([
      this.personRepository.find({fields: {id: true, name: true}}),
      this.productRepository.find({fields: {id: true, name: true}}),
    ])

    return this.formExtractionService.extractForm(
      file.buffer,
      file.mimetype,
      people.map(p => ({id: p.id!, name: p.name})),
      products.map(p => ({id: p.id!, name: p.name})),
    )
  }
}
