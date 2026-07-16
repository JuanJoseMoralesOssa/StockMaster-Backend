import { securityConfig } from '../config/security'

/**
 * Name of the httpOnly cookie that carries the JWT session token.
 */
export const AUTH_COOKIE_NAME = 'auth_token'

/**
 * `Secure` only in production (or when explicitly forced via COOKIE_SECURE,
 * useful to test over HTTPS locally/behind a proxy before NODE_ENV flips).
 *
 * CSRF note: this cookie relies on SameSite=Lax + the restricted CORS origin
 * list in `src/index.ts` (credentials: true, explicit allow-list) instead of
 * a CSRF token. That pair is enough for this app: the Vite dev frontend
 * (localhost:5173) and the API (localhost:3000) are "same-site" for
 * SameSite purposes — the port is not part of the site definition — so
 * Lax already withholds the cookie from cross-site requests, and CORS
 * blocks any other origin from reading the response even if it could
 * trigger a request with credentials.
 */
function isSecureCookie(): boolean {
  return (
    process.env.NODE_ENV === 'production' ||
    process.env.COOKIE_SECURE === 'true'
  )
}

function cookieAttributes(maxAgeSeconds: number): string {
  const attrs = [
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ]
  if (isSecureCookie()) attrs.push('Secure')
  return attrs.join('; ')
}

/**
 * Builds the `Set-Cookie` header value that starts a session: Max-Age matches
 * `JWT_EXPIRATION` (see config/security.ts) so the cookie never outlives, or
 * expires before, the token it carries.
 */
export function buildAuthCookie(token: string): string {
  return `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}; ${cookieAttributes(
    securityConfig.JWT_EXPIRATION_SECONDS,
  )}`
}

/**
 * Builds the `Set-Cookie` header value that clears the session cookie
 * (Max-Age=0), using the same name/attributes so the browser matches it.
 */
export function buildClearAuthCookie(): string {
  return `${AUTH_COOKIE_NAME}=; ${cookieAttributes(0)}`
}

/**
 * Extracts the auth token from a raw `Cookie` request header, parsed by hand
 * (split on `;`, trim, decodeURIComponent) to avoid adding a dependency like
 * `cookie-parser` for a single cookie name.
 */
export function extractAuthTokenFromCookieHeader(
  cookieHeader: string | undefined,
): string | undefined {
  if (!cookieHeader) return undefined

  for (const rawPair of cookieHeader.split(';')) {
    const separatorIndex = rawPair.indexOf('=')
    if (separatorIndex === -1) continue

    const name = rawPair.slice(0, separatorIndex).trim()
    if (name !== AUTH_COOKIE_NAME) continue

    const rawValue = rawPair.slice(separatorIndex + 1).trim()
    if (!rawValue) return undefined

    try {
      return decodeURIComponent(rawValue)
    } catch {
      return rawValue
    }
  }

  return undefined
}
