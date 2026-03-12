import { Hono } from 'hono';
import Container from 'typedi';
import { zValidator } from '@hono/zod-validator';
import { StatsFilterSchema, ApprovalRatesFilterSchema } from '../types/zod/statsSchemas';
import { StatsService } from '../services/statistics.service';

const statisticsRoutes = new Hono();
const statsService = Container.get(StatsService);

statisticsRoutes.get(
  "/approval-rates",
  zValidator("query", ApprovalRatesFilterSchema),
  async (c) => {
    try {
      const filters = c.req.valid("query");
      console.debug("[StatisticsRoute] Approval rates request with filters:", filters);

      const result = await statsService.getApprovalRates(filters);
      console.debug("[StatisticsRoute] Returning approval rates response");

      return c.json(result);
    } catch (err) {
      console.error("[StatisticsRoute] Error fetching approval rates:", err);
      return c.json({ error: "Failed to fetch approval rates" }, 500);
    }
  }
);

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
