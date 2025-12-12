import {
  asAuthStrategy,
  AuthenticationStrategy,
} from '@loopback/authentication'
import { inject, injectable } from '@loopback/core'
import {
  asSpecEnhancer,
  HttpErrors,
  mergeSecuritySchemeToSpec,
  OASEnhancer,
  OpenApiSpec,
  Request,
} from '@loopback/rest'
import { securityId, UserProfile } from '@loopback/security'
import { SecurityService } from '../services/security.service'
@injectable(asAuthStrategy, asSpecEnhancer)
export class JWTAuthStrategy implements AuthenticationStrategy, OASEnhancer {
  name: string = 'jwt'

  constructor(
    @inject('services.SecurityService')
    public securityService: SecurityService,
  ) {}

  async authenticate(request: Request): Promise<UserProfile | undefined> {
    const token: string = this.extractCredentials(request)

    try {
      // Usar tu SecurityService existente
      const user = this.securityService.verifyToken(token)

      // Convertir a UserProfile (formato que espera LoopBack)
      const userProfile: UserProfile = {
        [securityId]: user.id?.toString() ?? '',
        id: user.id?.toString() ?? '',
        name: user.name ?? '',
        email: user.email ?? '',
        role: user.role ?? '',
      }

      return userProfile
    } catch (error) {
      // Re-lanzar el error del SecurityService que ya tiene el formato correcto
      if (error instanceof Error) {
        throw error
      }
      throw new HttpErrors.Unauthorized('Invalid token')
    }
  }

  extractCredentials(request: Request): string {
    if (!request.headers.authorization) {
      throw new HttpErrors.Unauthorized('Authorization header not found.')
    }

    // Por ejemplo: Bearer xxx.yyy.zzz
    const authHeaderValue = request.headers.authorization

    if (!authHeaderValue.startsWith('Bearer')) {
      throw new HttpErrors.Unauthorized(
        'Authorization header is not of type "Bearer".',
      )
    }

    // Dividir el valor del header para obtener el token
    const parts = authHeaderValue.split(' ')
    if (parts.length !== 2) {
      throw new HttpErrors.Unauthorized(
        'Authorization header value has too many parts. It must follow the pattern: "Bearer xx.yy.zz" where xx.yy.zz is a valid JWT token.',
      )
    }

    const token = parts[1]
    return token
  }

  /**
   * Modifica automáticamente la especificación OpenAPI para incluir
   * la documentación de autenticación JWT Bearer
   */
  modifySpec(spec: OpenApiSpec): OpenApiSpec {
    return mergeSecuritySchemeToSpec(spec, this.name, {
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      description: 'JWT Bearer token authentication. Format: Bearer <token>',
    })
  }
}
