import { Context, Hono } from 'hono';
import Container from 'typedi';
import { zValidator } from '@hono/zod-validator';
import {
  InsertCountrySchema,
  UpdateCountrySchema
} from '../db/zodSchema/country.schema';
import { CountryService } from '../services/country.service';

const countryRoutes = new Hono();
const countryService = Container.get(CountryService);

countryRoutes.post(
  '/',
  zValidator('json', InsertCountrySchema),
  async (c) => {
    const data = c.req.valid('json');
    const result = await countryService.create(data);
    return c.json(result);
  }
);

countryRoutes.get('/', async (c: Context) => {
  const result = await countryService.findAll();
  return c.json(result);
});

countryRoutes.get('/:id', async (c: Context) => {
  const id = c.req.param('id');
  const result = await countryService.findOne(id);
  return c.json(result);
});

countryRoutes.put(
  '/:id',
  zValidator('json', UpdateCountrySchema),
  async (c) => {
    const id = c.req.param('id');
    const data = c.req.valid('json');
    const result = await countryService.update(id, data);
    return c.json(result);
  }
);

countryRoutes.delete('/:id', async (c: Context) => {
  const id = c.req.param('id');
  await countryService.delete(id);
  return c.json({ success: true });
});

export default countryRoutes;
