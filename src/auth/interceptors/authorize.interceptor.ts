import {
  globalInterceptor,
  Interceptor,
  InvocationContext,
  InvocationResult,
  Provider,
  ValueOrPromise,
} from '@loopback/core';
import {HttpErrors} from '@loopback/rest';
import {SecurityBindings, UserProfile} from '@loopback/security';
import {REQUIRED_ROLES_METADATA} from '../decorators/auth-decorators';

/**
 * Interceptor global para manejo de autorización basada en roles
 */
@globalInterceptor('', {tags: {name: 'authorize'}})
export class AuthorizeInterceptor implements Provider<Interceptor> {
  /*
  constructor() {}
  */

  /**
   * This method is used by LoopBack context to produce an interceptor function
   * for the binding.
   *
   * @returns An interceptor function
   */
  value() {
    return this.intercept.bind(this);
  }

  /**
   * The logic to intercept an invocation
   * @param invocationCtx - Invocation context
   * @param next - A function to invoke next interceptor or the target method
   */
  async intercept(
    invocationCtx: InvocationContext,
    next: () => ValueOrPromise<InvocationResult>,
  ) {
    // Verificar si el método requiere roles específicos
    const requiredRoles = this.getRequiredRoles(invocationCtx);

    if (requiredRoles && requiredRoles.length > 0) {
      // Obtener el usuario actual del contexto de seguridad
      const user = await invocationCtx.get(SecurityBindings.USER, {
        optional: true,
      });

      if (!user) {
        throw new HttpErrors.Unauthorized('User not authenticated');
      }

      // Verificar si el usuario tiene alguno de los roles requeridos
      const userProfile = user as UserProfile & {role?: string};
      if (!userProfile.role || !requiredRoles.includes(userProfile.role)) {
        throw new HttpErrors.Forbidden(
          `Access denied. Required roles: ${requiredRoles.join(', ')}. Your role: ${userProfile.role ?? 'none'}`
        );
      }
    }

    const result = await next();
    return result;
  }

  /**
   * Obtiene los roles requeridos de los metadatos del método
   */
  private getRequiredRoles(invocationCtx: InvocationContext): string[] | undefined {
    if (
      !invocationCtx.target ||
      !invocationCtx.methodName
    ) {
      return undefined;
    }

    return Reflect.getMetadata(
      REQUIRED_ROLES_METADATA,
      invocationCtx.target,
      invocationCtx.methodName,
    );
  }
}
