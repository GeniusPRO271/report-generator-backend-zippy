import { Hono } from "hono";
import Container from "typedi";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { MerchantService } from "../services/merchant.service";
import {
  InsertMerchantSchema,
  UpdateMerchantSchema,
} from "../db/zodSchema/merchant.schema";

const merchantRoutes = new Hono();
const merchantService = Container.get(MerchantService);

const IdParamSchema = z.object({
  id: z.string().uuid(),
});

merchantRoutes.post("/", zValidator("json", InsertMerchantSchema), async (c) => {
  const data = c.req.valid("json");
  return c.json(await merchantService.create(data));
});

merchantRoutes.get("/", async (c) => {
  return c.json(await merchantService.findAll());
});

merchantRoutes.get("/:id", zValidator("param", IdParamSchema), async (c) => {
  return c.json(await merchantService.findOne(c.req.param("id")));
});

merchantRoutes.get(
  "/:id/finance-options",
  zValidator("param", IdParamSchema),
  async (c) => {
    const id = c.req.param("id");
    return c.json(await merchantService.getFinanceOptionsByMerchantId(id));
  },
);

merchantRoutes.put(
  "/:id",
  zValidator("param", IdParamSchema),
  zValidator("json", UpdateMerchantSchema),
  async (c) => {
    const id = c.req.param("id");
    const data = c.req.valid("json");
    return c.json(await merchantService.update(id, data));
  },
);

merchantRoutes.delete("/:id", zValidator("param", IdParamSchema), async (c) => {
  await merchantService.delete(c.req.param("id"));
  return c.json({ success: true });
});

export default merchantRoutes;
