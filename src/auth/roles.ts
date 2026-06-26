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

/**
 * Role hierarchy as a rank: a higher-ranked role implicitly satisfies every
 * requirement a lower-ranked one does (admin ⊇ office ⊇ operator). This lets an
 * endpoint list only the MINIMUM role it needs (e.g. just OFFICE) instead of
 * repeating ADMIN on every decorator, and a new tier is one entry here rather
 * than a sweep of every `@requireRoles` (audit Finding M10).
 */
const ROLE_RANK: Record<Role, number> = {
  [Roles.ADMIN]: 3,
  [Roles.OFFICE]: 2,
  [Roles.OPERATOR]: 1,
}

/**
 * True when `userRole` meets at least one of `requiredRoles` directly or by
 * outranking it. An unknown user role never satisfies anything.
 */
export function roleSatisfies(
  userRole: string,
  requiredRoles: string[],
): boolean {
  const userRank = ROLE_RANK[userRole as Role]
  if (userRank == null) return false
  return requiredRoles.some(required => {
    const requiredRank = ROLE_RANK[required as Role]
    return requiredRank != null && userRank >= requiredRank
  })
}
