import { Service } from 'typedi'
import { SignJWT, jwtVerify } from 'jose'
import { LoginInput } from '../types/zod/auth'

const ACCESS_TOKEN_EXP = '7d'
const REFRESH_TOKEN_EXP = '30d'
const SECRET = process.env.SESSION_SECRET
const ADMIN_EMAIL = process.env.ADMIN_EMAIL
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD
if (!SECRET) throw new Error('SESSION_SECRET must be set')
if (!ADMIN_EMAIL) throw new Error('ADMIN_EMAIL must be set')
if (!ADMIN_PASSWORD) throw new Error('ADMIN_PASSWORD must be set')

const ENCODED_SECRET = new TextEncoder().encode(SECRET)

@Service()
export class AuthService {
  private async generateAccessToken(email: string) {
    return new SignJWT({ email })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(ACCESS_TOKEN_EXP)
      .sign(ENCODED_SECRET)
  }

  private async generateRefreshToken(email: string) {
    return new SignJWT({ email })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(REFRESH_TOKEN_EXP)
      .sign(ENCODED_SECRET)
  }

  async login(data: LoginInput) {
    const { email, password } = data

    if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
      throw new Error('Invalid credentials')
    }

    const accessToken = await this.generateAccessToken(email)
    const refreshToken = await this.generateRefreshToken(email)

    return {
      accessToken,
      refreshToken,
      expiresIn: 15 * 60,
      email,
    }
  }

  async refreshToken(refreshToken: string) {
    try {
      const { payload } = await jwtVerify(refreshToken, ENCODED_SECRET, {
        algorithms: ['HS256'],
      })

      const email = (payload as any).email as string
      const newAccessToken = await this.generateAccessToken(email)

      return {
        accessToken: newAccessToken,
        expiresIn: 15 * 60,
        email,
      }
    } catch (err) {
      throw new Error('Invalid refresh token')
    }
  }
}
