import { Hono } from 'hono';
import { cors } from 'hono/cors'

import reportRoutes from './routes/report.routes';

const app = new Hono();
app.use('*', cors());
app.route('/reports', reportRoutes);

export default app;
