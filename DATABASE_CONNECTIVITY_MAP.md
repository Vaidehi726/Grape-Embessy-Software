# Database Connectivity Map

## Current State (BEFORE Fixes)

```mermaid
graph TB
    subgraph "Supabase Cloud (PostgreSQL)"
        SB[(Supabase DB)]
        SB_COLS[Has ALL columns including customer fields]
    end
    
    subgraph "Local SQLite (restroflow.db)"
        LOCAL[(Local DB)]
        LOCAL_COLS[Complete schema with sync_status]
        LOCAL_IDX[All indexes present]
    end
    
    subgraph "LAN Server SQLite (lan-server.db)"
        LAN[(LAN Server DB)]
        LAN_COLS[❌ Missing columns in orders, staff_members]
        LAN_IDX[❌ Missing 6 indexes]
        LAN_FK[❌ No foreign key enforcement]
    end
    
    subgraph "Data Services"
        OFFLINE[offlineDataService.ts]
        DATALAYER[dataLayer.ts]
        SYNC[syncEngine.ts]
    end
    
    SB <-->|Manual Sync| LOCAL
    LOCAL -->|Duplicate Logic| OFFLINE
    LOCAL -->|Duplicate Logic| DATALAYER
    LOCAL -->|Deprecated Pull Only| SYNC
    
    LAN -.->|❌ Schema Mismatch| SB
    LAN -->|HTTP API| OFFLINE
    LAN -->|HTTP API| DATALAYER
    
    style LAN fill:#ffcccc
    style LAN_COLS fill:#ffcccc
    style LAN_IDX fill:#ffcccc
    style LAN_FK fill:#ffcccc
```

## Issues Identified

### 🔴 Critical Schema Mismatches

```
ORDERS TABLE COMPARISON:
┌──────────────────────────────┬──────────────────┬──────────────────┬──────────────────┐
│ Column                       │ Supabase         │ Local SQLite     │ LAN Server       │
├──────────────────────────────┼──────────────────┼──────────────────┼──────────────────┤
│ id                           │ ✅ UUID          │ ✅ TEXT          │ ✅ TEXT          │
│ restaurant_id                │ ✅               │ ✅               │ ✅               │
│ table_id                     │ ✅               │ ✅               │ ✅               │
│ status                       │ ✅               │ ✅               │ ✅               │
│ total_amount                 │ ✅               │ ✅               │ ✅               │
│ payment_method               │ ✅               │ ✅               │ ✅               │
│ notes                        │ ✅               │ ✅               │ ✅               │
│ customer_name                │ ❌ MISSING       │ ✅ TEXT          │ ❌ MISSING ⚠️   │
│ customer_phone               │ ❌ MISSING       │ ✅ TEXT          │ ❌ MISSING ⚠️   │
│ customer_gstin               │ ❌ MISSING       │ ✅ TEXT          │ ❌ MISSING ⚠️   │
│ payment_status               │ ❌ MISSING       │ ✅ TEXT          │ ❌ MISSING ⚠️   │
│ cgst_amount                  │ ❌ MISSING       │ ✅ REAL          │ ❌ MISSING ⚠️   │
│ sgst_amount                  │ ❌ MISSING       │ ✅ REAL          │ ❌ MISSING ⚠️   │
│ discount_amount              │ ❌ MISSING       │ ✅ REAL          │ ❌ MISSING ⚠️   │
│ final_amount                 │ ❌ MISSING       │ ✅ REAL          │ ❌ MISSING ⚠️   │
│ created_by                   │ ❌ MISSING       │ ✅ TEXT          │ ❌ MISSING ⚠️   │
│ created_at                   │ ✅ TIMESTAMPTZ   │ ✅ TEXT          │ ✅ TEXT          │
│ updated_at                   │ ✅ TIMESTAMPTZ   │ ✅ TEXT          │ ✅ TEXT          │
│ sync_status                  │ ❌ N/A           │ ✅ TEXT          │ ❌ N/A           │
└──────────────────────────────┴──────────────────┴──────────────────┴──────────────────┘

⚠️ = Data loss when using LAN mode!
```

