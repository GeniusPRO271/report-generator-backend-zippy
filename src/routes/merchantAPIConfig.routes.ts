import { Hono } from "hono";
import Container from "typedi";
import { zValidator } from "@hono/zod-validator";

import { MerchantAPIConfigService } from "../services/merchantAPIConfig.service";
import {
  InsertMerchantAPIConfigSchema,
  UpdateMerchantAPIConfigSchema
} from "../db/zodSchema/merchantApiConfig.schema";

const merchantAPIConfigRoutes = new Hono();
const service = Container.get(MerchantAPIConfigService);

merchantAPIConfigRoutes.post(
  "/",
  zValidator("json", InsertMerchantAPIConfigSchema),
  async (c) => {
    const data = c.req.valid("json");
    return c.json(await service.create(data));
  }
);

merchantAPIConfigRoutes.get("/", async (c) => {
  return c.json(await service.findAll());
});

merchantAPIConfigRoutes.get("/:id", async (c) => {
  return c.json(await service.findOne(c.req.param("id")));
});

merchantAPIConfigRoutes.put(
  "/:id",
  zValidator("json", UpdateMerchantAPIConfigSchema),
  async (c) => {
    const id = c.req.param("id");
    const data = c.req.valid("json");
    return c.json(await service.update(id, data));
  }
);

merchantAPIConfigRoutes.delete("/:id", async (c) => {
  await service.delete(c.req.param("id"));
  return c.json({ success: true });
});

export default merchantAPIConfigRoutes;
