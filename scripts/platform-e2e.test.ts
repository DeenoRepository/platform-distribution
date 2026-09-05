import { describe, it, expect, vi } from 'vitest';

// 1. EPS Domain Imports
import { EquipmentAggregate } from '../../module-eps/src/domain/equipment-aggregate.js';

// 2. WMS Domain Imports
import { WarehouseTopology } from '../../module-wms/src/domain/warehouse-topology.js';
import { StockAggregate } from '../../module-wms/src/domain/stock-aggregate.js';

// 3. MRO Domain Imports
import { WorkOrderAggregate } from '../../module-mro/src/domain/work-order-aggregate.js';
import { MaintenanceService } from '../../module-mro/src/domain/maintenance-service.js';

// 4. PRM Domain Imports
import { PurchaseOrderAggregate } from '../../module-prm/src/domain/purchase-order-aggregate.js';

// 5. Shell Host & Runtime Imports
import { InMemoryEventBus } from '../../platform-shell/src/kernel/event-bus-impl.js';
import { CrossModuleEventBridge } from '../../platform-shell/src/kernel/cross-module-event-bridge.js';
import { LifecycleManager } from '../../platform-shell/src/kernel/lifecycle-manager.js';
import { RbacGuard } from '../../platform-shell/src/security/rbac-guard.js';
import { HttpGateway } from '../../platform-shell/src/http/http-gateway.js';
import { FederationHostResolver } from '../../platform-shell/src/federation/federation-host.js';
import { IOutboxStore, OutboxStoreRecord } from '../../platform-shell/src/kernel/outbox-dispatcher.js';

