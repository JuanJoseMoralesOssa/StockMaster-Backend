import { expect } from '@loopback/testlab'
import { isRole, Roles, roleSatisfies } from '../../auth/roles'

describe('isRole', () => {
  it('accepts each canonical role', () => {
    expect(isRole(Roles.ADMIN)).to.be.true()
    expect(isRole(Roles.OFFICE)).to.be.true()
    expect(isRole(Roles.OPERATOR)).to.be.true()
  })

  it('rejects an unknown or misspelled role', () => {
    expect(isRole('Admin')).to.be.false()
    expect(isRole('superuser')).to.be.false()
    expect(isRole('')).to.be.false()
  })

  it('rejects non-strings', () => {
    expect(isRole(undefined)).to.be.false()
    expect(isRole(null)).to.be.false()
    expect(isRole(1)).to.be.false()
  })

  it('rejects Object prototype members', () => {
    // A membership test written as `value in ROLE_RANK` walks the prototype
    // chain, so these would come back as valid roles.
    expect(isRole('constructor')).to.be.false()
    expect(isRole('toString')).to.be.false()
  })
})

/**
 * The role hierarchy is a SECURITY decision: `roleSatisfies` is the single
 * predicate the global AuthorizeInterceptor consults before letting any request
 * through. A flipped comparison here silently grants an operator every
 * office/admin endpoint, so the rank order and the unknown-role rejection are
 * pinned by table tests rather than left to review.
 */
describe('roleSatisfies', () => {
  const cases: Array<{
    userRole: string
    requiredRoles: string[]
    expected: boolean
    why: string
  }> = [
    {
      userRole: Roles.ADMIN,
      requiredRoles: [Roles.ADMIN],
      expected: true,
      why: 'exact match',
    },
    {
      userRole: Roles.ADMIN,
      requiredRoles: [Roles.OFFICE],
      expected: true,
      why: 'admin outranks office',
    },
    {
      userRole: Roles.ADMIN,
      requiredRoles: [Roles.OPERATOR],
      expected: true,
      why: 'admin outranks operator',
    },
    {
      userRole: Roles.OFFICE,
      requiredRoles: [Roles.OFFICE],
      expected: true,
      why: 'exact match',
    },
    {
      userRole: Roles.OFFICE,
      requiredRoles: [Roles.OPERATOR],
      expected: true,
      why: 'office outranks operator',
    },
    {
      userRole: Roles.OFFICE,
      requiredRoles: [Roles.ADMIN],
      expected: false,
      why: 'office does NOT reach admin',
    },
    {
      userRole: Roles.OPERATOR,
      requiredRoles: [Roles.OPERATOR],
      expected: true,
      why: 'exact match',
    },
    {
      userRole: Roles.OPERATOR,
      requiredRoles: [Roles.OFFICE],
      expected: false,
      why: 'operator does NOT reach office',
    },
    {
      userRole: Roles.OPERATOR,
      requiredRoles: [Roles.ADMIN],
      expected: false,
      why: 'operator does NOT reach admin',
    },
  ]

  for (const { userRole, requiredRoles, expected, why } of cases) {
    it(`${expected ? 'grants' : 'denies'} ${userRole} against [${requiredRoles.join(', ')}] (${why})`, () => {
      expect(roleSatisfies(userRole, requiredRoles)).to.equal(expected)
    })
  }

  it('grants when the user outranks ANY one of several required roles', () => {
    expect(
      roleSatisfies(Roles.OFFICE, [Roles.ADMIN, Roles.OPERATOR]),
    ).to.be.true()
  })

  it('denies an unknown user role, even against the lowest requirement', () => {
    // A role that is not in the rank table can never satisfy anything: a typo or
    // a stale JWT role must fail closed, not fall through to the weakest tier.
    expect(roleSatisfies('superuser', [Roles.OPERATOR])).to.be.false()
  })

  it('denies a JWT role that names an Object prototype member', () => {
    expect(roleSatisfies('constructor', [Roles.OPERATOR])).to.be.false()
  })

  it('denies an empty role', () => {
    expect(roleSatisfies('', [Roles.OPERATOR])).to.be.false()
  })

  it('denies when no roles are required at all', () => {
    // An endpoint declaring @requireRoles() with no roles grants nobody; the
    // "any authenticated user" case is a separate flag, not an empty list.
    expect(roleSatisfies(Roles.ADMIN, [])).to.be.false()
  })

  it('ignores an unknown required role instead of treating it as a wildcard', () => {
    expect(roleSatisfies(Roles.ADMIN, ['nonexistent'])).to.be.false()
    expect(
      roleSatisfies(Roles.ADMIN, ['nonexistent', Roles.OFFICE]),
    ).to.be.true()
  })
})
