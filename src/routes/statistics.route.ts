import { Hono } from 'hono';
import Container from 'typedi';
import { zValidator } from '@hono/zod-validator';
import { StatsFilterSchema } from '../types/zod/statsSchemas';
import { StatsService } from '../services/statistics.service';

const statisticsRoutes = new Hono();
const statsService = Container.get(StatsService);

statisticsRoutes.get(
  "/",
  zValidator("query", StatsFilterSchema),
  async (c) => {
    try {
      const filters = c.req.valid("query");
      console.debug("[StatisticsRoute] Incoming request with filters:", filters);

      const stats = await statsService.getStats(filters);
      console.debug("[StatisticsRoute] Returning stats response");

      return c.json(stats);
    } catch (err) {
      console.error("[StatisticsRoute] Error processing request:", err);
      return c.json({ error: "Failed to fetch statistics" }, 500);
    }
  }
);

export default statisticsRoutes;
