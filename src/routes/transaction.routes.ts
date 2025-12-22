import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import Container from "typedi";
import { TransactionService } from "../services/transaction.service";
import { InsertTransactionSchema, UpdateTransactionSchema } from "../db/zodSchema/transactions.schema";
import { PaginationSchema } from "../types/zod/pagination";

const transactionRoutes = new Hono();
const transactionService = Container.get(TransactionService);

transactionRoutes.post(
  "/",
  zValidator("json", InsertTransactionSchema),
  async (c) => {
    const data = c.req.valid("json");
    const created = await transactionService.create(data);
    return c.json(created);
  }
);

transactionRoutes.get("/",
  zValidator("query", PaginationSchema),
  async (c) => {
    const { page, limit } = c.req.valid("query");
    const all = await transactionService.findAll(page, limit);
    return c.json(all);
  });

transactionRoutes.get("/v2",
  zValidator("query", PaginationSchema),
  async (c) => {
    const { page, limit } = c.req.valid("query");
    const all = await transactionService.findAllVersion2(page, limit);
    return c.json(all);
  });

transactionRoutes.get("/:id", async (c) => {
  const id = c.req.param("id");
  const t = await transactionService.findOne(id);
  return c.json(t);
});

transactionRoutes.post("/import", async (c) => {
  const data = await c.req.json();
  if (!Array.isArray(data)) {
    return c.json({ error: "Expected an array of transactions" }, 400);
  }

  const result = await transactionService.importTransactions(data);
  return c.json(result);
});

transactionRoutes.put(
  "/:id",
  zValidator("json", UpdateTransactionSchema),
  async (c) => {
    const id = c.req.param("id");
    const data = c.req.valid("json");
    const updated = await transactionService.update(id, data);
    return c.json(updated);
  }
);

transactionRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");
  await transactionService.delete(id);
  return c.json({ success: true });
});

export default transactionRoutes;
