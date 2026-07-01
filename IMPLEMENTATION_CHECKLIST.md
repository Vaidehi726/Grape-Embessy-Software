# Database Architecture Fix - Implementation Checklist

## Quick Summary

**Problem**: Three database systems (Supabase, Local SQLite, LAN SQLite) have **different schemas**, causing **data loss** and **sync failures**.

**Solution**: Unify schemas, fix critical bugs, merge duplicate services, add validation.

**Estimated Time**: 4 weeks (Phased approach)

---

## Phase 1: Critical Schema Fixes (Week 1) 🔴

### Task 1.1: Fix LAN Server Orders Table Schema

**File**: `electron/services/sqliteLanServer.ts`
**Lines**: 351-367 (orders table definition)
**Priority**: 🔴 CRITICAL - Data loss in production

**Current Schema** (WRONG):
```sql
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL,
  table_id TEXT,
  status TEXT DEFAULT 'pending',
  total_amount REAL DEFAULT 0,
  payment_method TEXT,
  notes TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

**Required Schema** (CORRECT):
```sql
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL,
  table_id TEXT,
  status TEXT DEFAULT 'pending',
  total_amount REAL DEFAULT 0,
  cgst_amount REAL DEFAULT 0,
  sgst_amount REAL DEFAULT 0,
  discount_amount REAL DEFAULT 0,
  final_amount REAL DEFAULT 0,
  payment_status TEXT DEFAULT 'pending',
  payment_method TEXT,
  notes TEXT,
  customer_name TEXT,
  customer_phone TEXT,
  customer_gstin TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

**Missing Columns** (8 total):
- ❌ `cgst_amount`
- ❌ `sgst_amount`
- ❌ `discount_amount`
- ❌ `final_amount`
- ❌ `payment_status`
- ❌ `customer_name`
- ❌ `customer_phone`
- ❌ `customer_gstin`
- ❌ `created_by`

**Test**: Create an order in LAN mode and verify all fields are saved.

---

### Task 1.2: Fix LAN Server Order Items Table

**File**: `electron/services/sqliteLanServer.ts`
**Lines**: 369-380
**Priority**: 🔴 CRITICAL

