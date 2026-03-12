import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { Container } from "typedi";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

import { HttpError, ReportService } from "../services/report.service";
import { CreateReportRequestSchema } from "../types/zod/report";

const reportRoutes = new Hono();
const reportService = Container.get(ReportService);

const IdParamSchema = z.object({
  id: z.string().uuid(),
});

reportRoutes.post(
  "/",
  zValidator("json", CreateReportRequestSchema),
  async (c) => {
    const data = c.req.valid("json");
    const job = await reportService.createReportRequest(data);
    return c.json(job, 201);
  },
);

reportRoutes.get("/", async (c) => {
  const reports = await reportService.getAllReports();
  return c.json(reports, 200);
});

reportRoutes.get(
  "/:id",
  zValidator("param", IdParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");

    try {
      const report = await reportService.getReportStatus(id);
      return c.json(report, 200);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return c.json({ error: message }, 404);
    }
  },
);

reportRoutes.get(
  "/:id/download",
  zValidator("param", IdParamSchema),
  async (c) => {
    const { id } = c.req.valid("param");

    try {
      const { url, fileName } = await reportService.downloadReport(id);
      return c.json({ url, fileName });
    } catch (err) {
      if (err instanceof HttpError) {
        return c.json({ error: err.message }, err.status as ContentfulStatusCode);
      }

      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: msg }, 500);
    }
  },
);

export default reportRoutes;
