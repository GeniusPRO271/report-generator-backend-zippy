import { Hono } from "hono";
import Container from "typedi";
import { zValidator } from "@hono/zod-validator";
import { MerchantService } from "../services/merchant.service";
import { InsertMerchantSchema, UpdateMerchantSchema } from "../db/zodSchema/merchant.schema";

const merchantRoutes = new Hono();
const merchantService = Container.get(MerchantService);

merchantRoutes.post("/", zValidator("json", InsertMerchantSchema), async (c) => {
  const data = c.req.valid("json");
  return c.json(await merchantService.create(data));
});

merchantRoutes.get("/", async (c) => {
  return c.json(await merchantService.findAll());
});

merchantRoutes.get("/:id", async (c) => {
  return c.json(await merchantService.findOne(c.req.param("id")));
});

merchantRoutes.put(
  "/:id",
  zValidator("json", UpdateMerchantSchema),
  async (c) => {
    const id = c.req.param("id");
    const data = c.req.valid("json");
    return c.json(await merchantService.update(id, data));
  }
);

merchantRoutes.delete("/:id", async (c) => {
  await merchantService.delete(c.req.param("id"));
  return c.json({ success: true });
});

export default merchantRoutes;
