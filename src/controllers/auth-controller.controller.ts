
import {service} from '@loopback/core';
import {getModelSchemaRef, post, requestBody, response} from '@loopback/rest';
import {Credentials, LoginResult, User} from '../models';
import {SecurityService} from '../services';

export class AuthControllerController {
  constructor(
    @service(SecurityService)
    public securityService: SecurityService,
  ){

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
    return await this.securityService.login(credentials);
  }

}
