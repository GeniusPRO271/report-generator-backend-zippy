import { Hono } from "hono";
import Container from "typedi";
import { zValidator } from "@hono/zod-validator";

import { PayMethodService } from "../services/payMethod.service";
import { InsertPayMethodSchema, UpdatePayMethodSchema } from "../db/zodSchema/payMethod.schema";

const payMethodRoutes = new Hono();
const payMethodService = Container.get(PayMethodService);

payMethodRoutes.post(
  "/",
  zValidator("json", InsertPayMethodSchema),
  async (c) => {
    const data = c.req.valid("json");
    const created = await payMethodService.create(data);
    return c.json(created);
  }
);

payMethodRoutes.get("/", async (c) => {
  const all = await payMethodService.findAll();
  return c.json(all);
});

payMethodRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  const pm = await payMethodService.findOne(id);
  return c.json(pm);
});

payMethodRoutes.put(
  "/:id",
  zValidator("json", UpdatePayMethodSchema),
  async (c) => {
    const id = c.req.param("id");
    const data = c.req.valid("json");
    const updated = await payMethodService.update(id, data);
    return c.json(updated);
  }
);

payMethodRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");
  await payMethodService.delete(id);
  return c.json({ success: true });
});

export default payMethodRoutes;
