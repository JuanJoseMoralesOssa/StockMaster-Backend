import { BindingScope, injectable } from '@loopback/core'
import { repository } from '@loopback/repository'
import { HttpErrors } from '@loopback/rest'
import * as bcrypt from 'bcryptjs'
import * as jwt from 'jsonwebtoken'
import { securityConfig } from '../config/security'
import { Credentials, LoginResult, User } from '../models'
import { TokenPayload } from '../models/types/token-payload.type'
import { UserRepository } from '../repositories'

@injectable({ scope: BindingScope.TRANSIENT })
export class SecurityService {
  constructor(
    @repository(UserRepository)
    public userRepository: UserRepository,
  ) {}

  async hashPassword(password: string): Promise<string> {
    const salt = await bcrypt.genSalt(12)
    return bcrypt.hash(password, salt)
  }

  async verifyPassword(
    password: string,
    hashedPassword: string,
  ): Promise<boolean> {
    return bcrypt.compare(password, hashedPassword)
  }

  async login(credentials: Credentials): Promise<LoginResult> {
    const foundUser = await this.userRepository.findOne({
      where: { email: credentials.email },
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

    const token = this.generateToken(foundUser)

    // Evitar que el hash viaje al cliente
    foundUser.password = ''

    return new LoginResult({
      user: foundUser,
      token,
    })
  }

  generateToken(user: User): string {
    const secret = securityConfig.JWT_SECRET
    const payload: TokenPayload = {
      id: user.id!.toString(),
      name: user.name,
      email: user.email,
      role: user.role,
    }

    return jwt.sign(payload, secret, {
      expiresIn: securityConfig.JWT_EXPIRATION as jwt.SignOptions['expiresIn'],
    })
  }

  verifyToken(token: string): TokenPayload {
    try {
      const secret = securityConfig.JWT_SECRET
      return jwt.verify(token, secret) as TokenPayload
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

  getRoleFromToken(token: string): string {
    return this.verifyToken(token).role
  }
}
