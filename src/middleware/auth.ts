import { Context, MiddlewareHandler, Next } from 'hono'
import Container from 'typedi'
import { AuthService } from '../services/auth.service'

declare module 'hono' {
  interface ContextVariableMap {
    user: { email: string; role: string }
  }
}

export function authMiddleware(): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const authHeader = c.req.header('Authorization')

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: 'Unauthorized: Missing or invalid token' }, 401)
    }

    const token = authHeader.slice(7)

    try {
      const authService = Container.get(AuthService)
      const payload = await authService.verifyToken(token)

      c.set('user', { email: payload.email, role: payload.role })
      await next()
    } catch (err) {
      return c.json({ error: 'Unauthorized: Invalid or expired token' }, 401)
    }
  }
}
