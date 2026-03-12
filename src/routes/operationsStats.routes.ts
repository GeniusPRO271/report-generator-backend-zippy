import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import Container from "typedi";
import { OperationsStatsService } from "../services/operationsStats.service";
import {
  OperationsFilterSchema,
  OperationsTrendsFilterSchema,
} from "../types/zod/operationsSchema";

const operationsStatsRoutes = new Hono();
const service = Container.get(OperationsStatsService);

operationsStatsRoutes.get(
  "/",
  zValidator("query", OperationsFilterSchema),
  async (c) => {
    try {
      const filters = c.req.valid("query");
      const result = await service.getStats(filters);
      return c.json(result);
    } catch (err: any) {
      console.error("[OperationsStats] Error:", err);
      return c.json({ error: "Failed to fetch operations stats" }, 500);
    }
  },
);

operationsStatsRoutes.get(
  "/trends",
  zValidator("query", OperationsTrendsFilterSchema),
  async (c) => {
    try {
      const filters = c.req.valid("query");
      const result = await service.getTrends(filters);
      return c.json(result);
    } catch (err: any) {
      console.error("[OperationsTrends] Error:", err);
      return c.json({ error: "Failed to fetch operations trends" }, 500);
    }
  },
);

export default operationsStatsRoutes;
