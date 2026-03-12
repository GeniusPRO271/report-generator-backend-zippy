import { Hono } from "hono";
import Container from "typedi";
import { DedupService } from "../services/dedup.service";
import { requireRole } from "../middleware/requireRole";

const dedupRoutes = new Hono();
const dedupService = Container.get(DedupService);

// All dedup routes require superadmin
dedupRoutes.use("*", requireRole("superadmin"));

// GET / — dry-run scan, returns duplicate report for all entity types
dedupRoutes.get("/", async (c) => {
  try {
    const report = await dedupService.findAllDuplicates();
    return c.json(report);
  } catch (error: any) {
    return c.json(
      { error: "Failed to scan for duplicates", message: error.message },
      500
    );
  }
});

// POST /merge — execute merge for ALL entity types in correct order
dedupRoutes.post("/merge", async (c) => {
  try {
    const result = await dedupService.mergeAll();
    return c.json({ success: true, ...result });
  } catch (error: any) {
    return c.json(
      { error: "Merge failed", message: error.message },
      500
    );
  }
});

// POST /merge/merchants — merge only merchants
dedupRoutes.post("/merge/merchants", async (c) => {
  try {
    const result = await dedupService.mergeMerchants();
    return c.json({ success: true, ...result });
  } catch (error: any) {
    return c.json(
      { error: "Merchant merge failed", message: error.message },
      500
    );
  }
});

// POST /merge/providers — merge only providers
dedupRoutes.post("/merge/providers", async (c) => {
  try {
    const result = await dedupService.mergeProviders();
    return c.json({ success: true, ...result });
  } catch (error: any) {
    return c.json(
      { error: "Provider merge failed", message: error.message },
      500
    );
  }
});

// POST /merge/pay-methods — merge only pay methods
dedupRoutes.post("/merge/pay-methods", async (c) => {
  try {
    const result = await dedupService.mergePayMethods();
    return c.json({ success: true, ...result });
  } catch (error: any) {
    return c.json(
      { error: "PayMethod merge failed", message: error.message },
      500
    );
  }
});

// POST /merge/country-operations — merge only country operations
dedupRoutes.post("/merge/country-operations", async (c) => {
  try {
    const result = await dedupService.mergeCountryOperations();
    return c.json({ success: true, ...result });
  } catch (error: any) {
    return c.json(
      { error: "CountryOperation merge failed", message: error.message },
      500
    );
  }
});

export default dedupRoutes;
