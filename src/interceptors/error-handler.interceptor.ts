import {
  globalInterceptor,
  Interceptor,
  InvocationContext,
  InvocationResult,
  Provider,
  ValueOrPromise,
} from '@loopback/core'
import { HttpErrors } from '@loopback/rest'
import {
  DB_CONSTRAINTS,
  DomainError,
  PG_ERROR_CODES,
  USER_MESSAGES,
} from '../errors'

type ErrorWithStatusCode = {
  statusCode: number
}

type ErrorWithCode = {
  code: string
}

type ErrorWithConstraint = {
  constraint?: string
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

function getConstraint(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  return (error as ErrorWithConstraint).constraint
}

/**
 * Interceptor global para normalizar y estructurar bien los errores de la aplicación
 */
@globalInterceptor('', { tags: { name: 'errorHandler' } })
export class ErrorHandlerInterceptor implements Provider<Interceptor> {
  value() {
    return this.intercept.bind(this)
  }

  private toHttpError(error: DomainError): HttpErrors.HttpError {
    switch (error.kind) {
      case 'validation':
        return new HttpErrors.BadRequest(error.message)
      case 'not_found':
        return new HttpErrors.NotFound(error.message)
      case 'conflict':
        return new HttpErrors.Conflict(error.message)
      case 'forbidden':
        return new HttpErrors.Forbidden(error.message)
      case 'timeout':
        return new HttpErrors.RequestTimeout(error.message)
      case 'rate_limited':
        return new HttpErrors.TooManyRequests(error.message)
      case 'unprocessable':
        return new HttpErrors.UnprocessableEntity(error.message)
    }
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

      // Errores de dominio (HTTP-agnósticos): única frontera donde se decide el
      // status HTTP a partir de su `kind`. Permite que servicios, helpers SQL y
      // utilidades puras no dependan de @loopback/rest.
      if (error instanceof DomainError) {
        throw this.toHttpError(error)
      }

      // Convertir EntityNotFoundError genérico de la Base de Datos a 404 HTTP
      if (hasCode(error, 'ENTITY_NOT_FOUND')) {
        throw new HttpErrors.NotFound(
          error instanceof Error ? error.message : 'Entity not found',
        )
      }

      if (hasCode(error, PG_ERROR_CODES.CHECK_VIOLATION)) {
        if (getConstraint(error) === DB_CONSTRAINTS.PRODUCT_BALANCE_MIN) {
          throw new HttpErrors.Conflict(USER_MESSAGES.INSUFFICIENT_BALANCE)
        }
        throw new HttpErrors.UnprocessableEntity(USER_MESSAGES.DATA_CONSTRAINT)
      }

      if (hasCode(error, PG_ERROR_CODES.FOREIGN_KEY_VIOLATION)) {
        throw new HttpErrors.Conflict(USER_MESSAGES.RELATED_RECORDS)
      }

      if (hasCode(error, PG_ERROR_CODES.UNIQUE_VIOLATION)) {
        throw new HttpErrors.Conflict(USER_MESSAGES.DUPLICATE_RECORD)
      }

      // Fallos transitorios de PostgreSQL (deadlock entre transacciones que
      // ajustan balance de productos en orden opuesto, o fallo de
      // serialización): son reintetables — 409 con mensaje de reintento, no
      // un 500 opaco de "contacta a soporte".
      if (
        hasCode(error, PG_ERROR_CODES.DEADLOCK_DETECTED) ||
        hasCode(error, PG_ERROR_CODES.SERIALIZATION_FAILURE)
      ) {
        throw new HttpErrors.Conflict(USER_MESSAGES.RETRYABLE_CONFLICT)
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
      throw new HttpErrors.InternalServerError(USER_MESSAGES.UNEXPECTED)
    }
  }
}
