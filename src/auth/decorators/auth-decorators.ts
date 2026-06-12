import { authenticate } from '@loopback/authentication'
import {
  ClassDecoratorFactory,
  MetadataAccessor,
  MethodDecoratorFactory,
} from '@loopback/core'

/**
 * Metadatos de autorización por roles. Se almacenan vía las factorías de
 * decoradores de LoopBack (no Reflect crudo) para que el interceptor pueda
 * leerlos de forma determinista con MetadataInspector.
 */
export interface RolesMetadata {
  /** Roles permitidos. Ignorado si `anyAuthenticated` es true. */
  allowedRoles: string[]
  /** Permite a cualquier usuario autenticado, sin importar su rol. */
  anyAuthenticated?: boolean
}

export const ROLES_METHOD_KEY = MetadataAccessor.create<
  RolesMetadata,
  MethodDecorator
>('authorization:method-roles')

export const ROLES_CLASS_KEY = MetadataAccessor.create<
  RolesMetadata,
  ClassDecorator
>('authorization:class-roles')

function defineRolesMetadata(metadata: RolesMetadata) {
  return (
    target: Object,
    propertyKey?: string | symbol,
    descriptor?: PropertyDescriptor,
  ): void => {
    if (propertyKey === undefined) {
      // Decorador de clase
      ClassDecoratorFactory.createDecorator(ROLES_CLASS_KEY, metadata, {
        decoratorName: '@requireRoles',
      })(target as Function)
    } else {
      // Decorador de método
      MethodDecoratorFactory.createDecorator(ROLES_METHOD_KEY, metadata, {
        decoratorName: '@requireRoles',
      })(target, propertyKey as string, descriptor as PropertyDescriptor)
    }
  }
}

/**
 * Decorador para requerir autenticación JWT
 */
export const requireAuth = () => authenticate('jwt')

/**
 * Decorador para requerir roles específicos. Funciona a nivel de MÉTODO o de
 * CLASE; un decorador a nivel de método sobrescribe el de la clase.
 *
 * El AuthorizeInterceptor aplica negación por defecto: un método de
 * controlador sin `@requireRoles(...)`, sin `@allowAuthenticated()` y sin
 * `@authenticate.skip()` se rechaza con 403.
 */
export const requireRoles = (...roles: string[]) =>
  defineRolesMetadata({ allowedRoles: roles })

/**
 * Permite el acceso a cualquier usuario autenticado sin exigir un rol
 * concreto (p.ej. /whoami). Sigue exigiendo un JWT válido.
 */
export const allowAuthenticated = () =>
  defineRolesMetadata({ allowedRoles: [], anyAuthenticated: true })
