-- =========================================================================
-- EMS Platform Isolated Schemas DDL & Outbox Queues
-- Sized for 50 Concurrent Users, Strict Audit, SKIP LOCKED Outbox
-- =========================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Schemas
CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS eps;
CREATE SCHEMA IF NOT EXISTS wms;
CREATE SCHEMA IF NOT EXISTS mro;
CREATE SCHEMA IF NOT EXISTS prm;

-- Grant permissions
GRANT ALL ON SCHEMA core TO ems_admin;
GRANT ALL ON SCHEMA eps TO ems_admin;
GRANT ALL ON SCHEMA wms TO ems_admin;
GRANT ALL ON SCHEMA mro TO ems_admin;
GRANT ALL ON SCHEMA prm TO ems_admin;

-- =========================================================================
-- 1. CORE SCHEMA (Auth & Audit)
-- =========================================================================
CREATE TABLE IF NOT EXISTS core.users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  username VARCHAR(100) NOT NULL UNIQUE,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  first_name VARCHAR(100),
  last_name VARCHAR(100),
  roles TEXT[] DEFAULT '{}',
  permissions TEXT[] DEFAULT '{}',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS core.audit_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(100) NOT NULL,
  entity_id VARCHAR(100) NOT NULL,
  details JSONB,
  ip_address VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- =========================================================================
