import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import Container from "typedi";
import { TransactionAnalyticsService } from "../services/transactionAnalytics.service";
import {
  TransactionAnalyticsFilterSchema,
  TransactionAnalyticsTrendsFilterSchema,
} from "../types/zod/transactionAnalyticsSchema";

const transactionAnalyticsRoutes = new Hono();
const service = Container.get(TransactionAnalyticsService);

transactionAnalyticsRoutes.get(
  "/",
  zValidator("query", TransactionAnalyticsFilterSchema),
  async (c) => {
    try {
      const filters = c.req.valid("query");
      const result = await service.getAnalytics(filters);
      return c.json(result);
    } catch (err: any) {
      console.error("[TransactionAnalytics] Error:", err);
      return c.json({ error: "Failed to fetch transaction analytics" }, 500);
    }
  },
);

transactionAnalyticsRoutes.get(
  "/trends",
  zValidator("query", TransactionAnalyticsTrendsFilterSchema),
  async (c) => {
    try {
      const filters = c.req.valid("query");
      const result = await service.getTrends(filters);
      return c.json(result);
    } catch (err: any) {
      console.error("[TransactionAnalyticsTrends] Error:", err);
      return c.json({ error: "Failed to fetch analytics trends" }, 500);
    }
  },
);

export default transactionAnalyticsRoutes;
