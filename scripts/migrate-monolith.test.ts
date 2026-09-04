import { describe, it, expect, vi } from 'vitest';
const { MonolithMigrator } = require('./migrate-monolith.cjs');

describe('MonolithMigrator ETL & Integrity Verification', () => {
  const createMockDbClient = (options: { errorType?: 'withMessage' | 'withoutMessage' } = {}) => {
    const executedQueries: string[] = [];
    return {
      executedQueries,
      query: vi.fn(async (sql: string) => {
        executedQueries.push(sql);
        if (options.errorType === 'withMessage' && sql.includes('INSERT INTO eps.equipment')) {
          throw new Error('Foreign key violation in legacy equipment');
        }
        if (options.errorType === 'withoutMessage' && sql.includes('INSERT INTO eps.equipment')) {
          throw 'Generic database error string';
        }

        if (sql.includes('SELECT COUNT(*)')) {
          if (sql.includes('core.users')) return { rows: [{ count: 15 }] };
          if (sql.includes('eps.categories')) return { rows: [{ count: 8 }] };
          if (sql.includes('eps.equipment')) return { rows: [{ count: 142 }] };
          if (sql.includes('wms.warehouses')) return { rows: [{ count: 3 }] };
          if (sql.includes('wms.stock_items')) return { rows: [{ count: 310 }] };
          if (sql.includes('mro.work_orders')) return { rows: [{ count: 76 }] };
          if (sql.includes('prm.purchase_orders')) return { rows: [{ count: 24 }] };
          return { rows: [{ count: 0 }] };
        }

        return { rows: [] };
      })
    };
  };

  it('runs full migration transactionally and collects table counts', async () => {
    const client = createMockDbClient();
    const migrator = new MonolithMigrator(client);

    const result = await migrator.migrateAll();

    expect(result.passed).toBe(true);
    expect(result.errors).toHaveLength(0);

    const tables = result.counts.map((c: any) => c.targetTable);
    expect(tables).toContain('core.users');
    expect(tables).toContain('eps.categories');
    expect(tables).toContain('eps.equipment');
    expect(tables).toContain('wms.warehouses');
    expect(tables).toContain('wms.stock_items');
    expect(tables).toContain('mro.work_orders');
    expect(tables).toContain('prm.purchase_orders');

    const equipmentCount = result.counts.find((c: any) => c.targetTable === 'eps.equipment');
    expect(equipmentCount?.count).toBe(142);

    expect(client.executedQueries[0]).toBe('BEGIN');
    expect(client.executedQueries[client.executedQueries.length - 1]).toBe('COMMIT');
  });

  it('rolls back on Error instance with message', async () => {
    const client = createMockDbClient({ errorType: 'withMessage' });
    const migrator = new MonolithMigrator(client);

    const result = await migrator.migrateAll();

    expect(result.passed).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('Foreign key violation in legacy equipment');
    expect(client.executedQueries).toContain('ROLLBACK');
  });

  it('rolls back on raw string error', async () => {
    const client = createMockDbClient({ errorType: 'withoutMessage' });
    const migrator = new MonolithMigrator(client);

    const result = await migrator.migrateAll();

    expect(result.passed).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toBe('Generic database error string');
    expect(client.executedQueries).toContain('ROLLBACK');
  });
});
