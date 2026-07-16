import { Client, expect } from '@loopback/testlab'
import * as jwt from 'jsonwebtoken'
import { App } from '../..'
import { AUTH_COOKIE_NAME, Roles } from '../../auth'
import { securityConfig } from '../../config/security'
import { setupApplication } from './test-helper'

/**
 * `res.headers` types 'set-cookie' as a plain string, but Node's http layer
 * always represents it as an array (even with a single cookie) — see
 * https://nodejs.org/api/http.html#messageheaders. Handle both shapes.
 */
function extractSetCookieHeaders(res: {
  headers: Record<string, unknown>
}): string[] {
  const raw = res.headers['set-cookie']
  if (!raw) return []
  return Array.isArray(raw) ? (raw as string[]) : [String(raw)]
}

function findSessionCookie(res: { headers: Record<string, unknown> }): string {
  const cookie = extractSetCookieHeaders(res).find(header =>
    header.startsWith(`${AUTH_COOKIE_NAME}=`),
  )
  if (!cookie) {
    throw new Error(
      `Expected a Set-Cookie header for "${AUTH_COOKIE_NAME}", got: ${JSON.stringify(
        res.headers,
      )}`,
    )
  }
  return cookie
}

describe('Role authorization', function () {
  // eslint-disable-next-line @typescript-eslint/no-invalid-this
  this.timeout(30000)

  let app: App
  let rawClient: Client
  let makeToken: (role: string) => string

  before('setupApplication', async () => {
    ;({ app, rawClient, makeToken } = await setupApplication())
  })

  after(async () => {
    await app.stop()
  })

  const basePayload = {
    id: '1',
    name: 'test-user',
    email: 'test-user@local',
    role: Roles.ADMIN,
  }

  it('rejects operator requests to office/admin product reads with 403', async () => {
    await rawClient
      .get('/products')
      .set('Authorization', `Bearer ${makeToken(Roles.OPERATOR)}`)
      .expect(403)
  })

  it('rejects operator requests to through-product relations with 403', async () => {
    await rawClient
      .get('/purchases/999999/products')
      .set('Authorization', `Bearer ${makeToken(Roles.OPERATOR)}`)
      .expect(403)

    await rawClient
      .get('/payments/999999/products')
      .set('Authorization', `Bearer ${makeToken(Roles.OPERATOR)}`)
      .expect(403)
  })

  it('rejects operator requests to purchase extraction with 403', async () => {
    await rawClient
      .post('/purchases/extract')
      .set('Authorization', `Bearer ${makeToken(Roles.OPERATOR)}`)
      .expect(403)
  })

  it('rejects office requests to admin-only user deletion with 403', async () => {
    await rawClient
      .delete('/users/999999')
      .set('Authorization', `Bearer ${makeToken(Roles.OFFICE)}`)
      .expect(403)
  })

  it('rejects tokens with an unknown role with 403', async () => {
    await rawClient
      .get('/products')
      .set('Authorization', `Bearer ${makeToken('ghost')}`)
      .expect(403)
  })

  it('allows any authenticated role on /whoami', async () => {
    await rawClient
      .get('/whoami')
      .set('Authorization', `Bearer ${makeToken(Roles.OPERATOR)}`)
      .expect(200)
  })

  it('rejects requests without an Authorization header with 401', async () => {
    await rawClient.get('/products').expect(401)
  })

  it('rejects malformed Authorization headers with 401', async () => {
    await rawClient.get('/products').set('Authorization', 'Bearer').expect(401)
    await rawClient
      .get('/products')
      .set('Authorization', 'Basic abc123')
      .expect(401)
  })

  it('rejects expired tokens with 401', async () => {
    const expired = jwt.sign(basePayload, securityConfig.JWT_SECRET, {
      expiresIn: '-10s',
    })
    await rawClient
      .get('/products')
      .set('Authorization', `Bearer ${expired}`)
      .expect(401)
  })

  it('rejects tokens signed with a different secret with 401', async () => {
    const forged = jwt.sign(basePayload, 'not-the-real-secret', {
      expiresIn: '1h',
    })
    await rawClient
      .get('/products')
      .set('Authorization', `Bearer ${forged}`)
      .expect(401)
  })

  it('rejects garbage tokens with 401', async () => {
    await rawClient
      .get('/products')
      .set('Authorization', 'Bearer not.a.jwt')
      .expect(401)
  })

  describe('Cookie session (auth_token)', () => {
    const testEmail = `cookie-auth-${Date.now()}@local.test`
    const testPassword = 'Sup3rSecret!1'
    let userId: number | undefined

    before(async () => {
      const res = await rawClient
        .post('/users')
        .set('Authorization', `Bearer ${makeToken(Roles.ADMIN)}`)
        .send({
          name: 'Cookie Auth Test User',
          email: testEmail,
          password: testPassword,
          role: Roles.OPERATOR,
        })
        .expect(200)
      userId = res.body.id
    })

    after(async () => {
      if (userId == null) return
      await rawClient
        .delete(`/users/${userId}`)
        .set('Authorization', `Bearer ${makeToken(Roles.ADMIN)}`)
        .catch(() => undefined)
    })

    it('sign-in responds with { user } only (no token in the body) and sets an HttpOnly auth_token cookie', async () => {
      const res = await rawClient
        .post('/sign-in')
        .send({ email: testEmail, password: testPassword })
        .expect(200)

      expect(res.body).to.have.property('user')
      expect(res.body.user.email).to.equal(testEmail)
      expect(res.body).to.not.have.property('token')

      const sessionCookie = findSessionCookie(res)
      expect(sessionCookie).to.match(/HttpOnly/i)
      expect(sessionCookie).to.match(/SameSite=Lax/i)
      expect(sessionCookie).to.match(/Path=\//i)
    })

    it('authenticates /whoami using only the session cookie, with no Authorization header', async () => {
      const signInRes = await rawClient
        .post('/sign-in')
        .send({ email: testEmail, password: testPassword })
        .expect(200)

      const sessionCookie = findSessionCookie(signInRes)
      const cookiePair = sessionCookie.split(';')[0] // "auth_token=<value>"

      const whoAmIRes = await rawClient
        .get('/whoami')
        .set('Cookie', cookiePair)
        .expect(200)

      expect(whoAmIRes.body.email).to.equal(testEmail)
    })

    it('still authenticates /whoami via Authorization: Bearer when there is no cookie (fallback)', async () => {
      const res = await rawClient
        .get('/whoami')
        .set('Authorization', `Bearer ${makeToken(Roles.OPERATOR)}`)
        .expect(200)

      expect(res.body.role).to.equal(Roles.OPERATOR)
    })

    it('sign-out responds 204 and expires the session cookie (Max-Age=0)', async () => {
      const res = await rawClient.post('/sign-out').expect(204)

      const sessionCookie = findSessionCookie(res)
      expect(sessionCookie).to.match(/Max-Age=0/)
    })

    it('sign-out works even with an expired token, since it skips authentication', async () => {
      const expired = jwt.sign(basePayload, securityConfig.JWT_SECRET, {
        expiresIn: '-10s',
      })
      await rawClient
        .post('/sign-out')
        .set('Authorization', `Bearer ${expired}`)
        .expect(204)
    })
  })
})
