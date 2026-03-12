import { Service } from "typedi";
import { db } from "../db/connection";
import {
  merchant,
  provider,
  payMethod,
  countryOperation,
  transaction,
  merchantAPIConfig,
} from "../db/schema";
import { inArray, sql } from "drizzle-orm";

type MergeGroupDetail = {
  canonicalId: string;
  key: string;
  duplicateIds: string[];
};

type MergeResult = {
  entity: string;
  groupsFound: number;
  duplicatesRemoved: number;
  details: MergeGroupDetail[];
};

type DuplicateGroupInfo = {
  key: string;
  canonicalId: string;
  canonicalName?: string;
  duplicateCount: number;
  duplicates: Array<{ id: string; name?: string; createdAt: Date }>;
};

type EntityDuplicateReport = {
  groups: number;
  duplicates: number;
  details: DuplicateGroupInfo[];
};

type DedupReport = {
  merchants: EntityDuplicateReport;
  providers: EntityDuplicateReport;
  payMethods: EntityDuplicateReport;
  countryOperations: EntityDuplicateReport;
};

@Service()
export class DedupService {
  // ─── FIND (dry-run scan, no mutations) ───

  async findAllDuplicates(): Promise<DedupReport> {
    const [m, p, pm, co] = await Promise.all([
      this.findDuplicateMerchants(),
      this.findDuplicateProviders(),
      this.findDuplicatePayMethods(),
      this.findDuplicateCountryOperations(),
    ]);
    return {
      merchants: m,
      providers: p,
      payMethods: pm,
      countryOperations: co,
    };
  }

  private async findDuplicateMerchants(): Promise<EntityDuplicateReport> {
    // Step 1: SQL to find only duplicate keys
    const dupeKeys = await db
      .select({
        key: sql<string>`lower(trim(${merchant.name}))`,
        cnt: sql<number>`count(*)::int`,
      })
      .from(merchant)
      .groupBy(sql`lower(trim(${merchant.name}))`)
      .having(sql`count(*) > 1`);

    if (dupeKeys.length === 0) return { groups: 0, duplicates: 0, details: [] };

    // Step 2: Fetch only the records that belong to duplicate groups
    const keyValues = dupeKeys.map((d) => d.key);
    const dupeRecords = await db
      .select()
      .from(merchant)
      .where(inArray(sql`lower(trim(${merchant.name}))`, keyValues));

    // Step 3: Group in memory (only duplicate records, not the full table)
    const grouped = new Map<string, (typeof dupeRecords)[number][]>();
    for (const m of dupeRecords) {
      const key = m.name.trim().toLowerCase();
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(m);
    }

    const details: DuplicateGroupInfo[] = [];
    let totalDuplicates = 0;

    for (const [name, records] of grouped) {
      if (records.length <= 1) continue;
      records.sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
      const canonical = records[0];
      const dupes = records.slice(1);
      totalDuplicates += dupes.length;
      details.push({
        key: name,
        canonicalId: canonical.id,
        canonicalName: canonical.name,
        duplicateCount: dupes.length,
        duplicates: dupes.map((d) => ({
          id: d.id,
          name: d.name,
          createdAt: d.createdAt,
        })),
      });
    }

    return { groups: details.length, duplicates: totalDuplicates, details };
  }

