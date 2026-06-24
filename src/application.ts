import {
  AuthenticationBindings,
  AuthenticationComponent,
  registerAuthenticationStrategy,
} from '@loopback/authentication'
import { BootMixin } from '@loopback/boot'
import { ApplicationConfig, BindingScope } from '@loopback/core'
import { RepositoryMixin } from '@loopback/repository'
import { RestApplication } from '@loopback/rest'
import {
  RestExplorerBindings,
  RestExplorerComponent,
} from '@loopback/rest-explorer'
import { ServiceMixin } from '@loopback/service-proxy'
import rateLimit from 'express-rate-limit'
import path from 'path'
import { JWTAuthStrategy } from './auth/jwt-strategy'
import { MySequence } from './sequence'
import {
  createFormVisionProvider,
  FORM_VISION_PROVIDER_BINDING,
} from './services/form-extraction.provider'

export { ApplicationConfig }

const PURCHASE_EXTRACT_PATH = '/purchases/extract'
const DEFAULT_GEMINI_EXTRACT_RPM_LIMIT = 50
const DEFAULT_GEMINI_EXTRACT_RPD_LIMIT = 618

function getPositiveIntegerEnv(name: string, fallback: number): number {
  const configured = Number(process.env[name])
  return Number.isInteger(configured) && configured > 0 ? configured : fallback
}

export class App extends BootMixin(
  ServiceMixin(RepositoryMixin(RestApplication)),
) {
  constructor(options: ApplicationConfig = {}) {
    super(options)

    // Set up the custom sequence
    this.sequence(MySequence)

    // Set up default home page
    this.static('/', path.join(__dirname, '../public'))

    // Customize @loopback/rest-explorer configuration here
    this.configure(RestExplorerBindings.COMPONENT).to({
      path: '/explorer',
    })
    this.component(RestExplorerComponent)

    this.projectRoot = __dirname
    // Customize @loopback/boot Booter Conventions here
    this.bootOptions = {
      controllers: {
        dirs: ['controllers'],
        extensions: ['.controller.js'],
        nested: true,
      },
      interceptors: {
        dirs: ['interceptors', 'auth/interceptors'],
        extensions: ['.interceptor.js'],
        nested: true,
      },
    }

    const extractRequestsPerMinute = getPositiveIntegerEnv(
      'GEMINI_EXTRACT_RPM_LIMIT',
      DEFAULT_GEMINI_EXTRACT_RPM_LIMIT,
    )
    const extractRequestsPerDay = getPositiveIntegerEnv(
      'GEMINI_EXTRACT_RPD_LIMIT',
      DEFAULT_GEMINI_EXTRACT_RPD_LIMIT,
    )

    // Rate limiting: protege /sign-in (fuerza bruta) y /purchases/extract (costo LLM).
    // Cada limitador se salta el resto de rutas vía `skip`.
    this.expressMiddleware(
      'middleware.rateLimit.auth',
      rateLimit({
        windowMs: 15 * 60 * 1000, // 15 min
        limit: 20,
        standardHeaders: true,
        legacyHeaders: false,
        skip: req => req.path !== '/sign-in',
        message: {
          error: {
            message: 'Demasiados intentos. Inténtalo de nuevo más tarde.',
          },
        },
      }),
    )
    this.expressMiddleware(
      'middleware.rateLimit.extractMinute',
      rateLimit({
        windowMs: 60 * 1000, // Overall endpoint guard; per-model Gemini quota is enforced in the provider.
        limit: extractRequestsPerMinute,
        standardHeaders: true,
        legacyHeaders: false,
        skip: req => req.path !== PURCHASE_EXTRACT_PATH,
        message: {
          error: {
            message:
              'Límite de escaneos por minuto alcanzado. Inténtalo de nuevo en un momento.',
          },
        },
      }),
    )
    this.expressMiddleware(
      'middleware.rateLimit.extractDaily',
      rateLimit({
        windowMs: 24 * 60 * 60 * 1000, // Sum of the configured fallback-chain daily request limits.
        limit: extractRequestsPerDay,
        standardHeaders: true,
        legacyHeaders: false,
        skip: req => req.path !== PURCHASE_EXTRACT_PATH,
        message: {
          error: {
            message:
              'Límite diario de escaneos alcanzado. Inténtalo de nuevo mañana.',
          },
        },
      }),
    )

    registerAuthenticationStrategy(this, JWTAuthStrategy)
    this.component(AuthenticationComponent)

    this.bind(FORM_VISION_PROVIDER_BINDING)
      .toDynamicValue(() => createFormVisionProvider())
      .inScope(BindingScope.SINGLETON)

    // Seguro por defecto: TODOS los endpoints exigen un JWT válido, salvo los
    // marcados con `@authenticate.skip()` (sign-in, health, ping). Las rutas con
    // `@requireRoles(...)` añaden control de rol encima de la autenticación.
    this.configure(AuthenticationBindings.COMPONENT).to({
      defaultMetadata: [{ strategy: 'jwt' }],
      failOnError: true,
    })
  }
}
