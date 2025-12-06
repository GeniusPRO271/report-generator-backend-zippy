import { Hono } from "hono";
import Container from "typedi";
import { zValidator } from "@hono/zod-validator";

import { ProviderService } from "../services/provider.service";
import { InsertProviderSchema, UpdateProviderSchema } from "../db/zodSchema/provider.schema";

const providerRoutes = new Hono();
const providerService = Container.get(ProviderService);

providerRoutes.post(
  "/",
  zValidator("json", InsertProviderSchema),
  async (c) => {
    const data = c.req.valid("json");
    const created = await providerService.create(data);
    return c.json(created);
  }
);

providerRoutes.get("/", async (c) => {
  const all = await providerService.findAll();
  return c.json(all);
});

providerRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  const provider = await providerService.findOne(id);
  return c.json(provider);
});

providerRoutes.put(
  "/:id",
  zValidator("json", UpdateProviderSchema),
  async (c) => {
    const id = c.req.param("id");
    const data = c.req.valid("json");
    const updated = await providerService.update(id, data);
    return c.json(updated);
  }
);

providerRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");
  await providerService.delete(id);
  return c.json({ success: true });
});

export default providerRoutes;
