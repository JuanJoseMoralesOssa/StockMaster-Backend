import { App } from '../..'
import {
  createRestAppClient,
  givenHttpServerConfig,
  Client,
} from '@loopback/testlab'
import { SecurityService } from '../../services'
import { User } from '../../models'

// 'del' is supertest's alias for 'delete' — it must be wrapped too, or
// cleanup calls written as client.del(...) go out WITHOUT the auth header
// and silently 401, leaking rows between test runs.
const HTTP_VERBS = [
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'del',
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

/**
 * Best-effort cleanup for purchases/expenses. DELETE requires the current
 * optimistic-lock version, so this fetches the row first and skips silently
 * if it is already gone.
 */
export async function cleanupTransaction(
  client: Client,
  basePath: '/purchases' | '/expenses',
  id: number | undefined,
): Promise<void> {
  if (id == null) return
  try {
    const res = await client.get(`${basePath}/${id}`)
    if (res.status !== 200) return
    const version = Number(res.body?.version ?? 1)
    await client.delete(`${basePath}/${id}`).query({ version })
  } catch {
    // best-effort: never fail a test from its cleanup block
  }
}
