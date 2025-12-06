import { Hono } from 'hono';
import Container from 'typedi';
import { zValidator } from '@hono/zod-validator';
import { StatsFilterSchema } from '../types/zod/statsSchemas';
import { StatsService } from '../services/statistics.service';

const statisticsRoutes = new Hono();
const statsService = Container.get(StatsService);

statisticsRoutes.get("/stats",
  zValidator("json", StatsFilterSchema),
  async (c) => {
    const filters = c.req.valid("json");
    const stats = await statsService.getStats(filters);
    return c.json(stats);
  });

export default statisticsRoutes
