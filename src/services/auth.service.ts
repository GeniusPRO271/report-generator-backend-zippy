import { Service } from 'typedi'
import { SignJWT, jwtVerify } from 'jose'
import { LoginInput } from '../types/zod/auth'
import { UserRepository } from '../repositories/user.repository'

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

  private async generateRefreshToken(email: string, role: string) {
    return new SignJWT({ email, role })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(REFRESH_TOKEN_EXP)
      .sign(ENCODED_SECRET)
  }

  async login(data: LoginInput) {
    const { email, password } = data

    const user = await this.userRepository.findByEmail(email)
    if (!user) throw new Error('Invalid credentials')
    if (!user.isActive) throw new Error('Account is disabled')

    const valid = await Bun.password.verify(password, user.passwordHash)
    if (!valid) throw new Error('Invalid credentials')

    const accessToken = await this.generateAccessToken(email, user.role)
    const refreshToken = await this.generateRefreshToken(email, user.role)

    return {
      accessToken,
      refreshToken,
      expiresIn: 15 * 60,
      email,
      role: user.role,
    }
  }

  async refreshToken(refreshToken: string) {
    try {
      const { payload } = await jwtVerify(refreshToken, ENCODED_SECRET, {
        algorithms: ['HS256'],
      })

      const email = (payload as any).email as string

      // Re-fetch user to get current role (in case it changed)
      const user = await this.userRepository.findByEmail(email)
      if (!user || !user.isActive) throw new Error('User not found or disabled')

      const newAccessToken = await this.generateAccessToken(email, user.role)

      return {
        accessToken: newAccessToken,
        expiresIn: 15 * 60,
        email,
        role: user.role,
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
