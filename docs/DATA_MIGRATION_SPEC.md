# Monolith to Multi-Schema Migration Specification

This document details the field-by-field and table-by-table mapping from the monolithic single-schema database to the decoupled schemas in PostgreSQL.

## 1. Schema Assignment

| Monolith Table | Target Schema & Table | Extraction Notes |
|---|---|---|
| `User`, `Role`, `Session` | `core.users`, `core.roles`, `core.sessions` | Core identity and RBAC |
| `AuditLog` | `core.audit_log` | System-level security log |
| `Equipment`, `Category` | `eps.equipment`, `eps.categories` | Decoupled: remove foreign key to WMS/MRO |
| `StockItem`, `Warehouse`, `Batch` | `wms.stock_items`, `wms.warehouses`, `wms.batches` | Isolated inventory |
| `MaintenanceSchedule`, `WorkOrder` | `mro.schedules`, `mro.work_orders` | References equipment via inventory number |
| `ProcurementDemand`, `PurchaseOrder` | `prm.demands`, `prm.orders` | References stock via SKU string |

## 2. Decoupling Rules
1. All foreign keys between domains are converted to plain string identifiers (UUID or Business Key).
2. Data consistency is maintained via domain event subscriptions (@deenorepository/contracts).
