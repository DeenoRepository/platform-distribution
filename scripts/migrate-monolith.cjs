/**
 * Monolith to Decoupled Schemas ETL Migration & Verification Runner
 * Usage: node scripts/migrate-monolith.cjs [--dry-run] [--verify]
 */

class MonolithMigrator {
  constructor(dbClient) {
    this.dbClient = dbClient;
  }

  async migrateAll() {
    const errors = [];
    const counts = [];

    try {
      await this.dbClient.query('BEGIN');

      // 1. Core Users
      await this.dbClient.query(`
        INSERT INTO core.users (id, username, email, password_hash, first_name, last_name, roles, permissions, is_active, created_at, updated_at)
        SELECT 
          id,
          username,
          email,
          password AS password_hash,
          first_name,
          last_name,
          ARRAY[role::text] AS roles,
          '{}'::text[] AS permissions,
          COALESCE(is_active, TRUE),
          created_at,
          updated_at
        FROM public."User"
        ON CONFLICT (id) DO NOTHING;
      `);
      const usersCount = await this.getTableCount('core.users');
      counts.push({ sourceTable: 'public.User', targetTable: 'core.users', count: usersCount });

      // 2. EPS Equipment Categories
      await this.dbClient.query(`
        INSERT INTO eps.categories (id, name, parent_id, code, created_at)
        SELECT id, name, parent_id, code, created_at
        FROM public."Category"
        ON CONFLICT (id) DO NOTHING;
      `);
      const categoriesCount = await this.getTableCount('eps.categories');
      counts.push({ sourceTable: 'public.Category', targetTable: 'eps.categories', count: categoriesCount });

      // 3. EPS Equipment
      await this.dbClient.query(`
        INSERT INTO eps.equipment (
          id, inventory_number, serial_number, name, model, category_id,
          status, location, production_year, commissioning_year, initial_cost,
          wear_percentage, technical_specs, custom_attributes, operating_hours,
          created_at, updated_at
        )
        SELECT 
          id,
          inventory_number,
          serial_number,
          name,
          model,
          category_id,
          COALESCE(status, 'DRAFT'),
          location,
          production_year,
          commissioning_year,
          COALESCE(initial_cost, 0),
          COALESCE(wear_percentage, 0),
          COALESCE(technical_specs, '{}'::jsonb),
          COALESCE(custom_attributes, '{}'::jsonb),
          COALESCE(operating_hours, 0),
          created_at,
          updated_at
        FROM public."Equipment"
        ON CONFLICT (id) DO NOTHING;
      `);
      const eqCount = await this.getTableCount('eps.equipment');
      counts.push({ sourceTable: 'public.Equipment', targetTable: 'eps.equipment', count: eqCount });

      // 4. WMS Warehouses, Zones, Cells
      await this.dbClient.query(`
        INSERT INTO wms.warehouses (id, code, name, location, is_active, created_at)
        SELECT id, code, name, location, COALESCE(is_active, TRUE), created_at
        FROM public."Warehouse"
        ON CONFLICT (id) DO NOTHING;
      `);
      const whCount = await this.getTableCount('wms.warehouses');
      counts.push({ sourceTable: 'public.Warehouse', targetTable: 'wms.warehouses', count: whCount });

      await this.dbClient.query(`
        INSERT INTO wms.zones (id, warehouse_id, code, name, created_at)
        SELECT id, warehouse_id, code, name, created_at
        FROM public."StorageZone"
        ON CONFLICT (id) DO NOTHING;
      `);

      await this.dbClient.query(`
        INSERT INTO wms.cells (id, zone_id, code, name, is_active, created_at)
        SELECT id, zone_id, code, name, TRUE, created_at
        FROM public."StorageCell"
        ON CONFLICT (id) DO NOTHING;
      `);

      // 5. WMS Stock Items
      await this.dbClient.query(`
        INSERT INTO wms.stock_items (id, warehouse_id, cell_id, sku, name, unit, quantity_on_hand, quantity_reserved, min_stock_threshold, created_at, updated_at)
        SELECT 
          s.id,
          s.warehouse_id,
          s.cell_id,
          COALESCE(n.article, s.id::text) AS sku,
          n.name,
          COALESCE(n.unit, 'pcs'),
          s.quantity AS quantity_on_hand,
          0 AS quantity_reserved,
          COALESCE(n.min_stock, 0) AS min_stock_threshold,
          s.updated_at AS created_at,
          s.updated_at
        FROM public."StockItem" s
        JOIN public."Nomenclature" n ON s.nomenclature_id = n.id
        ON CONFLICT (id) DO NOTHING;
      `);
      const stockCount = await this.getTableCount('wms.stock_items');
      counts.push({ sourceTable: 'public.StockItem', targetTable: 'wms.stock_items', count: stockCount });

      // 6. MRO Work Orders
      await this.dbClient.query(`
        INSERT INTO mro.work_orders (id, equipment_id, title, description, assigned_engineer_id, status, scheduled_date, started_at, completed_at, operating_hours_at_completion, created_at, updated_at)
        SELECT 
          id,
          equipment_id,
          title,
          notes AS description,
          completed_by_id AS assigned_engineer_id,
          COALESCE(status, 'PLANNED'),
          scheduled_date,
          CASE WHEN status IN ('IN_PROGRESS', 'COMPLETED') THEN scheduled_date ELSE NULL END AS started_at,
          completed_date AS completed_at,
          NULL AS operating_hours_at_completion,
          created_at,
          updated_at
        FROM public."MaintenanceSchedule"
        ON CONFLICT (id) DO NOTHING;
      `);
      const woCount = await this.getTableCount('mro.work_orders');
      counts.push({ sourceTable: 'public.MaintenanceSchedule', targetTable: 'mro.work_orders', count: woCount });

      // 7. PRM Purchase Orders
      await this.dbClient.query(`
        INSERT INTO prm.purchase_orders (id, order_number, vendor, total_amount, currency, status, requested_by_id, created_at, updated_at)
        SELECT 
          id,
          COALESCE('PR-' || SUBSTRING(id::text, 1, 8), 'PR-UNKNOWN') AS order_number,
          'Standard Supplier' AS vendor,
          0 AS total_amount,
          'RUB' AS currency,
          'APPROVED' AS status,
          requested_by_id,
          created_at,
          updated_at
        FROM public."PurchaseRequest"
        ON CONFLICT (id) DO NOTHING;
      `);
      const poCount = await this.getTableCount('prm.purchase_orders');
      counts.push({ sourceTable: 'public.PurchaseRequest', targetTable: 'prm.purchase_orders', count: poCount });

      await this.dbClient.query('COMMIT');
    } catch (err) {
      await this.dbClient.query('ROLLBACK');
      errors.push(err.message ? err.message : String(err));
    }

    return {
      passed: errors.length === 0,
      counts,
      errors
    };
  }

  async getTableCount(qualifiedTable) {
    const res = await this.dbClient.query(`SELECT COUNT(*)::int AS count FROM ${qualifiedTable}`);
    return res.rows[0].count;
  }
}

module.exports = { MonolithMigrator };
