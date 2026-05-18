/**
 * Integration test for migration 025 (PR-D1) — the AFTER DELETE
 * trigger on `dedup_rules` and the B1/B2 seed shape.
 *
 * Unit tests cover the JS-level pieces (route handler logic,
 * `seedDefaultDedupRules` helper, the drift guard between PRESETS and
 * the migration SQL). What only a real Postgres can validate is the
 * trigger fires + the polymorphic `notification_throttle` cleanup
 * actually happens at the DB level — and that the migration's seed
 * INSERTs round-trip through the Zod schema when the row is parsed
 * back on read.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { DatabaseClient } from '../../src/db/client.js';
import { parseDedupRule } from '../../src/integrations/dedup-rule.schema.js';
import { seedDefaultDedupRules } from '../../src/services/rules/seed.js';
import { createTestDatabase } from '../setup.integration';
import { createTestProject, createTestUser } from '../utils/test-utils';

describe('Migration 025 — dedup_rules cascade trigger + seed', () => {
  let db: DatabaseClient;
  let projectId: string;

  beforeEach(async () => {
    db = await createTestDatabase();
    const { user } = await createTestUser(db);
    const project = await createTestProject(db, { created_by: user.id });
    projectId = project.id;
  });

  afterEach(async () => {
    await db.close();
  });

  describe('AFTER DELETE trigger on dedup_rules', () => {
    it('cascade-deletes notification_throttle rows referencing the rule', async () => {
      // Seed the project so we have a real dedup_rules row to delete.
      // The seed hook runs idempotent INSERTs through the repository.
      await seedDefaultDedupRules(db.dedupRules, projectId);

      const rules = await db.dedupRules.findByProject(projectId, true);
      expect(rules).toHaveLength(2);
      const target = rules.find((r) => r.name === 'Counter on canonical')!;

      // Drop a synthetic throttle row pointing at the rule (the
      // executor's rate-limiter normally writes this; we forge it
      // directly because the executor isn't running in this test).
      await db.getPool().query(
        `INSERT INTO application.notification_throttle
           (rule_id, group_key, count, window_start, window_end)
         VALUES ($1, $2, 1, NOW(), NOW() + INTERVAL '1 hour')`,
        [target.id, 'test-group']
      );
      const before = await db
        .getPool()
        .query(`SELECT 1 FROM application.notification_throttle WHERE rule_id = $1`, [target.id]);
      expect(before.rowCount).toBe(1);

      // Delete the rule — the trigger should sweep the throttle row.
      await db.dedupRules.delete(target.id);

      const after = await db
        .getPool()
        .query(`SELECT 1 FROM application.notification_throttle WHERE rule_id = $1`, [target.id]);
      expect(after.rowCount).toBe(0);
    });

    it('does not affect throttle rows for unrelated rule IDs', async () => {
      await seedDefaultDedupRules(db.dedupRules, projectId);
      const rules = await db.dedupRules.findByProject(projectId, true);
      const [r1, r2] = rules;

      // Throttle rows for both rules.
      for (const r of [r1, r2]) {
        await db.getPool().query(
          `INSERT INTO application.notification_throttle
             (rule_id, group_key, count, window_start, window_end)
           VALUES ($1, $2, 1, NOW(), NOW() + INTERVAL '1 hour')`,
          [r.id, 'g']
        );
      }

      // Deleting r1 leaves r2's row intact — the trigger's WHERE
      // clause filters by rule_id, not by table.
      await db.dedupRules.delete(r1.id);

      const remaining = await db
        .getPool()
        .query(`SELECT rule_id FROM application.notification_throttle`);
      const ids = remaining.rows.map((row) => row.rule_id);
      expect(ids).toEqual([r2.id]);
    });
  });

  describe('Migration 025 seed shape', () => {
    it("seeds B1 disabled and B2 enabled (matches PR-D1's security stance)", async () => {
      await seedDefaultDedupRules(db.dedupRules, projectId);
      const rules = await db.dedupRules.findByProject(projectId, true);
      const b1 = rules.find((r) => r.name === 'Notify reporter on dedup')!;
      const b2 = rules.find((r) => r.name === 'Counter on canonical')!;
      expect(b1.enabled).toBe(false);
      expect(b2.enabled).toBe(true);
    });

    it('every seeded preset round-trips through parseDedupRule', async () => {
      // The drift unit test reads migration 025 statically; this test
      // proves the actual rows the runtime wrote also parse — catches
      // any pg-level serialization difference (e.g. jsonb column
      // dropping unknown keys) that the static check would miss.
      await seedDefaultDedupRules(db.dedupRules, projectId);
      const rules = await db.dedupRules.findByProject(projectId, true);
      for (const r of rules) {
        expect(() => parseDedupRule(r.rule_json)).not.toThrow();
      }
    });

    it('is idempotent — re-running the seed leaves the same two rows', async () => {
      await seedDefaultDedupRules(db.dedupRules, projectId);
      await seedDefaultDedupRules(db.dedupRules, projectId);
      const rules = await db.dedupRules.findByProject(projectId, true);
      expect(rules).toHaveLength(2);
    });
  });
});
