/**
 * Canonical role identifiers. Must stay in sync with the frontend enum
 * (`my-inventory/src/enums/Roles.ts`) and the value stored in the JWT payload.
 *
 * NOTE: OPERATOR currently has no endpoint grants — every controller requires
 * OFFICE/ADMIN (or ADMIN), so an operator can only sign in and call /whoami.
 * Its intended permission set is a pending product decision; grant access by
 * adding it to the relevant `@requireRoles(...)` decorators when defined.
 */
export const Roles = {
  ADMIN: 'admin',
  OFFICE: 'office',
  OPERATOR: 'operator',
} as const

export type Role = (typeof Roles)[keyof typeof Roles]
