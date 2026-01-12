import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { jwt } from 'hono/jwt'

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

import { logger } from './middleware/logger'

const app = new Hono()

app.use('*', cors())
app.use('*', logger({
  colorize: true,
  logRequestBody: false,
  logResponseBody: false,
  maxBodySize: 5000,
  logHeaders: true,
  skip: ['/health', '/metrics'],
}))

app.route('/auth', authRoutes)
app.route('/health', healthRoutes)

const sessionSecret = process.env.SESSION_SECRET
if (!sessionSecret) throw new Error('SESSION_SECRET is not set in .env')

app.use('/api/*', jwt({ secret: sessionSecret }))

app.route('/api/reports', reportRoutes)
app.route('/api/providers', providerRoutes)
app.route('/api/paymethods', payMethodRoutes)
app.route('/api/merchants', merchantRoutes)
app.route('/api/merchant-api-config', merchantAPIConfigRoutes)
app.route('/api/countries', countryRoutes)
app.route('/api/country-operations', countryOperationRoutes)
app.route('/api/stats', statisticsRoutes)
app.route('/api/transactions', transactionRoutes)

export default app
