import { Hono } from 'hono';

const healthRoutes = new Hono();

healthRoutes.get('/', async (c) => {
  const base = c.req.url.replace(/\/health.*/, '');

  const endpoints = [
    'providers',
    'paymethods',
    'merchants',
    'merchant-api-config',
    'countries',
    'country-operations',
    'transactions',
    'reports'
  ];

  const results: Record<string, string> = {};

  for (const ep of endpoints) {
    try {
      const res = await fetch(`${base}/${ep}`);
      results[ep] = res.ok ? "OK" : `ERROR: ${res.status}`;
    } catch (err: any) {
      results[ep] = `ERROR: ${err.message}`;
    }
  }

  return c.json({
    status: "system check completed",
    services: results
  });
});

export default healthRoutes;
