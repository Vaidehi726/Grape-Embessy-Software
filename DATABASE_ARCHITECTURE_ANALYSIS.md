# Database Architecture Analysis & Data Flow Redesign

## Executive Summary

This document provides a comprehensive analysis of the current database architecture, identifies connectivity issues, schema mismatches, and problematic data flow patterns, then proposes a redesigned architecture.

---

## 1. Current Architecture Overview

### 1.1 Database Layers

The application currently has **THREE separate database systems**:

| Database | Location | Purpose | Technology |
|----------|----------|---------|------------|
| **Supabase Cloud** | Remote server | Central cloud database, multi-device sync | PostgreSQL (managed) |
| **Local SQLite** | `%APPDATA%/RestroFlow/restroflow.db` | Offline-first local cache for single-device mode | better-sqlite3 |
| **LAN Server SQLite** | `%APPDATA%/RestroFlow/lan-server-data/lan-server.db` | Shared database for LAN mode multi-device | better-sqlite3 |

### 1.2 Data Flow Modes

The application operates in **three distinct modes**:

```
┌─────────────────────────────────────────────────────────────────────┐
│                        MODE 1: WEB MODE                             │
│                                                                     │
│  React App ←→ Supabase Cloud (PostgreSQL)                          │
│  - Direct API calls                                                │
│  - Real-time subscriptions                                         │
│  - No offline support                                              │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                   MODE 2: ELECTRON LOCAL MODE                       │
│                                                                     │
│  React App ←→ Local SQLite ←→ Manual Sync ←→ Supabase Cloud       │
│  - All reads from local SQLite                                     │
│  - All writes to local SQLite                                      │
│  - Manual cloud sync (upload/download buttons)                     │
│  - Works completely offline                                        │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                    MODE 3: ELECTRON LAN MODE                        │
│                                                                     │
│  Client React App ←→ LAN Server SQLite ←→ Other Clients            │
│  - All reads from LAN server                                       │
│  - All writes to LAN server                                        │
│  - NO cloud sync capability                                        │
│  - Real-time WebSocket updates                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. Critical Issues Identified

### 2.1 🔴 CRITICAL: Schema Mismatches Between Databases

#### Issue 2.1.1: Local SQLite vs LAN Server SQLite

**Problem**: The same tables have DIFFERENT schemas in local SQLite vs LAN server SQLite.

| Table | Local SQLite (localDb.ts) | LAN Server (sqliteLanServer.ts) | Impact |
|-------|---------------------------|--------------------------------|--------|
| **orders** | Has: `customer_name`, `customer_phone`, `customer_gstin`, `payment_status`, `cgst_amount`, `sgst_amount`, `discount_amount`, `final_amount`, `created_by` | **MISSING**: All customer fields, payment fields, created_by | ⚠️ Data loss when switching modes |
| **order_items** | Has: `kitchen_id`, `total_price`, `special_instructions` | **MISSING**: `total_price`, `special_instructions` | ⚠️ Order details lost |
| **menu_items** | Has: NO `restaurant_id` (correct) | Has: NO `restaurant_id` (correct) | ✅ OK |
| **staff_members** | Has: `full_name`, `user_id`, `invited_at`, `joined_at` | Has: `name` (WRONG!), missing `user_id`, `invited_at`, `joined_at` | 🔴 Data corruption |
| **floors/tables** | Has: NO `updated_at` in Supabase but HAS in SQLite | Has: `updated_at` | ⚠️ Sync conflicts |

**Code Evidence**:
```typescript
// localDb.ts (Line 16-30) - Local SQLite
CREATE TABLE orders (
  customer_name TEXT,
  customer_phone TEXT,
  customer_gstin TEXT,
  payment_status TEXT,
  cgst_amount REAL,
  sgst_amount REAL,
  discount_amount REAL,
  final_amount REAL,
  created_by TEXT,
  ...
);

