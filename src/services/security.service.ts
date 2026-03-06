import { BindingScope, injectable } from '@loopback/core'
import { repository } from '@loopback/repository'
import { HttpErrors } from '@loopback/rest'
import { securityConfig } from '../config/security'
import { Credentials, LoginResult, User } from '../models'
import { UserRepository } from '../repositories'
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')

@injectable({ scope: BindingScope.TRANSIENT })
export class SecurityService {
  constructor(
    @repository(UserRepository)
    public userRepository: UserRepository,
  ) {}

  /**
   * Hash a password using bcrypt
   * @param password Password to hash
   * @returns Hashed password
   */
  async hashPassword(password: string): Promise<string> {
    const salt = await bcrypt.genSalt(12)
    return bcrypt.hash(password, salt)
  }

  /**
   * Verify if the provided password matches the hashed password
   * @param password Password to verify
   * @param hashedPassword Hashed password to compare against
   * @returns True if passwords match, false otherwise
   */
  async verifyPassword(
    password: string,
    hashedPassword: string,
  ): Promise<boolean> {
    return bcrypt.compare(password, hashedPassword)
  }

  /**
   * User login
   * @param credentials User credentials
   * @returns User instance or null if authentication fails
   */
  async login(credentials: Credentials): Promise<LoginResult> {
    const foundUser = await this.userRepository.findOne({
      where: {
        email: credentials.email,
      },
    })
    if (!foundUser) {
      throw new HttpErrors.Unauthorized('Invalid email or password')
    }
    const isPasswordValid = await this.verifyPassword(
      credentials.password,
      foundUser.password,
    )
    if (!isPasswordValid) {
      throw new HttpErrors.Unauthorized('Invalid email or password')
    }
    foundUser.password = ''
    const token = this.generateToken(foundUser)
    return new LoginResult({
      user: foundUser,
      token: token,
    })
  }

  /**
   * Generate a JWT token for the user
   * @param user User instance
   * @returns JWT token
   * @description Uses the JWT secret from the environment variables to sign the token
   */
  generateToken(user: User): string {
    const secret = securityConfig.JWT_SECRET ?? 'default_secret'
    const token = jwt.sign(
      {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
      },
      secret,
      {
        expiresIn: '1d',
      },
    )
    return token
  }

  /**
   * Verify the JWT token and return the user information
   * @param token JWT token
   * @returns User instance
   * @throws Unauthorized error if the token is invalid
   */
  verifyToken(token: string): User {
    try {
      const secret = securityConfig.JWT_SECRET ?? 'default_secret'
      return jwt.verify(token, secret) as User
    } catch (error: unknown) {
      console.error('Error verifying token:', error)
      if (error instanceof jwt.TokenExpiredError) {
        throw new HttpErrors.Unauthorized('Token has expired')
      } else if (error instanceof jwt.JsonWebTokenError) {
        throw new HttpErrors.Unauthorized('Invalid token format')
      }
      throw new HttpErrors.Unauthorized('Invalid token')
    }
  }

  /**
   * Get the role from the token
   * @param token JWT token
   * @returns User role
   * @throws Unauthorized error if the token is invalid
   */
  getRoleFromToken(token: string): string {
    return this.verifyToken(token).role
  }
}