  private async findDuplicateProviders(): Promise<EntityDuplicateReport> {
    const dupeKeys = await db
      .select({
        key: sql<string>`lower(trim(${provider.name}))`,
        cnt: sql<number>`count(*)::int`,
      })
      .from(provider)
      .groupBy(sql`lower(trim(${provider.name}))`)
      .having(sql`count(*) > 1`);

    if (dupeKeys.length === 0) return { groups: 0, duplicates: 0, details: [] };

    const keyValues = dupeKeys.map((d) => d.key);
    const dupeRecords = await db
      .select()
      .from(provider)
      .where(inArray(sql`lower(trim(${provider.name}))`, keyValues));

    const grouped = new Map<string, (typeof dupeRecords)[number][]>();
    for (const p of dupeRecords) {
      const key = p.name.trim().toLowerCase();
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(p);
    }

    const details: DuplicateGroupInfo[] = [];
    let totalDuplicates = 0;

    for (const [name, records] of grouped) {
      if (records.length <= 1) continue;
      records.sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
      const canonical = records[0];
      const dupes = records.slice(1);
      totalDuplicates += dupes.length;
      details.push({
        key: name,
        canonicalId: canonical.id,
        canonicalName: canonical.name,
        duplicateCount: dupes.length,
        duplicates: dupes.map((d) => ({
          id: d.id,
          name: d.name,
          createdAt: d.createdAt,
        })),
      });
    }

    return { groups: details.length, duplicates: totalDuplicates, details };
  }

  private async findDuplicatePayMethods(): Promise<EntityDuplicateReport> {
    const dupeKeys = await db
      .select({
        name: sql<string>`lower(trim(${payMethod.name}))`,
        providerId: payMethod.providerId,
        countryId: payMethod.countryId,
        cnt: sql<number>`count(*)::int`,
      })
      .from(payMethod)
      .groupBy(sql`lower(trim(${payMethod.name}))`, payMethod.providerId, payMethod.countryId)
      .having(sql`count(*) > 1`);

    if (dupeKeys.length === 0) return { groups: 0, duplicates: 0, details: [] };

    // Fetch records for each duplicate group individually
    const details: DuplicateGroupInfo[] = [];
    let totalDuplicates = 0;

    for (const dk of dupeKeys) {
      const records = await db
        .select()
        .from(payMethod)
        .where(
          sql`lower(trim(${payMethod.name})) = ${dk.name}
            AND ${payMethod.providerId} = ${dk.providerId}
            AND ${payMethod.countryId} = ${dk.countryId}`
        );

      if (records.length <= 1) continue;
      records.sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
      const canonical = records[0];
      const dupes = records.slice(1);
      totalDuplicates += dupes.length;
      const compositeKey = `${dk.name}|${dk.providerId}|${dk.countryId}`;
      details.push({
        key: compositeKey,
        canonicalId: canonical.id,
        canonicalName: canonical.name,
        duplicateCount: dupes.length,
        duplicates: dupes.map((d) => ({
          id: d.id,
          name: d.name,
          createdAt: d.createdAt,
        })),
      });
    }

    return { groups: details.length, duplicates: totalDuplicates, details };
  }

  private async findDuplicateCountryOperations(): Promise<EntityDuplicateReport> {
    const dupeKeys = await db
      .select({
        merchantId: countryOperation.merchantId,
        providerId: countryOperation.providerId,
        countryId: countryOperation.countryId,
        payMethodId: countryOperation.payMethodId,
        cnt: sql<number>`count(*)::int`,
      })
      .from(countryOperation)
      .groupBy(
        countryOperation.merchantId,
        countryOperation.providerId,
        countryOperation.countryId,
        countryOperation.payMethodId,
      )
      .having(sql`count(*) > 1`);

    if (dupeKeys.length === 0) return { groups: 0, duplicates: 0, details: [] };

    const details: DuplicateGroupInfo[] = [];
    let totalDuplicates = 0;

    for (const dk of dupeKeys) {
      const records = await db
        .select()
        .from(countryOperation)
        .where(
          sql`${countryOperation.merchantId} = ${dk.merchantId}
            AND ${countryOperation.providerId} = ${dk.providerId}
            AND ${countryOperation.countryId} = ${dk.countryId}
            AND ${countryOperation.payMethodId} = ${dk.payMethodId}`
        );

      if (records.length <= 1) continue;
      records.sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
      const canonical = records[0];
      const dupes = records.slice(1);
      totalDuplicates += dupes.length;
      const compositeKey = `${dk.merchantId}|${dk.providerId}|${dk.countryId}|${dk.payMethodId}`;
      details.push({
        key: compositeKey,
        canonicalId: canonical.id,
        duplicateCount: dupes.length,
        duplicates: dupes.map((d) => ({
          id: d.id,
          createdAt: d.createdAt,
        })),
      });
    }

    return { groups: details.length, duplicates: totalDuplicates, details };
  }