// sqliteLanServer.ts (Line 351-367) - LAN Server SQLite
CREATE TABLE orders (
  // MISSING: customer_name, customer_phone, customer_gstin
  // MISSING: payment_status, cgst_amount, sgst_amount
  // MISSING: discount_amount, final_amount, created_by
  ...
);
```

#### Issue 2.1.2: Local SQLite vs Supabase Cloud

**Problem**: Local SQLite has columns that don't exist in Supabase.

| Table | Local SQLite Extra Columns | Supabase Columns | Blocklist Status |
|-------|---------------------------|------------------|------------------|
| **orders** | `customer_gstin`, `customer_name`, `customer_phone`, `sync_status` | NO customer fields | ⚠️ Partially blocklisted |
| **floors** | `updated_at`, `sync_status` | NO `updated_at` | ✅ Blocklisted |
| **tables** | `updated_at`, `sync_status` | NO `updated_at` | ✅ Blocklisted |
| **All tables** | `sync_status` | NO `sync_status` | ✅ Blocklisted |

**Impact**: When syncing to Supabase, these columns must be stripped (see `SUPABASE_COLUMN_BLOCKLIST` in offlineDataService.ts line 375-387).

### 2.2 🔴 CRITICAL: Data Loss in LAN Mode

**Problem**: When writing data in LAN mode, the LAN server SQLite schema is MISSING critical fields, causing silent data loss.

**Example**: Creating an order in LAN mode:
```typescript
// offlineDataService.ts attempts to write:
{
  id: "uuid",
  restaurant_id: "uuid",
  table_id: "uuid",
  customer_name: "John",        // ❌ LOST - column doesn't exist in LAN SQLite
  customer_phone: "1234567890", // ❌ LOST
  customer_gstin: "GST123",     // ❌ LOST
  payment_status: "paid",       // ❌ LOST
  cgst_amount: 2.5,             // ❌ LOST
  sgst_amount: 2.5,             // ❌ LOST
  discount_amount: 10.0,        // ❌ LOST
  final_amount: 110.0,          // ❌ LOST
  created_by: "staff-uuid"      // ❌ LOST
}
```

**Result**: Order is created but all customer/billing information is silently discarded!

### 2.3 🟡 MEDIUM: Inconsistent Data Flow Logic

#### Issue 2.3.1: Dual Data Service Layers

The application has **TWO** separate data service layers that do similar things:

1. **`offlineDataService.ts`** - Uses `offlineQuery()`, `offlineMutate()`, `offlineDelete()`
2. **`dataLayer.ts`** - Uses `queryTable()`, `upsertRecord()`, `deleteRecord()`

**Problem**: Both services implement the same LAN/Local/Supabase routing logic, leading to:
- Code duplication
- Inconsistent behavior
- Confusion about which to use

**Evidence**:
```typescript
// offlineDataService.ts (Line 151)
export async function offlineQuery<T = any>(...)

// dataLayer.ts (Line 112)
export async function queryTable<T = any>(...)
```

#### Issue 2.3.2: Sync Engine Redundancy

**Problem**: There are TWO sync mechanisms:

1. **`syncEngine.ts`** (Electron main process) - Automatic pull on startup, deprecated push
2. **`manualSyncToCloud()`** (offlineDataService.ts) - Manual push/pull from renderer

**Current State**:
- `syncEngine.ts` line 57-59: `forcePush()` is DEPRECATED
- `syncEngine.ts` only pulls on startup (line 37-39)
- All push sync is manual via UI

**Issue**: The sync engine pulls data on startup, but this conflicts with the manual download approach.

### 2.4 🟡 MEDIUM: Missing Foreign Key Enforcement

**Problem**: SQLite has foreign key constraints defined but they're inconsistently applied.

```typescript
// localDb.ts - Has FK constraints
CREATE TABLE order_items (
  order_id TEXT NOT NULL,
  menu_item_id TEXT,
  kitchen_id TEXT,
  FOREIGN KEY (order_id) REFERENCES orders(id)  // ✅ Defined
);

// sqliteLanServer.ts - NO FK constraints!
CREATE TABLE order_items (
  order_id TEXT NOT NULL,
  menu_item_id TEXT NOT NULL,
  kitchen_id TEXT,
  // ❌ NO FOREIGN KEY definitions!
);
```

**Impact**: LAN server allows orphaned records (order_items pointing to non-existent orders).

### 2.5 🟡 MEDIUM: Inefficient Query Patterns

#### Issue 2.5.1: No Batch Operations in LAN Server

**Problem**: LAN server processes each record individually via HTTP, causing network overhead.

```typescript
// Current: One HTTP request per record
for (const record of records) {
  await lan.upsert(table, record);  // HTTP POST each time
}

