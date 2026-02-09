import { Context, MiddlewareHandler, Next } from 'hono'

export function requireRole(...allowedRoles: string[]): MiddlewareHandler {
  return async (c: Context, next: Next) => {
    const user = c.get('user')

    if (!user) {
      return c.json({ error: 'Unauthorized' }, 401)
    }

    if (!allowedRoles.includes(user.role)) {
      return c.json({ error: 'Forbidden: Insufficient permissions' }, 403)
    }

    await next()
  }
}
