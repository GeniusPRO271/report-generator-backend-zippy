import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import Container from "typedi";
import { TransactionService } from "../services/transaction.service";
import { InsertTransactionSchema, UpdateTransactionSchema } from "../db/zodSchema/transactions.schema";
import { PaginationSchema } from "../types/zod/pagination";
import { requireRole } from "../middleware/requireRole";

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

transactionRoutes.post("/import", requireRole("superadmin"), async (c) => {
  const data = await c.req.json();
  if (!Array.isArray(data)) {
    return c.json({ error: "Expected an array of transactions" }, 400);
  }

  // Partition by index to avoid duplicating the entire array
  const payinIndices: number[] = [];
  const payoutIndices: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (data[i].type?.toUpperCase() === 'PAYOUT') {
      payoutIndices.push(i);
    } else {
      payinIndices.push(i);
    }
  }

  const results: any[] = [];
  if (payinIndices.length > 0) {
    const payins = payinIndices.map(i => data[i]);
    const payinResults = await transactionService.importTransactions(payins);
    results.push(...payinResults);
  }
  if (payoutIndices.length > 0) {
    const payouts = payoutIndices.map(i => data[i]);
    const payoutResults = await transactionService.importPayouts(payouts);
    results.push(...payoutResults);
  }
  return c.json(results);
});

// New route to find and log all duplicates without deleting
transactionRoutes.get("/duplicates/find", async (c) => {
  try {
    const result = await transactionService.findDuplicates();
    return c.json(result);
  } catch (error: any) {
    return c.json({
      error: "Failed to find duplicates",
      message: error.message
    }, 500);
  }
});

// Route to delete duplicate transactions
transactionRoutes.delete("/duplicates", async (c) => {
  try {
    const result = await transactionService.deleteDuplicates();
    return c.json(result);
  } catch (error: any) {
    return c.json({
      error: "Failed to delete duplicates",
      message: error.message
    }, 500);
  }
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
