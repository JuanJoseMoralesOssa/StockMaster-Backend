export type CorsOriginCallback = (
  err: Error | null,
  allow?: boolean | string,
) => void

export type CorsOriginHandler = (
  origin: string | undefined,
  callback: CorsOriginCallback,
) => void

function parseAllowedOrigins(rawValue?: string): string[] {
  if (!rawValue) return []

  return rawValue
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean)
    .map(origin => origin.replace(/\/$/, ''))
}

function isLocalhostOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin)
    return ['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(hostname)
  } catch {
    return false
  }
}

export function buildCorsOrigin(env: NodeJS.ProcessEnv = process.env): CorsOriginHandler {
  const configuredOrigins = parseAllowedOrigins(env.FRONTEND_ORIGIN)
  const defaultDevOrigins = [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:5174',
    'http://127.0.0.1:5174',
    'http://localhost:5175',
    'http://127.0.0.1:5175',
  ]
  const allowedOrigins = configuredOrigins.length
    ? configuredOrigins
    : env.NODE_ENV === 'production'
      ? []
      : defaultDevOrigins

  return (origin, callback) => {
    if (!origin) {
      callback(null, true)
      return
    }

    if (allowedOrigins.includes(origin)) {
      callback(null, true)
      return
    }

    if (env.NODE_ENV !== 'production' && isLocalhostOrigin(origin)) {
      callback(null, true)
      return
    }

    callback(new Error(`Origin ${origin} is not allowed by CORS`))
  }
}