// Should be: Batch upsert
await lan.upsertBatch(table, records);  // Single HTTP POST
```

#### Issue 2.5.2: Missing Indexes in LAN Server

**Problem**: LAN server SQLite has fewer indexes than local SQLite.

| Index | Local SQLite | LAN Server |
|-------|--------------|------------|
| `idx_orders_restaurant` | ✅ | ✅ |
| `idx_orders_table` | ✅ | ✅ |
| `idx_order_items_order` | ✅ | ✅ |
| `idx_menu_items_category` | ✅ | ✅ |
| `idx_orders_sync` | ✅ | ❌ Missing |
| `idx_order_items_sync` | ✅ | ❌ Missing |
| `idx_menu_categories_restaurant` | ✅ | ❌ Missing |
| `idx_kitchens_restaurant` | ✅ | ❌ Missing |
| `idx_tables_floor` | ✅ | ❌ Missing |
| `idx_floors_restaurant` | ✅ | ❌ Missing |
| `idx_staff_members_restaurant` | ✅ | ❌ Missing |

### 2.6 🟠 LOW-MEDIUM: Timestamp Inconsistencies

**Problem**: Different databases use different timestamp formats.

| Database | Timestamp Format | Example |
|----------|------------------|---------|
| **Supabase** | ISO 8601 with timezone | `2026-04-13T15:30:00.000Z` |
| **Local SQLite** | ISO 8601 | `2026-04-13T15:30:00.000Z` |
| **LAN Server SQLite** | SQLite datetime | `2026-04-13 15:30:00` (no T, no Z) |

**Code Evidence**:
```typescript
// localDb.ts - Uses ISO strings
data.updated_at = data.updated_at || new Date().toISOString();

// sqliteLanServer.ts - Uses SQLite datetime
DEFAULT CURRENT_TIMESTAMP  // Results in: "2026-04-13 15:30:00"
```

**Impact**: Timestamp comparisons fail when syncing between databases.

### 2.7 🟠 LOW-MEDIUM: No Data Validation on LAN Server

**Problem**: LAN server accepts any data without validation.

```typescript
// sqliteLanServer.ts (Line 88-110)
this.app.post('/upsert/:table', (req, res) => {
  const data = req.body;  // ❌ No validation
  const columns = Object.keys(data);
  const sql = `INSERT OR REPLACE INTO ${table} (${columns.join(',')}) VALUES (...)`;
  // ❌ Blindly inserts whatever client sends
});
```

**Risks**:
- SQL injection (mitigated by parameterized queries, but still risky)
- Schema violations
- Invalid data types
- Missing required fields

---

## 3. Redesigned Data Flow Architecture

### 3.1 Solution: Unified Schema Definition

**Proposal**: Create a SINGLE source of truth for database schema that all three databases use.

```typescript
// New file: src/schema/databaseSchema.ts

export const TABLE_SCHEMAS = {
  restaurants: {
    columns: {
      id: { type: 'TEXT', primaryKey: true },
      name: { type: 'TEXT', notNull: true },
      slug: { type: 'TEXT' },
      address: { type: 'TEXT' },
      phone: { type: 'TEXT' },
      gstin: { type: 'TEXT' },
      cgst_percentage: { type: 'REAL', default: 2.5 },
      sgst_percentage: { type: 'REAL', default: 2.5 },
      owner_id: { type: 'TEXT' },
      created_at: { type: 'TEXT' },
      updated_at: { type: 'TEXT' },
    },
    supabaseOnly: [],  // Columns that DON'T exist in Supabase
    localOnly: ['sync_status'],  // Columns only in local SQLite
  },
  
  orders: {
    columns: {
      id: { type: 'TEXT', primaryKey: true },
      restaurant_id: { type: 'TEXT', notNull: true },
      table_id: { type: 'TEXT' },
      status: { type: 'TEXT', default: 'pending' },
      total_amount: { type: 'REAL', default: 0 },
      cgst_amount: { type: 'REAL', default: 0 },
      sgst_amount: { type: 'REAL', default: 0 },
      discount_amount: { type: 'REAL', default: 0 },
      final_amount: { type: 'REAL', default: 0 },
      payment_status: { type: 'TEXT', default: 'pending' },
      payment_method: { type: 'TEXT' },
      notes: { type: 'TEXT' },
      customer_name: { type: 'TEXT' },
      customer_phone: { type: 'TEXT' },
      customer_gstin: { type: 'TEXT' },
      created_by: { type: 'TEXT' },
      created_at: { type: 'TEXT' },
      updated_at: { type: 'TEXT' },
    },
    supabaseOnly: ['customer_name', 'customer_phone', 'customer_gstin'],  // ⚠️ Need to add to Supabase!
    localOnly: ['sync_status'],
  },
  
  // ... all other tables
};
```

### 3.2 Solution: Schema Migration System

```typescript
// New file: electron/services/schemaMigration.ts

