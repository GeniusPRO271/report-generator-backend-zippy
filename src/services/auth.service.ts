import { Service } from 'typedi'
import { SignJWT, jwtVerify } from 'jose'
import { eq, sql } from 'drizzle-orm'
import { LoginInput } from '../types/zod/auth'
import { UserRepository } from '../repositories/user.repository'
import { db } from '../db/connection'
import { user } from '../db/schema'

const ACCESS_TOKEN_EXP = '7d'
const REFRESH_TOKEN_EXP = '30d'
const SECRET = process.env.SESSION_SECRET
if (!SECRET) throw new Error('SESSION_SECRET must be set')

const ENCODED_SECRET = new TextEncoder().encode(SECRET)

@Service()
export class AuthService {
  constructor(private readonly userRepository: UserRepository) {}

  private async generateAccessToken(email: string, role: string) {
    return new SignJWT({ email, role })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(ACCESS_TOKEN_EXP)
      .sign(ENCODED_SECRET)
  }

  private async generateRefreshToken(email: string, role: string, tokenVersion: number) {
    return new SignJWT({ email, role, tokenVersion })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(REFRESH_TOKEN_EXP)
      .sign(ENCODED_SECRET)
  }

  async login(data: LoginInput) {
    const { email, password } = data

    const foundUser = await this.userRepository.findByEmail(email)
    if (!foundUser) throw new Error('Invalid credentials')
    if (!foundUser.isActive) throw new Error('Account is disabled')

    const valid = await Bun.password.verify(password, foundUser.passwordHash)
    if (!valid) throw new Error('Invalid credentials')

    // Bump tokenVersion to invalidate all existing refresh tokens (kicks other sessions)
    const [updated] = await db
      .update(user)
      .set({ tokenVersion: sql`${user.tokenVersion} + 1` })
      .where(eq(user.id, foundUser.id))
      .returning({ tokenVersion: user.tokenVersion })

    const newTokenVersion = updated.tokenVersion

    const accessToken = await this.generateAccessToken(email, foundUser.role)
    const refreshToken = await this.generateRefreshToken(email, foundUser.role, newTokenVersion)

    return {
      accessToken,
      refreshToken,
      expiresIn: 15 * 60,
      email,
      role: foundUser.role,
    }
  }

  async refreshToken(refreshToken: string) {
    try {
      const { payload } = await jwtVerify(refreshToken, ENCODED_SECRET, {
        algorithms: ['HS256'],
      })

      const email = (payload as any).email as string
      const tokenVersion = (payload as any).tokenVersion as number | undefined

      // Re-fetch user to get current role and tokenVersion
      const foundUser = await this.userRepository.findByEmail(email)
      if (!foundUser || !foundUser.isActive) throw new Error('User not found or disabled')

      // Reject if tokenVersion doesn't match (another login invalidated this session)
      if (tokenVersion !== foundUser.tokenVersion) {
        throw new Error('Session invalidated by a newer login')
      }

      const newAccessToken = await this.generateAccessToken(email, foundUser.role)

      return {
        accessToken: newAccessToken,
        expiresIn: 15 * 60,
        email,
        role: foundUser.role,
      }
    } catch (err) {
      throw new Error('Invalid refresh token')
    }
  }

  async verifyToken(token: string) {
    const { payload } = await jwtVerify(token, ENCODED_SECRET, {
      algorithms: ['HS256'],
    })
    return payload as { email: string; role: string }
  }
}