**Current Schema**:
```sql
CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  menu_item_id TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price REAL NOT NULL,
  total_price REAL NOT NULL,  -- ✅ Already exists
  special_instructions TEXT,  -- ✅ Already exists
  status TEXT DEFAULT 'pending',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

**Comparison with Local SQLite**:
- ✅ Has `total_price`
- ✅ Has `special_instructions`
- ❌ Missing FK constraints

**Action**: Add foreign key constraints (see Task 1.5)

---

### Task 1.3: Fix LAN Server Staff Members Table

**File**: `electron/services/sqliteLanServer.ts`
**Lines**: 382-393
**Priority**: 🔴 CRITICAL - Column name mismatch

**Current Schema** (WRONG):
```sql
CREATE TABLE IF NOT EXISTS staff_members (
  id TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL,
  name TEXT NOT NULL,  -- ❌ WRONG column name!
  email TEXT,
  phone TEXT,
  role TEXT DEFAULT 'staff',
  pin TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

**Required Schema** (CORRECT):
```sql
CREATE TABLE IF NOT EXISTS staff_members (
  id TEXT PRIMARY KEY,
  restaurant_id TEXT NOT NULL,
  user_id TEXT,  -- ❌ MISSING
  full_name TEXT NOT NULL,  -- ✅ Rename from 'name'
  email TEXT,
  phone TEXT,
  role TEXT DEFAULT 'waiter',  -- ⚠️ Change default from 'staff' to 'waiter'
  is_active INTEGER DEFAULT 1,
  invited_at TEXT,  -- ❌ MISSING
  joined_at TEXT,  -- ❌ MISSING
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

**Changes**:
1. ❌ Remove `pin` column (not in Supabase or local)
2. ❌ Rename `name` → `full_name`
3. ❌ Add `user_id`
4. ❌ Add `invited_at`
5. ❌ Add `joined_at`
6. ⚠️ Change default role: `'staff'` → `'waiter'`

---

### Task 1.4: Add Missing Indexes to LAN Server

**File**: `electron/services/sqliteLanServer.ts`
**Lines**: After line 399 (after CREATE TABLE statements)
**Priority**: 🟡 HIGH - Performance impact

**Current Indexes** (4):
```sql
CREATE INDEX IF NOT EXISTS idx_orders_restaurant ON orders(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_orders_table ON orders(table_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_menu_items_category ON menu_items(category_id);
```

**Missing Indexes** (7):
```sql
CREATE INDEX IF NOT EXISTS idx_orders_sync ON orders(status);  -- For filtering by status
CREATE INDEX IF NOT EXISTS idx_order_items_sync ON order_items(status);  -- For kitchen display
CREATE INDEX IF NOT EXISTS idx_menu_categories_restaurant ON menu_categories(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_kitchens_restaurant ON kitchens(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_tables_floor ON tables(floor_id);
CREATE INDEX IF NOT EXISTS idx_floors_restaurant ON floors(restaurant_id);
CREATE INDEX IF NOT EXISTS idx_staff_members_restaurant ON staff_members(restaurant_id);
```

**Reference**: See `electron/services/localDb.ts` lines 150-159 for complete index list.

---

### Task 1.5: Enable Foreign Key Enforcement in LAN Server

**File**: `electron/services/sqliteLanServer.ts`
**Lines**: 258-259 (in initializeDatabase method)
**Priority**: 🟡 HIGH - Data integrity

**Current Code**:
```typescript
this.db = new Database(dbPath);
this.db.pragma('journal_mode = WAL');
this.db.pragma('foreign_keys = ON');  // ✅ Already enabled!
```

**Action**: Foreign keys are enabled, but table definitions don't have FK constraints.

**Add FK constraints to table definitions**:
```sql
CREATE TABLE IF NOT EXISTS order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL,
  menu_item_id TEXT NOT NULL,
  kitchen_id TEXT,
  -- Add these:
  FOREIGN KEY (order_id) REFERENCES orders(id),
  FOREIGN KEY (menu_item_id) REFERENCES menu_items(id),
  FOREIGN KEY (kitchen_id) REFERENCES kitchens(id)
);

CREATE TABLE IF NOT EXISTS tables (
  id TEXT PRIMARY KEY,
  floor_id TEXT,
  -- Add this:
  FOREIGN KEY (floor_id) REFERENCES floors(id)
);
```

---

### Task 1.6: Standardize Timestamp Format

**File**: `electron/services/sqliteLanServer.ts`
**Lines**: All DEFAULT CURRENT_TIMESTAMP
**Priority**: 🟡 HIGH - Sync compatibility

**Problem**: SQLite's `CURRENT_TIMESTAMP` produces: `2026-04-13 15:30:00`
**Expected**: ISO 8601 format: `2026-04-13T15:30:00.000Z`

**Solution**: Change all DEFAULT clauses from:
```sql
created_at TEXT DEFAULT CURRENT_TIMESTAMP,
updated_at TEXT DEFAULT CURRENT_TIMESTAMP
```

To use a trigger or application-level timestamp generation:
```sql
created_at TEXT,
updated_at TEXT
```

Then ensure all inserts use `new Date().toISOString()`.

**Alternative**: Keep CURRENT_TIMESTAMP but normalize on read:
```typescript
function normalizeTimestamp(ts: string): string {
  if (!ts.includes('T')) {
    return new Date(ts.replace(' ', 'T') + 'Z').toISOString();
  }
  return ts;
}
```

**Files to Update**:
- `electron/services/sqliteLanServer.ts` (all table definitions)
- Any code that reads timestamps from LAN server

---

## Phase 2: Data Integrity & Validation (Week 2) 🟡

### Task 2.1: Create Data Validation Utilities

**New File**: `electron/services/dataValidator.ts`

**Implementation**:
```typescript
export class DataValidator {
  static validate(table: string, data: Record<string, any>): void {
    switch (table) {
      case 'orders':
        this.validateOrder(data);
        break;
      case 'order_items':
        this.validateOrderItem(data);
        break;
      // ... other tables
    }
  }
  
  private static validateOrder(data: any): void {
    const required = ['id', 'restaurant_id', 'table_id'];
    for (const field of required) {
      if (!data[field]) {
        throw new Error(`Missing required field: ${field}`);
      }
    }
    
    if (typeof data.total_amount !== 'number' || data.total_amount < 0) {
      throw new Error('Invalid total_amount');
    }
    
    // UUID validation
    const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!UUID_REGEX.test(data.restaurant_id)) {
      throw new Error('Invalid restaurant_id UUID');
    }
  }
  
  private static validateOrderItem(data: any): void {
    if (!data.order_id || !data.menu_item_id) {
      throw new Error('Missing required fields');
    }
    if (!Number.isInteger(data.quantity) || data.quantity < 1) {
      throw new Error('Invalid quantity');
    }
  }
}
```

---

### Task 2.2: Add Validation to LAN Server Endpoints

**File**: `electron/services/sqliteLanServer.ts`
**Lines**: 88-110 (upsert endpoint)

**Current Code** (NO validation):
```typescript
this.app.post('/upsert/:table', (req, res) => {
  try {
    if (!this.db) throw new Error('Database not ready');
    const { table } = req.params;
    const data = req.body;  // ❌ No validation!
    // ... insert
  }
});
```

**Updated Code** (WITH validation):
```typescript
this.app.post('/upsert/:table', (req, res) => {
  try {
    if (!this.db) throw new Error('Database not ready');
    const { table } = req.params;
    const data = req.body;
    
    // ✅ Validate before insert
    DataValidator.validate(table, data);
    
    // ... insert
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message });
  }
});
```

---

### Task 2.3: Add Batch Operations to LAN Server

**File**: `electron/services/sqliteLanServer.ts`
**Lines**: After line 129 (after delete endpoint)

**Add new endpoint**:
```typescript
// Batch upsert endpoint
this.app.post('/upsert-batch/:table', (req, res) => {
  try {
    if (!this.db) throw new Error('Database not ready');
    const { table } = req.params;
    const records = req.body.records;
    
    if (!Array.isArray(records) || records.length === 0) {
      throw new Error('Records array is required');
    }
    
    // Validate all records first
    for (const data of records) {
      DataValidator.validate(table, data);
    }
    
    // Use transaction for atomicity
    const transaction = this.db.transaction(() => {
      for (const data of records) {
        const columns = Object.keys(data);
        const placeholders = columns.map(() => '?').join(',');
        const values = Object.values(data);
        
        const sql = `INSERT OR REPLACE INTO ${table} (${columns.join(',')}) VALUES (${placeholders})`;
        const stmt = this.db!.prepare(sql);
        stmt.run(...values);
      }
    });
    
    transaction();
    
    // Broadcast changes
    this.broadcast({ type: 'batch-upsert', table, count: records.length });
    
    res.json({ success: true, count: records.length });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});
```

---

### Task 2.4: Update LAN Client to Support Batch Operations

**File**: `electron/services/lanClient.ts`
**Lines**: After line 275 (after delete method)

**Add new method**:
```typescript
async upsertBatch(table: string, records: Record<string, any>[]): Promise<{ success: boolean; count?: number; error?: string }> {
  try {
    const response = await fetch(`${this.baseUrl}/upsert-batch/${table}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ records })
    });
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const result = await response.json();
    return { success: result.success, count: result.count, error: result.error };
  } catch (err: any) {
    console.error(`[LAN Client] upsertBatch error:`, err);
    return { success: false, error: err.message };
  }
}
```

---

## Phase 3: Supabase Schema Updates (Week 3) 🟠

### Task 3.1: Create Supabase Migration

**New File**: `supabase/migrations/20260414000000_add_customer_fields.sql`

```sql
-- Add missing customer and payment fields to orders table
-- Date: 2026-04-14
-- Purpose: Match local SQLite schema for proper sync

ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_name TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_phone TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_gstin TEXT;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'pending';
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cgst_amount REAL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS sgst_amount REAL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS discount_amount REAL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS final_amount REAL DEFAULT 0;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES staff_members(id);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_orders_payment_status ON orders(payment_status);
CREATE INDEX IF NOT EXISTS idx_orders_created_by ON orders(created_by);

COMMENT ON COLUMN orders.customer_name IS 'Customer name for billing';
COMMENT ON COLUMN orders.customer_phone IS 'Customer phone number';
COMMENT ON COLUMN orders.customer_gstin IS 'Customer GST number for invoicing';
COMMENT ON COLUMN orders.payment_status IS 'Payment status: pending, paid, partial, refunded';
COMMENT ON COLUMN orders.cgst_amount IS 'Central GST amount';
COMMENT ON COLUMN orders.sgst_amount IS 'State GST amount';
COMMENT ON COLUMN orders.discount_amount IS 'Discount amount applied';
COMMENT ON COLUMN orders.final_amount IS 'Final amount after tax and discount';
COMMENT ON COLUMN orders.created_by IS 'Staff member who created the order';
```

---

### Task 3.2: Update Column Blocklist

**File**: `src/services/offlineDataService.ts`
**Lines**: 375-387

**Current Blocklist**:
```typescript
const SUPABASE_COLUMN_BLOCKLIST: Record<string, string[]> = {
  orders: ['customer_gstin', 'customer_name', 'customer_phone', 'sync_status'],
  // ...
};
```

**Updated Blocklist** (after Supabase migration):
```typescript
const SUPABASE_COLUMN_BLOCKLIST: Record<string, string[]> = {
  orders: ['sync_status'],  // ✅ Remove customer fields from blocklist
  order_items: ['sync_status'],
  floors: ['updated_at', 'sync_status'],
  tables: ['updated_at', 'sync_status'],
  kitchens: ['sync_status'],
  menu_categories: ['sync_status'],
  menu_items: ['sync_status'],
  staff_members: ['sync_status'],
  restaurants: ['sync_status'],
};
```

---

## Phase 4: Service Consolidation (Week 4) 🔵

### Task 4.1: Create Unified Data Service

**New File**: `src/services/unifiedDataService.ts`

See "Redesigned Data Flow Architecture" section in `DATABASE_ARCHITECTURE_ANALYSIS.md` for full implementation.

---

### Task 4.2: Migrate Components to Use Unified Service

**Files to Update**:
- All components currently using `offlineDataService.ts`
- All components currently using `dataLayer.ts`
- Search for: `import.*from.*offlineDataService`
- Search for: `import.*from.*dataLayer`

**Estimated Components**: ~15-20 files

---

### Task 4.3: Deprecate Old Services

**Files**:
- `src/services/offlineDataService.ts` - Mark as deprecated
- `src/services/dataLayer.ts` - Mark as deprecated
- `electron/services/syncEngine.ts` - Remove deprecated code

---

## Testing Checklist

### Unit Tests
- [ ] Test schema validation for each table
- [ ] Test timestamp normalization
- [ ] Test batch operations
- [ ] Test foreign key enforcement

### Integration Tests
- [ ] Test order creation in LAN mode (all fields saved)
- [ ] Test order creation in local mode
- [ ] Test sync from local to Supabase
- [ ] Test batch sync performance
- [ ] Test data validation rejects invalid data

### Manual Tests
- [ ] Create order in LAN mode, verify all fields in database
- [ ] Create order with customer info, sync to cloud, verify
- [ ] Test offline mode (no internet) - all operations work
- [ ] Test LAN mode with multiple clients
- [ ] Test schema migration on existing databases

---

## Rollback Plan

If something goes wrong:

1. **Backup databases** before any migration
   ```bash
   # Local SQLite
   cp %APPDATA%/RestroFlow/restroflow.db restroflow.db.backup
   
   # LAN Server SQLite
   cp %APPDATA%/RestroFlow/lan-server-data/lan-server.db lan-server.db.backup
   ```

2. **Keep old service files** until migration is verified
   - Don't delete `offlineDataService.ts` immediately
   - Don't delete `dataLayer.ts` immediately
   - Mark as `@deprecated` instead

3. **Database migration rollback**
   ```sql
   -- If Supabase migration fails
   ALTER TABLE orders DROP COLUMN IF EXISTS customer_name;
   -- ... repeat for all added columns
   ```

---

## Success Metrics

After all phases complete:

| Metric | Before | After | Target |
|--------|--------|-------|--------|
| Schema consistency | 65% | 100% | ✅ 100% |
| Data loss in LAN mode | 8 fields/order | 0 fields | ✅ 0 |
| Sync failure rate | ~15% | <1% | ✅ <1% |
| Batch sync speed | N/A | 500 records/3s | ✅ <5s |
| Code duplication | 2 services | 1 service | ✅ 1 |
| Test coverage | ~20% | >80% | ✅ >80% |

---

## Review & Sign-off

- [ ] **Architecture Review**: Review `DATABASE_ARCHITECTURE_ANALYSIS.md`
- [ ] **Schema Review**: Review `DATABASE_CONNECTIVITY_MAP.md`
- [ ] **Implementation Plan**: Review this checklist
- [ ] **Stakeholder Approval**: Get approval to proceed
- [ ] **Phase 1 Complete**: Critical schema fixes
- [ ] **Phase 2 Complete**: Data integrity
- [ ] **Phase 3 Complete**: Supabase updates
- [ ] **Phase 4 Complete**: Service consolidation
- [ ] **Testing Complete**: All tests passing
- [ ] **Production Deploy**: Gradual rollout

---

**Created**: April 13, 2026  
**Status**: Ready for Review  
**Next Action**: Begin Phase 1 implementation