export class SchemaMigration {
  static async ensureSchemaSync(db: Database, targetSchema: TableSchema) {
    // 1. Check current schema
    const currentColumns = db.prepare("PRAGMA table_info('orders')").all();
    
    // 2. Compare with target
    const missingColumns = this.findMissingColumns(currentColumns, targetSchema);
    
    // 3. Add missing columns (or recreate table if needed)
    for (const col of missingColumns) {
      try {
        db.exec(`ALTER TABLE orders ADD COLUMN ${col.name} ${col.type}`);
      } catch {
        // If ALTER fails, recreate table
        this.recreateTable(db, 'orders', targetSchema);
      }
    }
  }
}
```

### 3.3 Solution: Unified Data Service

**Proposal**: Merge `offlineDataService.ts` and `dataLayer.ts` into a single service.

```typescript
// New file: src/services/unifiedDataService.ts

export class UnifiedDataService {
  private mode: DataMode;
  
  // Single query method with consistent behavior
  async query<T>(table: string, filters?: Filters): Promise<T[]> {
    switch (this.mode) {
      case 'lan':
        return this.queryLan(table, filters);
      case 'local':
        return this.queryLocal(table, filters);
      case 'supabase':
        return this.querySupabase(table, filters);
    }
  }
  
  // Single mutation method
  async mutate<T>(table: string, data: Record<string, any>): Promise<T> {
    // 1. Validate against schema
    SchemaValidator.validate(table, data);
    
    // 2. Write to appropriate database
    switch (this.mode) {
      case 'lan':
        return this.mutateLan(table, data);
      case 'local':
        return this.mutateLocal(table, data);
      case 'supabase':
        return this.mutateSupabase(table, data);
    }
  }
}
```

### 3.4 Solution: Add Missing Supabase Columns

**Proposal**: Add missing columns to Supabase schema to match local SQLite.

```sql
-- New migration: supabase/migrations/20260414000000_add_customer_fields.sql

ALTER TABLE orders ADD COLUMN customer_name TEXT;
ALTER TABLE orders ADD COLUMN customer_phone TEXT;
ALTER TABLE orders ADD COLUMN customer_gstin TEXT;
ALTER TABLE orders ADD COLUMN payment_status TEXT DEFAULT 'pending';
ALTER TABLE orders ADD COLUMN cgst_amount REAL DEFAULT 0;
ALTER TABLE orders ADD COLUMN sgst_amount REAL DEFAULT 0;
ALTER TABLE orders ADD COLUMN discount_amount REAL DEFAULT 0;
ALTER TABLE orders ADD COLUMN final_amount REAL DEFAULT 0;
ALTER TABLE orders ADD COLUMN created_by UUID REFERENCES staff_members(id);
```

### 3.5 Solution: Standardized Timestamp Format

**Proposal**: Always use ISO 8601 format across all databases.

```typescript
// Utility function
export function standardizedTimestamp(): string {
  return new Date().toISOString();  // Always: "2026-04-13T15:30:00.000Z"
}

// Use everywhere
data.created_at = standardizedTimestamp();
data.updated_at = standardizedTimestamp();
```

### 3.6 Solution: Data Validation Layer

```typescript
// New file: src/services/dataValidator.ts

export class DataValidator {
  static validateOrder(data: any): void {
    if (!data.restaurant_id) throw new Error('restaurant_id is required');
    if (!data.table_id) throw new Error('table_id is required');
    if (typeof data.total_amount !== 'number') throw new Error('total_amount must be a number');
    // ... more validations
  }
  
  static validateMenuItem(data: any): void {
    if (!data.category_id) throw new Error('category_id is required');
    if (!data.name) throw new Error('name is required');
    if (typeof data.price !== 'number' || data.price < 0) throw new Error('Invalid price');
  }
}
```

### 3.7 Solution: LAN Server Enhancements

```typescript
// Enhanced LAN server with batch operations and validation

// Add batch endpoint
this.app.post('/upsert-batch/:table', (req, res) => {
  const { table } = req.params;
  const records = req.body.records;
  
  // Use transaction for atomicity
  const transaction = this.db.transaction(() => {
    for (const data of records) {
      DataValidator.validate(table, data);
      this.upsertRecord(table, data);
    }
  });
  
  transaction();
  res.json({ success: true, count: records.length });
});