```
STAFF_MEMBERS TABLE COMPARISON:
┌──────────────────────────────┬──────────────────┬──────────────────┬──────────────────┐
│ Column                       │ Supabase         │ Local SQLite     │ LAN Server       │
├──────────────────────────────┼──────────────────┼──────────────────┼──────────────────┤
│ id                           │ ✅ UUID          │ ✅ TEXT          │ ✅ TEXT          │
│ restaurant_id                │ ✅               │ ✅               │ ✅               │
│ user_id                      │ ✅ UUID          │ ✅ TEXT          │ ❌ MISSING ⚠️   │
│ full_name                    │ ✅ TEXT          │ ✅ TEXT          │ ❌ name ⚠️      │
│ email                        │ ✅ TEXT          │ ✅ TEXT          │ ✅ TEXT          │
│ phone                        │ ✅ TEXT          │ ✅ TEXT          │ ✅ TEXT          │
│ role                         │ ✅ TEXT          │ ✅ TEXT          │ ✅ TEXT          │
│ is_active                    │ ✅ BOOLEAN       │ ✅ INTEGER       │ ✅ INTEGER       │
│ invited_at                   │ ✅ TIMESTAMPTZ   │ ✅ TEXT          │ ❌ MISSING ⚠️   │
│ joined_at                    │ ✅ TIMESTAMPTZ   │ ✅ TEXT          │ ❌ MISSING ⚠️   │
│ created_at                   │ ✅ TIMESTAMPTZ   │ ✅ TEXT          │ ✅ TEXT          │
│ updated_at                   │ ✅ TIMESTAMPTZ   │ ✅ TEXT          │ ✅ TEXT          │
│ sync_status                  │ ❌ N/A           │ ✅ TEXT          │ ❌ N/A           │
└──────────────────────────────┴──────────────────┴──────────────────┴──────────────────┘

⚠️ = Column name mismatch causes sync failures!
```

### 🟡 Missing Indexes in LAN Server

```
INDEX COMPARISON:
┌──────────────────────────────────────┬──────────────────┬──────────────────┐
│ Index Name                           │ Local SQLite     │ LAN Server       │
├──────────────────────────────────────┼──────────────────┼──────────────────┤
│ idx_orders_restaurant                │ ✅ Present       │ ✅ Present       │
│ idx_orders_table                     │ ✅ Present       │ ✅ Present       │
│ idx_order_items_order                │ ✅ Present       │ ✅ Present       │
│ idx_menu_items_category              │ ✅ Present       │ ✅ Present       │
│ idx_orders_sync                      │ ✅ Present       │ ❌ MISSING       │
│ idx_order_items_sync                 │ ✅ Present       │ ❌ MISSING       │
│ idx_menu_categories_restaurant       │ ✅ Present       │ ❌ MISSING       │
│ idx_kitchens_restaurant              │ ✅ Present       │ ❌ MISSING       │
│ idx_tables_floor                     │ ✅ Present       │ ❌ MISSING       │
│ idx_floors_restaurant                │ ✅ Present       │ ❌ MISSING       │
│ idx_staff_members_restaurant         │ ✅ Present       │ ❌ MISSING       │
└──────────────────────────────────────┴──────────────────┴──────────────────┘

Impact: 7 missing indexes = slower queries in LAN mode
```

## Redesigned Architecture (AFTER Fixes)

```mermaid
graph TB
    subgraph "Supabase Cloud (PostgreSQL)"
        SB[(Supabase DB)]
        SB_NEW[✅ Added customer fields to orders]
        SB_SYNC[✅ Standard timestamp format]
    end
    
    subgraph "Schema Validator"
        SCHEMA[Unified Schema Definition]
        VALIDATE[Data Validation Layer]
    end
    
    subgraph "Unified Data Service"
        UNIFIED[Single Service replaces 2]
        ROUTE[Smart Routing Engine]
    end
    
    subgraph "Local SQLite (restroflow.db)"
        LOCAL[(Local DB)]
        LOCAL_COMPLETE[✅ Complete schema]
        LOCAL_IDX[✅ All indexes]
        MANUAL[Manual Sync to Cloud]
    end
    
    subgraph "LAN Server SQLite (lan-server.db)"
        LAN[(LAN Server DB)]
        LAN_FIXED[✅ Schema matches local]
        LAN_IDX_FIXED[✅ All indexes added]
        LAN_FK_FIXED[✅ FK enforcement]
        LAN_BATCH[✅ Batch operations]
        LAN_VALIDATE[✅ Data validation]
    end
    
    SCHEMA --> VALIDATE
    VALIDATE --> UNIFIED
    UNIFIED --> ROUTE
    
    ROUTE -->|Mode: Local| LOCAL
    ROUTE -->|Mode: LAN| LAN
    
    LOCAL <-->|Manual Upload/Download| SB
    
    style LAN_FIXED fill:#ccffcc
    style LAN_IDX_FIXED fill:#ccffcc
    style LAN_FK_FIXED fill:#ccffcc
    style LAN_BATCH fill:#ccffcc
    style LAN_VALIDATE fill:#ccffcc
    style SB_NEW fill:#ccffcc
```

## Data Flow Scenarios

### Scenario 1: Creating an Order in LAN Mode (BEFORE Fix)

