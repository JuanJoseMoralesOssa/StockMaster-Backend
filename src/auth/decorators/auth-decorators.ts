import {authenticate} from '@loopback/authentication';

// Clave constante para metadatos de roles para evitar typos
const REQUIRED_ROLES_METADATA = 'required-roles';

/**
 * Decorador para requerir autenticación JWT
 */
export const requireAuth = () => authenticate('jwt');

/**
 * Decorador para requerir roles específicos
 * @param roles - Array de roles permitidos
 */
export const requireRoles = (...roles: string[]) => {
  return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
    // Agregar metadata de roles requeridos usando constante
    Reflect.defineMetadata(REQUIRED_ROLES_METADATA, roles, target, propertyKey);
    return descriptor;
  };
};

/**
 * Decorador combinado para autenticación y autorización
 * @param roles - Array de roles permitidos
 */
export const requireAuthAndRoles = (...roles: string[]) => {
  return (target: any, propertyKey: string, descriptor: PropertyDescriptor) => {
    // Aplicar autenticación JWT
    authenticate('jwt')(target, propertyKey, descriptor);
    // Agregar metadata de roles usando constante
    Reflect.defineMetadata(REQUIRED_ROLES_METADATA, roles, target, propertyKey);
    return descriptor;
  };
};

// Exportar la constante para uso en el interceptor
export {REQUIRED_ROLES_METADATA};
