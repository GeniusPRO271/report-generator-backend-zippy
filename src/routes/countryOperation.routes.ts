import { Context, Hono } from 'hono';
import Container from 'typedi';
import { zValidator } from '@hono/zod-validator';
import {
  InsertCountryOperationSchema,
  UpdateCountryOperationSchema,
} from '../db/zodSchema/countryOperation.schema';
import { CountryOperationService } from '../services/countryOperation.service';

const countryOperationRoutes = new Hono();
const countryOperationService = Container.get(CountryOperationService);

countryOperationRoutes.post(
  '/',
  zValidator('json', InsertCountryOperationSchema),
  async (c) => {
    const data = c.req.valid('json');
    const countryOperation = await countryOperationService.create(data);
    return c.json(countryOperation);
  }
);

countryOperationRoutes.get('/', async (c: Context) => {
  const countryOperations = await countryOperationService.findAll();
  return c.json(countryOperations);
});

countryOperationRoutes.get('/:id', async (c: Context) => {
  const id = c.req.param('id');
  const countryOperation = await countryOperationService.findOne(id);
  return c.json(countryOperation);
});

countryOperationRoutes.put(
  '/:id',
  zValidator('json', UpdateCountryOperationSchema),
  async (c) => {
    const id = c.req.param('id');
    const data = c.req.valid('json');
    const updated = await countryOperationService.update(id, data);
    return c.json(updated);
  }
);

countryOperationRoutes.delete('/:id', async (c: Context) => {
  const id = c.req.param('id');
  await countryOperationService.delete(id);
  return c.json({ success: true });
});

export default countryOperationRoutes;
