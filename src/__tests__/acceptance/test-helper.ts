import { App } from '../..'
import {
  createRestAppClient,
  givenHttpServerConfig,
  Client,
} from '@loopback/testlab'
import { SecurityService } from '../../services'
import { User } from '../../models'

const HTTP_VERBS = [
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'head',
  'options',
] as const

/**
 * Wrap a test Client so every request automatically carries an admin JWT.
 * With global authentication enabled, acceptance tests would otherwise 401.
 */
function withAuth(client: Client, token: string): Client {
  return new Proxy(client, {
    get(target, prop, receiver) {
      const original = Reflect.get(target, prop, receiver)
      if (
        typeof prop === 'string' &&
        (HTTP_VERBS as readonly string[]).includes(prop) &&
        typeof original === 'function'
      ) {
        return (...args: unknown[]) =>
          (
            original as (...a: unknown[]) => {
              set: (k: string, v: string) => unknown
            }
          )
            .apply(target, args)
            .set('Authorization', `Bearer ${token}`)
      }
      return typeof original === 'function' ? original.bind(target) : original
    },
  }) as Client
}

export async function setupApplication(): Promise<AppWithClient> {
  const restConfig = givenHttpServerConfig({
    // Customize the server configuration here.
    // host: process.env.HOST,
    // port: +process.env.PORT,
  })

  const app = new App({
    rest: restConfig,
  })

  await app.boot()
  await app.start()

  const rawClient = createRestAppClient(app)

  // Synthetic admin token (JWT verification is signature-only; no DB user needed).
  const securityService = await app.get<SecurityService>(
    'services.SecurityService',
  )
  const token = securityService.generateToken({
    id: 1,
    name: 'test-admin',
    email: 'test-admin@local',
    role: 'admin',
  } as User)

  const makeToken = (role: string) =>
    securityService.generateToken({
      id: 1,
      name: `test-${role}`,
      email: `test-${role}@local`,
      role,
    } as User)

  return {
    app,
    client: withAuth(rawClient, token),
    token,
    rawClient,
    makeToken,
  }
}

export interface AppWithClient {
  app: App
  client: Client
  token: string
  rawClient: Client
  makeToken: (role: string) => string
}