```mermaid
sequenceDiagram
    participant UI as React UI
    participant DS as offlineDataService
    participant LAN as LAN Server
    participant DB as LAN SQLite
    
    UI->>DS: createOrder({customer_name, phone, gstin, ...})
    DS->>LAN: POST /upsert/orders
    LAN->>DB: INSERT OR REPLACE INTO orders
    
    Note over DB: ❌ Columns don't exist!<br/>customer_name, phone, gstin<br/>payment_status, amounts, etc.
    
    DB-->>LAN: Success (partial data)
    LAN-->>DS: {success: true}
    DS-->>UI: Order created
    
    Note over UI: ⚠️ User thinks all data saved<br/>Note over DB: ⚠️ Actually lost 8 fields!
```

### Scenario 2: Creating an Order in LAN Mode (AFTER Fix)

```mermaid
sequenceDiagram
    participant UI as React UI
    participant DS as UnifiedDataService
    participant V as SchemaValidator
    participant LAN as LAN Server
    participant DB as LAN SQLite
    
    UI->>DS: createOrder({customer_name, phone, gstin, ...})
    DS->>V: validate('orders', data)
    V-->>DS: ✅ Validation passed
    DS->>LAN: POST /upsert/orders (validated)
    LAN->>V: validate again
    V-->>LAN: ✅ Valid
    LAN->>DB: INSERT OR REPLACE INTO orders (all columns exist)
    
    Note over DB: ✅ All 18 columns present<br/>Including customer fields, payment, etc.
    
    DB-->>LAN: Success
    LAN-->>DS: {success: true, id: '...'}
    DS-->>UI: Order created with all data
    
    Note over UI: ✅ All data safely stored
```

### Scenario 3: Syncing to Cloud (AFTER Fix)

```mermaid
sequenceDiagram
    participant UI as React UI
    participant DS as UnifiedDataService
    participant LOCAL as Local SQLite
    participant SB as Supabase Cloud
    
    UI->>DS: syncToCloud()
    DS->>LOCAL: getPendingSync()
    LOCAL-->>DS: [pending records]
    
    loop Each pending record
        DS->>DS: Strip sync_status column
        DS->>DS: Validate timestamps
        DS->>DS: Validate FK references
        DS->>SB: upsert to Supabase
        SB-->>DS: Success
        DS->>LOCAL: markSynced(id)
    end
    
    DS-->>UI: ✅ Synced X records
```

## Database Relationship Map

```mermaid
erDiagram
    RESTAURANTS ||--o{ FLOORS : "has"
    RESTAURANTS ||--o{ KITCHENS : "has"
    RESTAURANTS ||--o{ MENU_CATEGORIES : "has"
    RESTAURANTS ||--o{ STAFF_MEMBERS : "employs"
    RESTAURANTS ||--o{ ORDERS : "receives"
    
    FLOORS ||--o{ TABLES : "contains"
    
    MENU_CATEGORIES ||--o{ MENU_ITEMS : "contains"
    KITCHENS ||--o{ MENU_ITEMS : "prepares"
    
    TABLES ||--o{ ORDERS : "used for"
    STAFF_MEMBERS ||--o{ ORDERS : "creates"
    
    ORDERS ||--o{ ORDER_ITEMS : "contains"
    MENU_ITEMS ||--o{ ORDER_ITEMS : "appears in"
    KITCHENS ||--o{ ORDER_ITEMS : "assigned to"
    
    RESTAURANTS {
        TEXT id PK
        TEXT name
        TEXT slug
        TEXT address
        TEXT phone
        TEXT gstin
        REAL cgst_percentage
        REAL sgst_percentage
        TEXT owner_id
        TEXT created_at
        TEXT updated_at
    }
    
    FLOORS {
        TEXT id PK
        TEXT restaurant_id FK
        TEXT name
        INTEGER floor_number
        TEXT created_at
        TEXT updated_at
    }
    
    TABLES {
        TEXT id PK
        TEXT floor_id FK
        TEXT table_number
        INTEGER capacity
        INTEGER is_occupied
        TEXT current_order_id
        TEXT occupied_since
        TEXT created_at
        TEXT updated_at
    }
    
    KITCHENS {
        TEXT id PK
        TEXT restaurant_id FK
        TEXT name
        TEXT description
        INTEGER is_active
        TEXT created_at
        TEXT updated_at
    }
    
    MENU_CATEGORIES {
        TEXT id PK
        TEXT restaurant_id FK
        TEXT name
        TEXT description
        INTEGER sort_order
        INTEGER is_active
        TEXT created_at
        TEXT updated_at
    }
    
    MENU_ITEMS {
        TEXT id PK
        TEXT category_id FK
        TEXT kitchen_id FK
        TEXT name
        TEXT description
        REAL price
        TEXT food_type
        TEXT spice_level
        INTEGER is_available
        INTEGER preparation_time
        TEXT image_url
        TEXT created_at
        TEXT updated_at
    }
    
    STAFF_MEMBERS {
        TEXT id PK
        TEXT restaurant_id FK
        TEXT user_id
        TEXT full_name
        TEXT email
        TEXT phone
        TEXT role
        INTEGER is_active
        TEXT invited_at
        TEXT joined_at
        TEXT created_at
        TEXT updated_at
    }
    
    ORDERS {
        TEXT id PK
        TEXT restaurant_id FK
        TEXT table_id FK
        TEXT status
        REAL total_amount
        REAL cgst_amount
        REAL sgst_amount
        REAL discount_amount
        REAL final_amount
        TEXT payment_status
        TEXT payment_method
        TEXT notes
        TEXT customer_name
        TEXT customer_phone
        TEXT customer_gstin
        TEXT created_by FK
        TEXT created_at
        TEXT updated_at
    }
    
    ORDER_ITEMS {
        TEXT id PK
        TEXT order_id FK
        TEXT menu_item_id FK
        TEXT kitchen_id FK
        INTEGER quantity
        REAL unit_price
        REAL total_price
        TEXT special_instructions
        TEXT status
        TEXT created_at
        TEXT updated_at
    }
```

