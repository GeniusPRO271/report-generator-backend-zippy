import { Hono } from 'hono'
import { cors } from 'hono/cors'

import reportRoutes from './routes/report.routes'
import providerRoutes from './routes/provider.routes'
import payMethodRoutes from './routes/payMethod.routes'
import merchantRoutes from './routes/merchant.routes'
import merchantAPIConfigRoutes from './routes/merchantAPIConfig.routes'
import countryRoutes from './routes/country.routes'
import countryOperationRoutes from './routes/countryOperation.routes'
import transactionRoutes from './routes/transaction.routes'
import healthRoutes from './routes/health.routes'
import statisticsRoutes from './routes/statistics.route'
import authRoutes from './routes/auth.route'
import userRoutes from './routes/user.routes'

import { logger } from './middleware/logger'
import { authMiddleware } from './middleware/auth'

const app = new Hono()

app.use('*', cors())
app.use('*', logger({
  colorize: true,
  logRequestBody: false,
  logResponseBody: false,
  maxBodySize: 5000,
  logHeaders: false,
  skip: ['/health', '/metrics'],
}))

// Public routes (no auth required)
app.route('/auth', authRoutes)
app.route('/health', healthRoutes)

// Apply auth middleware to ALL /api/* routes
app.use('/api/*', authMiddleware())

// Protected routes (require valid JWT)
app.route('/api/reports', reportRoutes)
app.route('/api/providers', providerRoutes)
app.route('/api/paymethods', payMethodRoutes)
app.route('/api/merchants', merchantRoutes)
app.route('/api/merchant-api-config', merchantAPIConfigRoutes)
app.route('/api/countries', countryRoutes)
app.route('/api/country-operations', countryOperationRoutes)
app.route('/api/stats', statisticsRoutes)
app.route('/api/transactions', transactionRoutes)

// Superadmin-only routes (auth middleware already applied via /api/*)
app.route('/api/users', userRoutes)

export default app