-- 2. EPS SCHEMA (Equipment Passport System)
-- =========================================================================
CREATE TABLE IF NOT EXISTS eps.categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL,
  parent_id UUID,
  code VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS eps.equipment (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  inventory_number VARCHAR(100) NOT NULL UNIQUE,
  serial_number VARCHAR(100),
  name VARCHAR(255) NOT NULL,
  model VARCHAR(255),
  category_id UUID,
  status VARCHAR(50) NOT NULL DEFAULT 'DRAFT',
  location VARCHAR(255),
  production_year INT,
  commissioning_year INT,
  initial_cost NUMERIC(15, 2) DEFAULT 0,
  wear_percentage NUMERIC(5, 2) DEFAULT 0,
  technical_specs JSONB DEFAULT '{}',
  custom_attributes JSONB DEFAULT '{}',
  operating_hours INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS eps.outbox (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  aggregate_type VARCHAR(50) NOT NULL DEFAULT 'Equipment',
  aggregate_id UUID NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  published BOOLEAN DEFAULT FALSE,
  published_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_eps_outbox_unpub ON eps.outbox (created_at) WHERE published = FALSE;

-- =========================================================================
-- 3. WMS SCHEMA (Warehouse Management System)
-- =========================================================================
CREATE TABLE IF NOT EXISTS wms.warehouses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(50) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  location VARCHAR(255),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wms.zones (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  warehouse_id UUID NOT NULL REFERENCES wms.warehouses(id) ON DELETE CASCADE,
  code VARCHAR(50) NOT NULL,
  name VARCHAR(100) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (warehouse_id, code)
);

CREATE TABLE IF NOT EXISTS wms.cells (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  zone_id UUID NOT NULL REFERENCES wms.zones(id) ON DELETE CASCADE,
  code VARCHAR(50) NOT NULL,
  name VARCHAR(100),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (zone_id, code)
);

CREATE TABLE IF NOT EXISTS wms.stock_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  warehouse_id UUID NOT NULL REFERENCES wms.warehouses(id) ON DELETE CASCADE,
  cell_id UUID REFERENCES wms.cells(id) ON DELETE SET NULL,
  sku VARCHAR(100) NOT NULL,
  name VARCHAR(255) NOT NULL,
  unit VARCHAR(20) DEFAULT 'pcs',
  quantity_on_hand NUMERIC(15, 3) DEFAULT 0,
  quantity_reserved NUMERIC(15, 3) DEFAULT 0,
  min_stock_threshold NUMERIC(15, 3) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (warehouse_id, sku)
);

CREATE TABLE IF NOT EXISTS wms.stock_batches (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  stock_item_id UUID NOT NULL REFERENCES wms.stock_items(id) ON DELETE CASCADE,
  batch_number VARCHAR(100) NOT NULL,
  quantity NUMERIC(15, 3) NOT NULL,
  initial_quantity NUMERIC(15, 3) NOT NULL,
  unit_cost NUMERIC(15, 2) DEFAULT 0,
  supplier VARCHAR(255),
  received_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS wms.stock_movements (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  stock_item_id UUID NOT NULL REFERENCES wms.stock_items(id) ON DELETE CASCADE,
  warehouse_id UUID NOT NULL REFERENCES wms.warehouses(id),
  operation_type VARCHAR(50) NOT NULL,
  quantity NUMERIC(15, 3) NOT NULL,
  work_order_id UUID,
  equipment_id UUID,
  counterparty VARCHAR(255),
  comment TEXT,
  created_by_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wms.outbox (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  aggregate_type VARCHAR(50) NOT NULL DEFAULT 'StockItem',
  aggregate_id UUID NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  published BOOLEAN DEFAULT FALSE,
  published_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_wms_outbox_unpub ON wms.outbox (created_at) WHERE published = FALSE;

-- =========================================================================
-- 4. MRO SCHEMA (Maintenance, Repair & Operations)
-- =========================================================================
CREATE TABLE IF NOT EXISTS mro.maintenance_plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  equipment_id UUID NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  frequency VARCHAR(50) NOT NULL,
  interval_days INT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mro.work_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  equipment_id UUID NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  assigned_engineer_id UUID,
  status VARCHAR(50) NOT NULL DEFAULT 'PLANNED',
  scheduled_date TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  operating_hours_at_completion INT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mro.checklist_results (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  work_order_id UUID NOT NULL REFERENCES mro.work_orders(id) ON DELETE CASCADE,
  items JSONB NOT NULL,
  completed_by_id UUID,
  completed_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (work_order_id)
);

CREATE TABLE IF NOT EXISTS mro.downtime_logs (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  equipment_id UUID NOT NULL,
  work_order_id UUID REFERENCES mro.work_orders(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  reason VARCHAR(100) NOT NULL,
  description TEXT,
  logged_by_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mro.outbox (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  aggregate_type VARCHAR(50) NOT NULL DEFAULT 'WorkOrder',
  aggregate_id UUID NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  published BOOLEAN DEFAULT FALSE,
  published_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_mro_outbox_unpub ON mro.outbox (created_at) WHERE published = FALSE;

-- =========================================================================
-- 5. PRM SCHEMA (Procurement & Requisitions)
-- =========================================================================
CREATE TABLE IF NOT EXISTS prm.purchase_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  order_number VARCHAR(100) NOT NULL UNIQUE,
  vendor VARCHAR(255) NOT NULL,
  total_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
  currency VARCHAR(10) DEFAULT 'RUB',
  status VARCHAR(50) NOT NULL DEFAULT 'DRAFT',
  requested_by_id UUID,
  department_id UUID,
  ordered_at TIMESTAMPTZ,
  expected_delivery_date TIMESTAMPTZ,
  fulfilled_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS prm.order_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  purchase_order_id UUID NOT NULL REFERENCES prm.purchase_orders(id) ON DELETE CASCADE,
  nomenclature_id UUID NOT NULL,
  sku VARCHAR(100) NOT NULL,
  name VARCHAR(255) NOT NULL,
  quantity NUMERIC(15, 3) NOT NULL,
  unit VARCHAR(20) DEFAULT 'pcs',
  unit_price NUMERIC(15, 2) NOT NULL,
  total_price NUMERIC(15, 2) NOT NULL
);

CREATE TABLE IF NOT EXISTS prm.deliveries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  purchase_order_id UUID NOT NULL REFERENCES prm.purchase_orders(id) ON DELETE CASCADE,
  receipt_number VARCHAR(100) NOT NULL,
  received_by_id UUID,
  received_at TIMESTAMPTZ DEFAULT NOW(),
  items_received JSONB NOT NULL,
  supplier_rating INT DEFAULT 5,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS prm.outbox (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  aggregate_type VARCHAR(50) NOT NULL DEFAULT 'PurchaseOrder',
  aggregate_id UUID NOT NULL,
  event_type VARCHAR(100) NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  published BOOLEAN DEFAULT FALSE,
  published_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_prm_outbox_unpub ON prm.outbox (created_at) WHERE published = FALSE;
