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

export const securityConfig = {
  // En desarrollo se permite un valor por defecto; en producción es obligatorio configurarlo
  JWT_SECRET: rawJwtSecret ?? 'default_secret',
  // Expiración por defecto: 1 día, a menos que se provea en el .env
  JWT_EXPIRATION: rawJwtExpiration ?? '1d',
}
