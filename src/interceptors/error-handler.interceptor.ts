import {
  globalInterceptor,
  Interceptor,
  InvocationContext,
  InvocationResult,
  Provider,
  ValueOrPromise,
} from '@loopback/core'
import { HttpErrors } from '@loopback/rest'

type ErrorWithStatusCode = {
  statusCode: number
}

type ErrorWithCode = {
  code: string
}

function hasStatusCode(error: unknown): error is ErrorWithStatusCode {
  return (
    typeof error === 'object' &&
    error !== null &&
    'statusCode' in error &&
    typeof (error as { statusCode?: unknown }).statusCode === 'number'
  )
}

function hasCode(error: unknown, code: string): error is ErrorWithCode {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === code
  )
}

/**
 * Interceptor global para normalizar y estructurar bien los errores de la aplicación
 */
@globalInterceptor('', { tags: { name: 'errorHandler' } })
export class ErrorHandlerInterceptor implements Provider<Interceptor> {
  value() {
    return this.intercept.bind(this)
  }

  async intercept(
    invocationCtx: InvocationContext,
    next: () => ValueOrPromise<InvocationResult>,
  ) {
    try {
      const result = await next()
      return result
    } catch (error: unknown) {
      // 1. Errores HTTP conocidos (ya lanzados como HttpErrors) los dejamos pasar
      if (error instanceof HttpErrors.HttpError || hasStatusCode(error)) {
        throw error
      }

      // Convertir EntityNotFoundError genérico de la Base de Datos a 404 HTTP
      if (hasCode(error, 'ENTITY_NOT_FOUND')) {
        throw new HttpErrors.NotFound(
          error instanceof Error ? error.message : 'Entity not found',
        )
      }

      // 2. Loggear errores graves que no controlamos para la trazabilidad interna
      console.error(
        `[Unhandled Error] en ${invocationCtx.targetName}: `,
        error instanceof Error ? error.message : error,
      )
      if (process.env.NODE_ENV !== 'production') {
        console.error(error) // Trazas completas solo en local
      }

      // 3. Empaquetarlo en un 500 para el cliente evitando fugar stack traces sensibles
      throw new HttpErrors.InternalServerError(
        'An unexpected error occurred. Please contact support.',
      )
    }
  }
}
