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
import { extractAuthTokenFromCookieHeader } from './auth-cookie'

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
      const decodedToken = this.securityService.verifyToken(token)

      const userProfile: UserProfile = {
        [securityId]: decodedToken.id,
        id: decodedToken.id,
        name: decodedToken.name,
        email: decodedToken.email,
        role: decodedToken.role,
      }

      return userProfile
    } catch (error) {
      if (error instanceof Error) {
        throw error
      }
      throw new HttpErrors.Unauthorized('Invalid token')
    }
  }

  extractCredentials(request: Request): string {
    // Cookie first (browser session flow), falling back to the Authorization
    // header (API tools, acceptance tests) so both flows keep working.
    const cookieToken = extractAuthTokenFromCookieHeader(request.headers.cookie)
    if (cookieToken) {
      return cookieToken
    }

    if (!request.headers.authorization) {
      throw new HttpErrors.Unauthorized('Authorization header not found.')
    }

    const authHeaderValue = request.headers.authorization.trim()

    if (!/^Bearer\s+/i.test(authHeaderValue)) {
      throw new HttpErrors.Unauthorized(
        'Authorization header is not of type "Bearer".',
      )
    }

    const parts = authHeaderValue.split(/\s+/)
    if (parts.length !== 2) {
      throw new HttpErrors.Unauthorized(
        'Authorization header value has too many parts. It must follow the pattern: "Bearer xx.yy.zz"',
      )
    }

    return parts[1]
  }

  modifySpec(spec: OpenApiSpec): OpenApiSpec {
    return mergeSecuritySchemeToSpec(spec, this.name, {
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
      description: 'JWT Bearer token authentication. Format: Bearer <token>',
    })
  }
}
