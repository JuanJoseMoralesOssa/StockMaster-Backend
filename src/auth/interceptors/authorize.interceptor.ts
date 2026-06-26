import { AuthenticationBindings } from '@loopback/authentication'
import {
  globalInterceptor,
  Interceptor,
  InvocationContext,
  InvocationResult,
  MetadataInspector,
  Provider,
  ValueOrPromise,
} from '@loopback/core'
import { HttpErrors } from '@loopback/rest'
import { SecurityBindings, UserProfile } from '@loopback/security'
import {
  ROLES_CLASS_KEY,
  ROLES_METHOD_KEY,
  RolesMetadata,
} from '../decorators/auth-decorators'
import { roleSatisfies } from '../roles'

/**
 * Controladores provistos por el framework (no viven en src/controllers) que
 * no declaran roles. Siguen protegidos por JWT vía la autenticación global;
 * aquí solo se exime el requisito de rol. Mantener esta lista mínima.
 */
const FRAMEWORK_CONTROLLERS_WITHOUT_ROLES = new Set(['ExplorerController'])

/**
 * Interceptor global de autorización basada en roles.
 *
 * Política de negación por defecto: todo método de controlador debe declarar
 * `@requireRoles(...)` (en el método o en la clase), `@allowAuthenticated()`,
 * o ser público vía `@authenticate.skip()`. Un endpoint sin política se
 * rechaza con 403 en lugar de quedar abierto a cualquier usuario autenticado.
 */
@globalInterceptor('', { tags: { name: 'authorize' } })
export class AuthorizeInterceptor implements Provider<Interceptor> {
  value() {
    return this.intercept.bind(this)
  }

  async intercept(
    invocationCtx: InvocationContext,
    next: () => ValueOrPromise<InvocationResult>,
  ) {
    const rolesMetadata = this.getRolesMetadata(invocationCtx)

    if (!rolesMetadata) {
      // Sin política declarada: solo se permite si el endpoint es público
      // (@authenticate.skip → METADATA resuelve a undefined), o si es un
      // controlador del framework. Las invocaciones que no son rutas de
      // controlador tampoco traen METADATA y pasan.
      if (
        FRAMEWORK_CONTROLLERS_WITHOUT_ROLES.has(
          this.getControllerName(invocationCtx),
        )
      ) {
        return next()
      }
      const authMetadata = await invocationCtx.get(
        AuthenticationBindings.METADATA,
        { optional: true },
      )
      if (!authMetadata) {
        return next()
      }
      throw new HttpErrors.Forbidden(
        'Access denied. No role policy is defined for this endpoint.',
      )
    }

    const user = await invocationCtx.get(SecurityBindings.USER, {
      optional: true,
    })
    if (!user) {
      throw new HttpErrors.Unauthorized('User not authenticated')
    }

    if (!rolesMetadata.anyAuthenticated) {
      const userProfile = user as UserProfile & { role?: string }
      const requiredRoles = rolesMetadata.allowedRoles
      // Hierarchy-aware: a higher role (admin) satisfies a lower requirement
      // (office) without being listed explicitly. See roleSatisfies / ROLE_RANK.
      if (
        !userProfile.role ||
        !roleSatisfies(userProfile.role, requiredRoles)
      ) {
        throw new HttpErrors.Forbidden(
          `Access denied. Required roles: ${requiredRoles.join(', ')}. Your role: ${userProfile.role ?? 'none'}`,
        )
      }
    }

    return next()
  }

  private getControllerName(invocationCtx: InvocationContext): string {
    const target = invocationCtx.target as object | Function | undefined
    if (!target) return ''
    return typeof target === 'function'
      ? target.name
      : (target.constructor?.name ?? '')
  }

  /**
   * Lee la política de roles: primero la del método y, si no hay, la de la
   * clase. Usa MetadataInspector (la API soportada de LB4) en lugar de
   * recorrer manualmente candidatos con Reflect.
   */
  private getRolesMetadata(
    invocationCtx: InvocationContext,
  ): RolesMetadata | undefined {
    const target = invocationCtx.target as object
    if (!target || !invocationCtx.methodName) {
      return undefined
    }

    const methodMetadata = MetadataInspector.getMethodMetadata<RolesMetadata>(
      ROLES_METHOD_KEY,
      target,
      invocationCtx.methodName,
    )
    if (methodMetadata) return methodMetadata

    const ctor =
      typeof target === 'function'
        ? (target as Function)
        : (target.constructor as Function)
    return MetadataInspector.getClassMetadata<RolesMetadata>(
      ROLES_CLASS_KEY,
      ctor,
    )
  }
}