  // ─── MERGE (mutating operations) ───

  async mergeAll() {
    // Order matters: merchants -> providers -> payMethods -> countryOperations
    const merchants = await this.mergeMerchants();
    const providers = await this.mergeProviders();
    const payMethods = await this.mergePayMethods();
    const countryOperations = await this.mergeCountryOperations();

    return { merchants, providers, payMethods, countryOperations };
  }

  async mergeMerchants(): Promise<MergeResult> {
    const dupeKeys = await db
      .select({
        key: sql<string>`lower(trim(${merchant.name}))`,
      })
      .from(merchant)
      .groupBy(sql`lower(trim(${merchant.name}))`)
      .having(sql`count(*) > 1`);

    const result: MergeResult = {
      entity: "merchant",
      groupsFound: 0,
      duplicatesRemoved: 0,
      details: [],
    };

    if (dupeKeys.length === 0) return result;

    const keyValues = dupeKeys.map((d) => d.key);
    const dupeRecords = await db
      .select()
      .from(merchant)
      .where(inArray(sql`lower(trim(${merchant.name}))`, keyValues));

    const grouped = new Map<string, (typeof dupeRecords)[number][]>();
    for (const m of dupeRecords) {
      const key = m.name.trim().toLowerCase();
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(m);
    }

    for (const [key, records] of grouped) {
      if (records.length <= 1) continue;
      result.groupsFound++;

      records.sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
      const canonical = records[0];
      const dupeIds = records.slice(1).map((r) => r.id);

      await db.transaction(async (tx) => {
        await tx
          .update(transaction)
          .set({ merchantId: canonical.id })
          .where(inArray(transaction.merchantId, dupeIds));

        await tx
          .update(countryOperation)
          .set({ merchantId: canonical.id })
          .where(inArray(countryOperation.merchantId, dupeIds));

        await tx
          .update(merchantAPIConfig)
          .set({ merchantId: canonical.id })
          .where(inArray(merchantAPIConfig.merchantId, dupeIds));

        await tx.delete(merchant).where(inArray(merchant.id, dupeIds));
      });

      result.duplicatesRemoved += dupeIds.length;
      result.details.push({
        canonicalId: canonical.id,
        key,
        duplicateIds: dupeIds,
      });
    }

    return result;
  }

  async mergeProviders(): Promise<MergeResult> {
    const dupeKeys = await db
      .select({
        key: sql<string>`lower(trim(${provider.name}))`,
      })
      .from(provider)
      .groupBy(sql`lower(trim(${provider.name}))`)
      .having(sql`count(*) > 1`);

    const result: MergeResult = {
      entity: "provider",
      groupsFound: 0,
      duplicatesRemoved: 0,
      details: [],
    };

    if (dupeKeys.length === 0) return result;

    const keyValues = dupeKeys.map((d) => d.key);
    const dupeRecords = await db
      .select()
      .from(provider)
      .where(inArray(sql`lower(trim(${provider.name}))`, keyValues));

    const grouped = new Map<string, (typeof dupeRecords)[number][]>();
    for (const p of dupeRecords) {
      const key = p.name.trim().toLowerCase();
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(p);
    }

    for (const [key, records] of grouped) {
      if (records.length <= 1) continue;
      result.groupsFound++;

      records.sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
      const canonical = records[0];
      const dupeIds = records.slice(1).map((r) => r.id);

      await db.transaction(async (tx) => {
        await tx
          .update(transaction)
          .set({ providerId: canonical.id })
          .where(inArray(transaction.providerId, dupeIds));

        await tx
          .update(countryOperation)
          .set({ providerId: canonical.id })
          .where(inArray(countryOperation.providerId, dupeIds));

        await tx
          .update(payMethod)
          .set({ providerId: canonical.id })
          .where(inArray(payMethod.providerId, dupeIds));

        await tx.delete(provider).where(inArray(provider.id, dupeIds));
      });

      result.duplicatesRemoved += dupeIds.length;
      result.details.push({
        canonicalId: canonical.id,
        key,
        duplicateIds: dupeIds,
      });
    }

    return result;
  }

