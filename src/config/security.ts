// Guarantee .env is loaded before reading env vars (see config/database.ts).
import 'dotenv/config'

const NODE_ENV = process.env.NODE_ENV ?? 'development'
const rawJwtSecret = process.env.JWT_SECRET
const rawJwtExpiration = process.env.JWT_EXPIRATION

// En producción, exigir explícitamente que se configure JWT_SECRET
if (!rawJwtSecret && NODE_ENV === 'production') {
  throw new Error(
    'JWT_SECRET must be set in environment variables when NODE_ENV=production',
  )
}

if (!rawJwtSecret && NODE_ENV !== 'production' && NODE_ENV !== 'test') {
  console.warn(
    'JWT_SECRET is not set. Using an insecure development-only default secret.',
  )
}

/**
 * Convierte un valor de expiración tipo jsonwebtoken ("1h", "7d", "30m", "45s",
 * o segundos puros como "3600") a segundos, para usarlo como `Max-Age` de la
 * cookie de sesión. Debe alinearse con lo que `jwt.sign({ expiresIn })` hace
 * con el mismo string en `SecurityService.generateToken`; si cambia el formato
 * soportado ahí, actualizar este parser también.
 */
export function parseExpirationToSeconds(expiration: string): number {
  const match = /^(\d+(?:\.\d+)?)\s*(s|m|h|d|w)?$/i.exec(expiration.trim())

  if (!match) {
    throw new Error(
      `JWT_EXPIRATION inválido: "${expiration}". Usa un número de segundos o un sufijo s/m/h/d/w (ej. "1d", "12h").`,
    )
  }

  const value = Number(match[1])
  const unit = (match[2] ?? 's').toLowerCase()

  const unitToSeconds: Record<string, number> = {
    s: 1,
    m: 60,
    h: 60 * 60,
    d: 60 * 60 * 24,
    w: 60 * 60 * 24 * 7,
  }

  return Math.round(value * unitToSeconds[unit])
}

const JWT_EXPIRATION = rawJwtExpiration ?? '1d'

export const securityConfig = {
  // En desarrollo se permite un valor por defecto; en producción es obligatorio configurarlo
  JWT_SECRET: rawJwtSecret ?? 'default_secret',
  // Expiración por defecto: 1 día, a menos que se provea en el .env
  JWT_EXPIRATION,
  // Misma expiración, en segundos, para usar como Max-Age de la cookie de sesión.
  JWT_EXPIRATION_SECONDS: parseExpirationToSeconds(JWT_EXPIRATION),
}