describe('EMS Platform End-to-End Choreography & Smoke Verification', () => {
  const createMemoryOutboxStore = (initialRecords: OutboxStoreRecord[] = []): IOutboxStore => {
    const records: OutboxStoreRecord[] = [...initialRecords];
    return {
      fetchUnpublished: vi.fn(async (limit: number) => {
        return records.filter(r => !r.published).slice(0, limit);
      }),
      markAsPublished: vi.fn(async (ids: string[]) => {
        for (const r of records) {
          if (ids.includes(r.id)) r.published = true;
        }
      })
    };
  };

  it('orchestrates complete industrial lifecycle across all 4 domain modules and platform shell', async () => {
    // ------------------------------------------------------------------------
    // Step 0: Initialize Microkernel Runtime, EventBus, and HTTP Gateway
    // ------------------------------------------------------------------------
    const eventBus = new InMemoryEventBus();
    const eventBridge = new CrossModuleEventBridge(eventBus);
    const lifecycleManager = new LifecycleManager();
    const rbacGuard = new RbacGuard();

    const gateway = new HttpGateway({
      eventBus,
      lifecycleManager,
      rbacGuard,
      eventBridge
    });

    await gateway.start();

    // Register Microfrontends in Federation Host
    const federationResolver = new FederationHostResolver();
    const remotes = federationResolver.getRemotes();
    expect(remotes.eps).toBeDefined();
    expect(remotes.wms).toBeDefined();
    expect(remotes.mro).toBeDefined();
    expect(remotes.prm).toBeDefined();

    // Verify Liveness & Readiness Probes
    const health = await gateway.handleRequest({ method: 'GET', url: '/health', headers: {} });
    expect(health.statusCode).toBe(200);

    const ready = await gateway.handleRequest({ method: 'GET', url: '/ready', headers: {} });
    expect(ready.statusCode).toBe(200);

    // Track all published domain events
    const receivedDomainEvents: Array<{ type: string; payload: any }> = [];
    eventBus.subscribe('*', (envelope: any) => {
      receivedDomainEvents.push({
        type: envelope.type,
        payload: envelope.payload
      });
    });

    // ------------------------------------------------------------------------
    // Step 1: EPS Domain - Register Equipment Passport and Generate QR Label
    // ------------------------------------------------------------------------
    const equipmentId = '00000000-0000-4000-8000-000000000001';
    const epsAggregate = EquipmentAggregate.create({
      id: equipmentId,
      name: 'Centrifugal High-Pressure Water Pump',
      model: 'CP-500X',
      inventoryNumber: 'EQ-PUMP-2026-001',
      serialNumber: 'SN-998822',
      category: 'Pumping Equipment',
      location: 'Workshop 2 / Sector B',
      initialCost: 150000,
      lifespanYears: 10
    });

    // Update technical specifications (voltage, max pressure, rpm)
    epsAggregate.updateTechnicalSpecifications({
      operatingHours: 1200,
      powerKw: 45,
      voltageV: 380,
      maxPressureBar: 16,
      rotationSpeedRpm: 2950
    });

    // Generate crisp thermal SVG label for printing
    const labelSvg = epsAggregate.generateThermalLabelSvg('58mm');
    expect(labelSvg).toContain('<svg');
    expect(labelSvg).toContain('EQ-PUMP-2026-001');

    expect(epsAggregate.outboxEvents.map(e => e.eventType)).toContain('eps.equipment.created');
    expect(epsAggregate.outboxEvents.map(e => e.eventType)).toContain('eps.equipment.technical_specs_updated');

    // ------------------------------------------------------------------------
    // Step 2: WMS Domain - Topology Setup & Spare Parts Batch Receipt
    // ------------------------------------------------------------------------
    const warehouseTopology = WarehouseTopology.create({
      id: '00000000-0000-4000-8000-000000000002',
      code: 'WH-MAIN',
      name: 'Main Technical Storage',
      location: 'Building 1',
      isActive: true
    });

    warehouseTopology.addZone({
      id: '00000000-0000-4000-8000-000000000003',
      code: 'ZONE-BEARINGS',
      name: 'Mechanical Seals and Bearings'
    });

    warehouseTopology.addCellToZone('ZONE-BEARINGS', {
      id: '00000000-0000-4000-8000-000000000004',
      code: 'CELL-B01',
      name: 'Rack 1, Shelf 2',
      isActive: true
    });

    const stockItemId = '00000000-0000-4000-8000-000000000005';
    const wmsAggregate = StockAggregate.create({
      id: stockItemId,
      sku: 'BEARING-6204-RS',
      name: 'Heavy Duty Deep Groove Ball Bearing 6204',
      warehouseId: warehouseTopology.id,
      quantityOnHand: 0,
      minStockThreshold: 5
    });

    wmsAggregate.assignCell('00000000-0000-4000-8000-000000000004');

    // Receive initial batch of 6 bearings
    wmsAggregate.receiveBatch({
      batchNumber: 'BATCH-2026-SKF-01',
      quantity: 6,
      unitCost: 120,
      supplier: 'SKF Industrial Distributor',
      userId: 'user-warehouse-lead'
    });

    expect(wmsAggregate.availableQuantity).toBe(6);
    expect(wmsAggregate.outboxEvents.map(e => e.eventType)).toContain('wms.stock.received');

    // ------------------------------------------------------------------------
    // Step 3: MRO Domain - Work Order Execution & Spare Parts Consumption
    // ------------------------------------------------------------------------
    const workOrderId = '00000000-0000-4000-8000-000000000006';
    const mroAggregate = WorkOrderAggregate.create({
      id: workOrderId,
      equipmentId: epsAggregate.props.id,
      title: 'Emergency Bearing Replacement and Impeller Realignment',
      description: 'Excessive vibration detected on drive end',
      scheduledDate: new Date('2026-09-05T08:00:00Z')
    });

    mroAggregate.assignEngineer('00000000-0000-4000-8000-000000000007');
    expect(mroAggregate.status).toBe('ASSIGNED');

    // Request 2 bearings from warehouse
    const partReq = mroAggregate.requestSparePart({
      nomenclatureId: stockItemId,
      warehouseId: warehouseTopology.id,
      quantity: 2
    });

    // WMS: Reserve 2 bearings under this work order
    const reservation = wmsAggregate.reserve(2, workOrderId);
    expect(wmsAggregate.availableQuantity).toBe(4);
    expect(wmsAggregate.props.quantityReserved).toBe(2);

    // MRO: Start work and log downtime
    const downtimeStart = new Date('2026-09-05T09:00:00Z');
    mroAggregate.startWork(downtimeStart);
    mroAggregate.recordDowntime('MECHANICAL_WEAR', 'Drive end bearing seizure', 'engineer-01', downtimeStart);

    // WMS: Issue the reserved bearings for the equipment
    wmsAggregate.issue(2, 'Engineer Alex', {
      reservationId: reservation.reservationId,
      workOrderId,
      equipmentId: epsAggregate.props.id
    });
    expect(wmsAggregate.props.quantityOnHand).toBe(4);
    expect(wmsAggregate.availableQuantity).toBe(4);

    // MRO: Confirm part issuance
    mroAggregate.confirmPartIssued(partReq.id, reservation.reservationId);

    // Evaluate checklist
    const checklistTemplates = [
      {
        id: '00000000-0000-4000-8000-000000000008',
        templateId: '00000000-0000-4000-8000-000000000009',
        description: 'Check shaft runout (mm)',
        itemType: 'NUMERIC' as const,
        sortOrder: 1,
        isRequired: true,
        minValue: 0,
        maxValue: 0.05
      }
    ];
    const mroService = new MaintenanceService();
    const evalResults = mroService.evaluateChecklist(checklistTemplates, [
      { itemId: '00000000-0000-4000-8000-000000000008', value: 0.02 }
    ]);
    mroAggregate.submitChecklistResults(evalResults);

    // Complete work order and close downtime (operating hours updated to 1205)
    const downtimeEnd = new Date('2026-09-05T11:00:00Z');
    mroAggregate.complete(1205, downtimeEnd);
    expect(mroAggregate.status).toBe('COMPLETED');
    expect(mroAggregate.downtime?.endedAt).toEqual(downtimeEnd);

    // ------------------------------------------------------------------------
    // Step 4: PRM Domain - Replenishment Purchase Order
    // ------------------------------------------------------------------------
    const orderId = '00000000-0000-4000-8000-000000000010';
    const prmAggregate = PurchaseOrderAggregate.create({
      id: orderId,
      orderNumber: 'PO-2026-REPL-001',
      vendor: 'SKF Bearings Global Supply',
      totalAmount: 0,
      requestedById: 'user-warehouse-lead'
    });

    prmAggregate.addItem({
      nomenclatureId: stockItemId,
      sku: 'BEARING-6204-RS',
      name: 'Heavy Duty Deep Groove Ball Bearing 6204',
      quantity: 50,
      unit: 'pcs',
      unitPrice: 110 // Total: 5500 RUB -> CHIEF_ENGINEER tier
    });

    expect(prmAggregate.totalAmount).toBe(5500);
    prmAggregate.submit();
    expect(prmAggregate.status).toBe('SUBMITTED');

    // Review & approve via Chief Engineer
    prmAggregate.recordApproval(
      '00000000-0000-4000-8000-000000000011',
      'Chief Engineer Michael',
      'CHIEF_ENGINEER',
      'APPROVED',
      'Approved for quarterly stock replenishment'
    );
    expect(prmAggregate.status).toBe('APPROVED');

    // Dispatch order to vendor
    prmAggregate.dispatchToVendor(new Date('2026-09-15'));
    expect(prmAggregate.status).toBe('ORDERED');

    // Record receipt from vendor
    prmAggregate.recordDelivery({
      receiptNumber: 'DELIV-2026-0905',
      receivedById: 'user-warehouse-lead',
      itemsReceived: [
        {
          nomenclatureId: stockItemId,
          quantityReceived: 50,
          condition: 'ACCEPTED'
        }
      ],
      supplierRating: 5
    });
    expect(prmAggregate.status).toBe('FULFILLED');

    // ------------------------------------------------------------------------
    // Step 5: Platform Shell - Cross-Module Outbox Dispatching & Event Bus Routing
    // ------------------------------------------------------------------------
    // Collect Outbox events from all 4 domain aggregates
    const epsRecords: OutboxStoreRecord[] = epsAggregate.outboxEvents.map(e => ({
      id: e.id,
      aggregateId: e.aggregateId,
      eventType: e.eventType,
      payload: e.payload,
      createdAt: e.createdAt,
      published: false
    }));

    const wmsRecords: OutboxStoreRecord[] = wmsAggregate.outboxEvents.map(e => ({
      id: e.id,
      aggregateId: e.aggregateId,
      eventType: e.eventType,
      payload: e.payload,
      createdAt: e.createdAt,
      published: false
    }));

    const mroRecords: OutboxStoreRecord[] = mroAggregate.outboxEvents.map(e => ({
      id: e.id,
      aggregateId: e.aggregateId,
      eventType: e.eventType,
      payload: e.payload,
      createdAt: e.createdAt,
      published: false
    }));

    const prmRecords: OutboxStoreRecord[] = prmAggregate.outboxEvents.map(e => ({
      id: e.id,
      aggregateId: e.aggregateId,
      eventType: e.eventType,
      payload: e.payload,
      createdAt: e.createdAt,
      published: false
    }));

    eventBridge.registerModule({
      moduleName: 'eps',
      schema: 'eps',
      store: createMemoryOutboxStore(epsRecords)
    });

    eventBridge.registerModule({
      moduleName: 'wms',
      schema: 'wms',
      store: createMemoryOutboxStore(wmsRecords)
    });

    eventBridge.registerModule({
      moduleName: 'mro',
      schema: 'mro',
      store: createMemoryOutboxStore(mroRecords)
    });

    eventBridge.registerModule({
      moduleName: 'prm',
      schema: 'prm',
      store: createMemoryOutboxStore(prmRecords)
    });

    const dispatchCounts = await eventBridge.pollAllOnce(100);
    expect(dispatchCounts.eps).toBeGreaterThanOrEqual(2);
    expect(dispatchCounts.wms).toBeGreaterThanOrEqual(3);
    expect(dispatchCounts.mro).toBeGreaterThanOrEqual(4);
    expect(dispatchCounts.prm).toBeGreaterThanOrEqual(4);

    // Verify all domain event types reached the central EventBus
    const publishedTypes = receivedDomainEvents.map(e => e.type);
    expect(publishedTypes).toContain('eps.equipment.created');
    expect(publishedTypes).toContain('eps.equipment.technical_specs_updated');
    expect(publishedTypes).toContain('wms.stock.created');
    expect(publishedTypes).toContain('wms.stock.cell_assigned');
    expect(publishedTypes).toContain('wms.stock.received');
    expect(publishedTypes).toContain('wms.stock.reserved');
    expect(publishedTypes).toContain('wms.stock.issued');
    expect(publishedTypes).toContain('mro.work_order.created');
    expect(publishedTypes).toContain('mro.work_order.assigned');
    expect(publishedTypes).toContain('mro.work_order.started');
    expect(publishedTypes).toContain('mro.equipment.downtime_started');
    expect(publishedTypes).toContain('mro.parts.requested');
    expect(publishedTypes).toContain('mro.parts.issued');
    expect(publishedTypes).toContain('mro.checklist.evaluated');
    expect(publishedTypes).toContain('mro.maintenance.completed');
    expect(publishedTypes).toContain('prm.order.created');
    expect(publishedTypes).toContain('prm.order.submitted');
    expect(publishedTypes).toContain('prm.order.approved');
    expect(publishedTypes).toContain('prm.order.ordered');
    expect(publishedTypes).toContain('prm.order.fulfilled');

    // ------------------------------------------------------------------------
    // Step 6: Verify RBAC Gateways and Clean Shutdown
    // ------------------------------------------------------------------------
    expect(rbacGuard.hasAccess(['admin'], [], 'mro:work_order:read')).toBe(true);
    expect(rbacGuard.hasAccess(['engineer'], ['mro:*'], 'mro:work_order:read')).toBe(true);
    expect(rbacGuard.hasAccess(['viewer'], ['eps:equipment:read'], 'wms:stock:read')).toBe(false);

    await gateway.stop();
  });
});
