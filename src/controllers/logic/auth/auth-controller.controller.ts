import {inject, service} from '@loopback/core';
import {get, getModelSchemaRef, post, requestBody, response} from '@loopback/rest';
import {SecurityBindings, UserProfile} from '@loopback/security';
import {requireAuth} from '../../../auth';
import {Credentials, LoginResult, User, WhoAmIResponse} from '../../../models';
import {SecurityService} from '../../../services';

export class AuthControllerController {
  constructor(
    @service(SecurityService)
    public securityService: SecurityService,
  ) {

  }

  /**
   * User sign-in with credentials (email and password)
   * @param credentials User credentials
   * @returns User instance
   * @description This method allows a user to sign in using their email and password.
   * It returns the user instance if the credentials are valid.
   */
  @post('/sign-in')
  @response(200, {
    description: 'User sign-in with credentials (email and password)',
    content: {'application/json': {schema: getModelSchemaRef(User)}},
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
  ): Promise<LoginResult> {
    return this.securityService.login(credentials);
  }

  /**
   * Get current authenticated user information
   * @returns Current user information (without sensitive data)
   * @description This method returns information about the currently authenticated user
   */
  @requireAuth()
  @get('/whoami')
  @response(200, {
    description: 'Current user information',
    content: {'application/json': {schema: getModelSchemaRef(WhoAmIResponse)}},
  })
  async whoAmI(
    @inject(SecurityBindings.USER)
    currentUser: UserProfile,
  ): Promise<WhoAmIResponse> {
    return new WhoAmIResponse({
      id: currentUser.id ?? '',
      name: currentUser.name ?? '',
      email: currentUser.email ?? '',
      role: (currentUser as UserProfile & {role?: string}).role ?? '',
    });
  }

}
