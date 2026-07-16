import { authenticate } from '@loopback/authentication'
import { inject, service } from '@loopback/core'
import {
  get,
  getModelSchemaRef,
  post,
  requestBody,
  response,
  Response,
  RestBindings,
} from '@loopback/rest'
import { SecurityBindings, UserProfile } from '@loopback/security'
import {
  allowAuthenticated,
  buildAuthCookie,
  buildClearAuthCookie,
  requireAuth,
} from '../../../auth'
import { Credentials, LoginResult, WhoAmIResponse } from '../../../models'
import { SecurityService } from '../../../services'

export class AuthControllerController {
  constructor(
    @service(SecurityService)
    public securityService: SecurityService,
  ) {}

  /**
   * User sign-in with credentials (email and password)
   * @param credentials User credentials
   * @returns Login result with user data; the JWT is delivered as an
   * httpOnly cookie, never in the response body.
   * @description This method allows a user to sign in using their email and password.
   * On success it sets the `auth_token` session cookie and returns the user data.
   */
  @authenticate.skip()
  @post('/sign-in')
  @response(200, {
    description: 'User sign-in with credentials (email and password)',
    content: { 'application/json': { schema: getModelSchemaRef(LoginResult) } },
  })
  async identifyUser(
    @requestBody({
      content: {
        'application/json': {
          schema: getModelSchemaRef(Credentials, {
            title: 'Credentials',
          }),
        },
      },
    })
    credentials: Credentials,
    @inject(RestBindings.Http.RESPONSE)
    httpResponse: Response,
  ): Promise<LoginResult> {
    const { user, token } = await this.securityService.login(credentials)
    httpResponse.setHeader('Set-Cookie', buildAuthCookie(token))
    return new LoginResult({ user })
  }

  /**
   * Sign out: clears the `auth_token` session cookie.
   * @description Skips authentication (an expired/invalid token must still
   * be able to sign out and clear its cookie).
   */
  @authenticate.skip()
  @post('/sign-out')
  @response(204, {
    description: 'User sign-out: clears the session cookie',
  })
  async signOut(
    @inject(RestBindings.Http.RESPONSE)
    httpResponse: Response,
  ): Promise<void> {
    httpResponse.setHeader('Set-Cookie', buildClearAuthCookie())
  }

  /**
   * Get current authenticated user information
   * @returns Current user information (without sensitive data)
   * @description This method returns information about the currently authenticated user
   */
  @requireAuth()
  @allowAuthenticated()
  @get('/whoami')
  @response(200, {
    description: 'Current user information',
    content: {
      'application/json': { schema: getModelSchemaRef(WhoAmIResponse) },
    },
  })
  async whoAmI(
    @inject(SecurityBindings.USER)
    currentUser: UserProfile,
  ): Promise<WhoAmIResponse> {
    return new WhoAmIResponse({
      id: currentUser.id ?? '',
      name: currentUser.name ?? '',
      email: currentUser.email ?? '',
      role: (currentUser as UserProfile & { role?: string }).role ?? '',
    })
  }
}
