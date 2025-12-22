import { Hono } from 'hono';
import { cors } from 'hono/cors';
import reportRoutes from './routes/report.routes';
import providerRoutes from './routes/provider.routes';
import payMethodRoutes from './routes/payMethod.routes';
import merchantRoutes from './routes/merchant.routes';
import merchantAPIConfigRoutes from './routes/merchantAPIConfig.routes';
import countryRoutes from './routes/country.routes';
import countryOperationRoutes from './routes/countryOperation.routes';
import transactionRoutes from './routes/transaction.routes';
import healthRoutes from './routes/health.routes';
import { logger } from './middleware/logger';
import statisticsRoutes from './routes/statistics.route';
const app = new Hono();

app.use('*', cors());
app.use('*', logger({
  colorize: true,
  logRequestBody: false,
  logResponseBody: false,
  maxBodySize: 5000,
  logHeaders: true,
  skip: ['/health', '/metrics'],
}));
app.route('/reports', reportRoutes);

app.route('/health', healthRoutes);
app.route('/providers', providerRoutes);
app.route('/paymethods', payMethodRoutes);
app.route('/merchants', merchantRoutes);
app.route('/merchant-api-config', merchantAPIConfigRoutes);
app.route('/countries', countryRoutes);
app.route('/country-operations', countryOperationRoutes);
app.route('/stats', statisticsRoutes);
app.route('/transactions', transactionRoutes);

export default app;