// Add foreign key enforcement
this.db.pragma('foreign_keys = ON');  // Already done, but enforce in queries
```

---

## 4. Implementation Priority

### Phase 1: Critical Fixes (Week 1)
1. ✅ **Sync LAN server schema with local SQLite** - Add missing columns to `sqliteLanServer.ts`
2. ✅ **Fix staff_members column name** - Change `name` → `full_name` in LAN server
3. ✅ **Add missing indexes** to LAN server SQLite
4. ✅ **Standardize timestamp format** across all databases

### Phase 2: Data Integrity (Week 2)
5. ✅ **Add data validation** to LAN server endpoints
6. ✅ **Enable foreign key enforcement** in LAN server
7. ✅ **Add batch operations** to LAN server API
8. ✅ **Create schema validation utility**

### Phase 3: Architecture Cleanup (Week 3)
9. ✅ **Merge duplicate data services** into unified service
10. ✅ **Add missing columns to Supabase** (customer fields)
11. ✅ **Implement schema migration system**
12. ✅ **Remove deprecated sync engine code**

### Phase 4: Testing & Documentation (Week 4)
13. ✅ **Add integration tests** for all three modes
14. ✅ **Test schema migration** on existing databases
15. ✅ **Update documentation** with new architecture
16. ✅ **Performance testing** with batch operations

---

## 5. Data Flow Diagram (Redesigned)

```
┌─────────────────────────────────────────────────────────────────────┐
│                     UNIFIED DATA SERVICE                            │
│                                                                     │
│  ┌──────────────┐                                                   │
│  │   Schema     │                                                   │
│  │  Validator   │ ← All writes validated against single schema      │
│  └──────┬───────┘                                                   │
│         │                                                           │
│  ┌──────▼───────┐                                                   │
│  │   Routing    │ ← Determines: LAN / Local / Supabase mode        │
│  │   Engine     │                                                   │
│  └──┬────┬──────┘                                                   │
│     │    │                                                          │
│     │    └──────────────────────────────┐                          │
│     │                                   │                          │
│  ┌──▼──────────┐              ┌─────────▼─────────┐               │
│  │  LAN Mode   │              │   Local Mode      │               │
│  │             │              │                   │               │
│  │ LAN Server  │              │  Local SQLite     │               │
│  │  SQLite DB  │              │   restroflow.db   │               │
│  │             │              │                   │               │
│  │ ┌─────────┐ │              │ ┌───────────────┐ │               │
│  │ │Batch API│ │              │ │Manual Sync    │ │               │
│  │ │FK Checks│ │              │ │Push to Cloud  │ │               │
│  │ │Validate │ │              │ │Pull from Cloud│ │               │
│  │ └─────────┘ │              │ └───────────────┘ │               │
│  └─────────────┘              └─────────┬─────────┘               │
│                                         │                          │
│                              ┌──────────▼──────────┐              │
│                              │  Supabase Cloud     │              │
│                              │   PostgreSQL        │              │
│                              │                     │              │
│                              │ ┌─────────────────┐ │              │
│                              │ │ Real-time Subs  │ │              │
│                              │ │ Row-level Sec   │ │              │
│                              │ └─────────────────┘ │              │
│                              └─────────────────────┘              │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 6. Summary of Required Changes

### 6.1 Immediate (Must Fix)

| File | Change | Priority |
|------|--------|----------|
| `sqliteLanServer.ts` | Add missing columns to orders table | 🔴 CRITICAL |
| `sqliteLanServer.ts` | Fix staff_members: `name` → `full_name` | 🔴 CRITICAL |
| `sqliteLanServer.ts` | Add all missing indexes | 🟡 HIGH |
| `sqliteLanServer.ts` | Standardize timestamp format | 🟡 HIGH |
| `sqliteLanServer.ts` | Enable foreign key constraints | 🟡 HIGH |

### 6.2 Short-term (Should Fix)

| File | Change | Priority |
|------|--------|----------|
| `sqliteLanServer.ts` | Add data validation | 🟠 MEDIUM |
| `sqliteLanServer.ts` | Add batch operations API | 🟠 MEDIUM |
| `offlineDataService.ts` + `dataLayer.ts` | Merge into unified service | 🟠 MEDIUM |
| Supabase migrations | Add customer fields to orders | 🟠 MEDIUM |

### 6.3 Long-term (Nice to Have)

| File | Change | Priority |
|------|--------|----------|
| New file | Schema migration system | 🟢 LOW |
| New file | Data validation utilities | 🟢 LOW |
| `syncEngine.ts` | Remove deprecated code | 🟢 LOW |
| All | Add comprehensive tests | 🟢 LOW |

---

## 7. Next Steps

1. **Review this document** with stakeholders
2. **Prioritize fixes** based on business impact
3. **Create detailed implementation tickets** for each phase
4. **Start with Phase 1** (critical schema fixes)
5. **Test thoroughly** after each phase
6. **Update wiki documentation** with new architecture

---

**Document Version**: 1.0  
**Date**: April 13, 2026  
**Author**: AI Architecture Analysis  
**Status**: Ready for Review