## Migration Path

### Step-by-Step Fix Plan

```
┌─────────────────────────────────────────────────────────────────┐
│ STEP 1: Fix LAN Server Schema (CRITICAL)                       │
├─────────────────────────────────────────────────────────────────┤
│ 1. Add missing columns to orders table                        │
│    - customer_name, customer_phone, customer_gstin             │
│    - payment_status, cgst_amount, sgst_amount                  │
│    - discount_amount, final_amount, created_by                 │
│                                                                 │
│ 2. Fix staff_members table                                     │
│    - Rename: name → full_name                                  │
│    - Add: user_id, invited_at, joined_at                       │
│                                                                 │
│ 3. Add missing columns to order_items                          │
│    - total_price, special_instructions                         │
│                                                                 │
│ Result: LAN server can store all data correctly               │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 2: Add Indexes & FK Enforcement                           │
├─────────────────────────────────────────────────────────────────┤
│ 1. Add 7 missing indexes to LAN server                        │
│ 2. Enable foreign_keys = ON pragma                            │
│ 3. Standardize timestamp format (ISO 8601)                    │
│                                                                 │
│ Result: LAN server queries are fast & data integrity ensured  │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 3: Add Data Validation                                    │
├─────────────────────────────────────────────────────────────────┤
│ 1. Create validation utilities for each table                 │
│ 2. Add validation to LAN server endpoints                     │
│ 3. Validate before upsert operations                          │
│                                                                 │
│ Result: Prevents invalid data from entering system            │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 4: Update Supabase Schema                                 │
├─────────────────────────────────────────────────────────────────┤
│ 1. Create migration to add customer fields to orders          │
│ 2. Add: customer_name, customer_phone, customer_gstin         │
│ 3. Add: payment_status, amounts, created_by                   │
│                                                                 │
│ Result: All 3 databases have matching schemas               │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 5: Merge Data Services                                    │
├─────────────────────────────────────────────────────────────────┤
│ 1. Create UnifiedDataService                                  │
│ 2. Deprecate offlineDataService.ts                            │
│ 3. Deprecate dataLayer.ts                                     │
│ 4. Update all components to use new service                  │
│                                                                 │
│ Result: Single source of truth for data operations            │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ STEP 6: Add Batch Operations                                   │
├─────────────────────────────────────────────────────────────────┤
│ 1. Add batch endpoints to LAN server                          │
│ 2. Update sync functions to use batch APIs                    │
│ 3. Add transaction support                                    │
│                                                                 │
│ Result: Faster sync and bulk operations                       │
└─────────────────────────────────────────────────────────────────┘
```

## Performance Impact

### Before Fixes

| Operation | Local SQLite | LAN Server | Difference |
|-----------|--------------|------------|------------|
| Query orders (1000 records) | ~5ms | ~50ms | 10x slower |
| Insert single order | ~2ms | ~15ms (HTTP) | 7.5x slower |
| Insert 100 orders | ~200ms (batch) | ~1500ms (100 HTTP calls) | 7.5x slower |
| Sync 500 records | N/A | N/A | N/A |

### After Fixes

| Operation | Local SQLite | LAN Server | Expected |
|-----------|--------------|------------|----------|
| Query orders (1000 records) | ~5ms | ~8ms | Similar (indexes added) |
| Insert single order | ~2ms | ~15ms (HTTP) | Same (HTTP overhead) |
| Insert 100 orders | ~200ms (batch) | ~300ms (batch HTTP) | 5x faster! |
| Sync 500 records | ~2s | ~3s | 3x faster with validation |

---

**This document should be reviewed alongside**: `DATABASE_ARCHITECTURE_ANALYSIS.md`
