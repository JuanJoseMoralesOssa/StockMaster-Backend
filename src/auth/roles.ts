/**
 * Canonical role identifiers. Must stay in sync with the frontend enum
 * (`my-inventory/src/enums/Roles.ts`) and the value stored in the JWT payload.
 */
export const Roles = {
  ADMIN: 'admin',
  OFFICE: 'office',
  OPERATOR: 'operator',
} as const

export type Role = (typeof Roles)[keyof typeof Roles]