  async mergePayMethods(): Promise<MergeResult> {
    const dupeKeys = await db
      .select({
        name: sql<string>`lower(trim(${payMethod.name}))`,
        providerId: payMethod.providerId,
        countryId: payMethod.countryId,
      })
      .from(payMethod)
      .groupBy(sql`lower(trim(${payMethod.name}))`, payMethod.providerId, payMethod.countryId)
      .having(sql`count(*) > 1`);

    const result: MergeResult = {
      entity: "payMethod",
      groupsFound: 0,
      duplicatesRemoved: 0,
      details: [],
    };

    if (dupeKeys.length === 0) return result;

    for (const dk of dupeKeys) {
      const records = await db
        .select()
        .from(payMethod)
        .where(
          sql`lower(trim(${payMethod.name})) = ${dk.name}
            AND ${payMethod.providerId} = ${dk.providerId}
            AND ${payMethod.countryId} = ${dk.countryId}`
        );

      if (records.length <= 1) continue;
      result.groupsFound++;

      records.sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
      const canonical = records[0];
      const dupeIds = records.slice(1).map((r) => r.id);
      const key = `${dk.name}|${dk.providerId}|${dk.countryId}`;

      await db.transaction(async (tx) => {
        await tx
          .update(transaction)
          .set({ payMethodId: canonical.id })
          .where(inArray(transaction.payMethodId, dupeIds));

        await tx
          .update(countryOperation)
          .set({ payMethodId: canonical.id })
          .where(inArray(countryOperation.payMethodId, dupeIds));

        await tx.delete(payMethod).where(inArray(payMethod.id, dupeIds));
      });

      result.duplicatesRemoved += dupeIds.length;
      result.details.push({
        canonicalId: canonical.id,
        key,
        duplicateIds: dupeIds,
      });
    }

    return result;
  }

  async mergeCountryOperations(): Promise<MergeResult> {
    const dupeKeys = await db
      .select({
        merchantId: countryOperation.merchantId,
        providerId: countryOperation.providerId,
        countryId: countryOperation.countryId,
        payMethodId: countryOperation.payMethodId,
      })
      .from(countryOperation)
      .groupBy(
        countryOperation.merchantId,
        countryOperation.providerId,
        countryOperation.countryId,
        countryOperation.payMethodId,
      )
      .having(sql`count(*) > 1`);

    const result: MergeResult = {
      entity: "countryOperation",
      groupsFound: 0,
      duplicatesRemoved: 0,
      details: [],
    };

    if (dupeKeys.length === 0) return result;

    for (const dk of dupeKeys) {
      const records = await db
        .select()
        .from(countryOperation)
        .where(
          sql`${countryOperation.merchantId} = ${dk.merchantId}
            AND ${countryOperation.providerId} = ${dk.providerId}
            AND ${countryOperation.countryId} = ${dk.countryId}
            AND ${countryOperation.payMethodId} = ${dk.payMethodId}`
        );

      if (records.length <= 1) continue;
      result.groupsFound++;

      records.sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
      const canonical = records[0];
      const dupeIds = records.slice(1).map((r) => r.id);
      const key = `${dk.merchantId}|${dk.providerId}|${dk.countryId}|${dk.payMethodId}`;

      await db
        .delete(countryOperation)
        .where(inArray(countryOperation.id, dupeIds));

      result.duplicatesRemoved += dupeIds.length;
      result.details.push({
        canonicalId: canonical.id,
        key,
        duplicateIds: dupeIds,
      });
    }

    return result;
  }
}
