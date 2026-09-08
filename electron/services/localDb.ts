// Offline-first SQLite database for Electron
// Mirrors key Supabase tables with sync tracking

import Database from 'better-sqlite3';
import path from 'path';

export interface SyncRecord {
  table_name: string;
  record_id: string;
  data: string; // JSON
  sync_status: 'synced' | 'pending_sync' | 'conflict';
  updated_at: string;
}

const TABLES_SCHEMA = `
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    restaurant_id TEXT NOT NULL,
    table_id TEXT,
    status TEXT DEFAULT 'pending',
    total_amount REAL DEFAULT 0,
    discount_amount REAL DEFAULT 0,
    cgst_amount REAL DEFAULT 0,
    sgst_amount REAL DEFAULT 0,
    final_amount REAL DEFAULT 0,
    payment_status TEXT DEFAULT 'pending',
    payment_method TEXT,
    notes TEXT,
    customer_name TEXT,
    customer_phone TEXT,
    customer_gstin TEXT,
    bill_number INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    sync_status TEXT DEFAULT 'pending_sync'
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL,
    menu_item_id TEXT,
    kitchen_id TEXT,
    quantity INTEGER NOT NULL DEFAULT 1,
    unit_price REAL NOT NULL,
    notes TEXT,
    status TEXT DEFAULT 'pending',
    is_parcel INTEGER DEFAULT 0,
    -- Snapshot of the menu item's GST-exempt flag AT THE TIME THE ITEM WAS ORDERED
    -- (like unit_price). Nullable on purpose: NULL means "not recorded" (rows
    -- created before this column existed) and callers fall back to the menu
    -- item's current flag. Storing it here is what makes reprints from Reports /
    -- Orders tax correctly — those screens read order_items without joining the
    -- exempt flag, so without this snapshot GST was charged on exempt items.
    is_gst_exempt INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    sync_status TEXT DEFAULT 'pending_sync',
    FOREIGN KEY (order_id) REFERENCES orders(id)
  );

  CREATE TABLE IF NOT EXISTS menu_categories (
    id TEXT PRIMARY KEY,
    restaurant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    sort_order INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    sync_status TEXT DEFAULT 'synced'
  );

  CREATE TABLE IF NOT EXISTS menu_items (
    id TEXT PRIMARY KEY,
    category_id TEXT NOT NULL,
    kitchen_id TEXT,
    name TEXT NOT NULL,
    description TEXT,
    price REAL NOT NULL,
    food_type TEXT DEFAULT 'veg',
    spice_level TEXT,
    is_available INTEGER DEFAULT 1,
    preparation_time INTEGER,
    image_url TEXT,
    shortcut_code TEXT,
    sort_order INTEGER DEFAULT 0,
    is_gst_exempt INTEGER DEFAULT 0,
    -- 1 = "open item": a one-off custom line (day's special / off-menu request)
    -- typed in while taking an order. It is stored as a normal menu item so the
    -- cart, KOT, bill and reports resolve its name and price like any other,
    -- but it is hidden from the menu grid and the Menu manager so it is never
    -- re-ordered or maintained as part of the real menu.
    is_open_item INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    sync_status TEXT DEFAULT 'synced'
  );

  CREATE TABLE IF NOT EXISTS kitchens (
    id TEXT PRIMARY KEY,
    restaurant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    sync_status TEXT DEFAULT 'synced'
  );

  CREATE TABLE IF NOT EXISTS floors (
    id TEXT PRIMARY KEY,
    restaurant_id TEXT NOT NULL,
    name TEXT NOT NULL,
    floor_number INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    sync_status TEXT DEFAULT 'synced'
  );

  CREATE TABLE IF NOT EXISTS tables (
    id TEXT PRIMARY KEY,
    floor_id TEXT,
    table_number TEXT,
    capacity INTEGER DEFAULT 4,
    is_occupied INTEGER DEFAULT 0,
    current_order_id TEXT,
    occupied_since TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    sync_status TEXT DEFAULT 'synced',
    FOREIGN KEY (floor_id) REFERENCES floors(id)
  );

  CREATE TABLE IF NOT EXISTS restaurants (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT,
    address TEXT,
    phone TEXT,
    gstin TEXT,
    cgst_percentage REAL,
    sgst_percentage REAL,
    print_qr_on_bill INTEGER DEFAULT 1,
    payment_qr_content TEXT,
    lock_saved_items INTEGER DEFAULT 0,
    table_alert_minutes INTEGER DEFAULT 0,
    owner_id TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    sync_status TEXT DEFAULT 'synced'
  );

  CREATE TABLE IF NOT EXISTS staff_members (
    id TEXT PRIMARY KEY,
    restaurant_id TEXT NOT NULL,
    user_id TEXT,
    full_name TEXT NOT NULL,
    email TEXT,
    phone TEXT,
    role TEXT DEFAULT 'waiter',
    is_active INTEGER DEFAULT 1,
    invited_at TEXT,
    joined_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    sync_status TEXT DEFAULT 'synced'
  );

  CREATE TABLE IF NOT EXISTS sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_name TEXT NOT NULL,
    record_id TEXT NOT NULL,
    action TEXT NOT NULL,
    synced_at TEXT DEFAULT (datetime('now'))
  );

  -- Shared daily bill-number counter. A single row per day holds the last
  -- issued number so every station (server + clients) draws from one sequence.
  CREATE TABLE IF NOT EXISTS bill_counters (
    date TEXT PRIMARY KEY,
    counter INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_orders_restaurant ON orders(restaurant_id);
  CREATE INDEX IF NOT EXISTS idx_orders_sync ON orders(sync_status);
  CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
  CREATE INDEX IF NOT EXISTS idx_order_items_sync ON order_items(sync_status);
  CREATE INDEX IF NOT EXISTS idx_menu_items_category ON menu_items(category_id);
  CREATE INDEX IF NOT EXISTS idx_menu_categories_restaurant ON menu_categories(restaurant_id);
  CREATE INDEX IF NOT EXISTS idx_kitchens_restaurant ON kitchens(restaurant_id);
  CREATE INDEX IF NOT EXISTS idx_tables_floor ON tables(floor_id);
  CREATE INDEX IF NOT EXISTS idx_floors_restaurant ON floors(restaurant_id);
  CREATE INDEX IF NOT EXISTS idx_staff_members_restaurant ON staff_members(restaurant_id);
`;

const VALID_TABLES = ['orders', 'order_items', 'menu_categories', 'menu_items', 'kitchens', 'floors', 'tables', 'restaurants', 'staff_members'];

export class LocalDatabase {
  private db: Database.Database;

  constructor(userDataPath: string) {
    const dbPath = path.join(userDataPath, 'restroflow.db');
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    // The LAN server opens this same file on a second connection. Without a busy
    // timeout, a write from one connection while the other holds the lock throws
    // SQLITE_BUSY immediately. 5s lets concurrent writes serialize cleanly.
    this.db.pragma('busy_timeout = 5000');
    this.initialize();
  }

  private initialize() {
    // Drop and recreate tables if schema changed (dev-friendly migration)
    try {
      // Check if schema needs migration by looking for a key column
      const info = this.db.prepare("PRAGMA table_info('floors')").all() as any[];
      const hasFloorNumber = info.some((col: any) => col.name === 'floor_number');
      if (info.length > 0 && !hasFloorNumber) {
        console.log('[LocalDB] Schema migration: dropping old tables');
        const oldTables = ['order_items', 'orders', 'menu_items', 'menu_categories', 'kitchens', 'tables', 'floors', 'restaurants', 'staff_members', 'sync_log'];
        for (const t of oldTables) {
          this.db.exec(`DROP TABLE IF EXISTS ${t}`);
        }
      }
      
      // Check if menu_items has restaurant_id column (old schema) - need to migrate
      const menuItemsInfo = this.db.prepare("PRAGMA table_info('menu_items')").all() as any[];
      const hasRestaurantId = menuItemsInfo.some((col: any) => col.name === 'restaurant_id');
      if (menuItemsInfo.length > 0 && hasRestaurantId) {
        console.log('[LocalDB] Schema migration: menu_items schema changed, dropping table');
        this.db.exec(`DROP TABLE IF EXISTS menu_items`);
      }

      // Check if staff_members has 'name' column instead of 'full_name' (old schema)
      const staffInfo = this.db.prepare("PRAGMA table_info('staff_members')").all() as any[];
      const hasNameColumn = staffInfo.some((col: any) => col.name === 'name');
      const hasFullNameColumn = staffInfo.some((col: any) => col.name === 'full_name');
      if (staffInfo.length > 0 && hasNameColumn && !hasFullNameColumn) {
        console.log('[LocalDB] Schema migration: staff_members schema changed (name -> full_name), dropping table');
        this.db.exec(`DROP TABLE IF EXISTS staff_members`);
      }

      // Check if menu_categories has 'description' column
      const categoriesInfo = this.db.prepare("PRAGMA table_info('menu_categories')").all() as any[];
      const hasDescription = categoriesInfo.some((col: any) => col.name === 'description');
      if (categoriesInfo.length > 0 && !hasDescription) {
        console.log('[LocalDB] Schema migration: menu_categories schema changed (added description), dropping table');
        this.db.exec(`DROP TABLE IF EXISTS menu_categories`);
      }

      // Check if kitchens has 'description' and 'is_active' columns
      const kitchensInfo = this.db.prepare("PRAGMA table_info('kitchens')").all() as any[];
      const hasKitchenDescription = kitchensInfo.some((col: any) => col.name === 'description');
      const hasKitchenIsActive = kitchensInfo.some((col: any) => col.name === 'is_active');
      if (kitchensInfo.length > 0 && (!hasKitchenDescription || !hasKitchenIsActive)) {
        console.log('[LocalDB] Schema migration: kitchens schema changed (added description, is_active), dropping table');
        this.db.exec(`DROP TABLE IF EXISTS kitchens`);
      }

      // Check if orders has 'notes' column
      const ordersInfo = this.db.prepare("PRAGMA table_info('orders')").all() as any[];
      const hasNotes = ordersInfo.some((col: any) => col.name === 'notes');
      if (ordersInfo.length > 0 && !hasNotes) {
        console.log('[LocalDB] Schema migration: orders schema changed (added notes), dropping table');
        this.db.exec(`DROP TABLE IF EXISTS orders`);
      }

      // Check if order_items has 'kitchen_id' column
      const orderItemsInfo = this.db.prepare("PRAGMA table_info('order_items')").all() as any[];
      const hasKitchenId = orderItemsInfo.some((col: any) => col.name === 'kitchen_id');
      if (orderItemsInfo.length > 0 && !hasKitchenId) {
        console.log('[LocalDB] Schema migration: order_items schema changed (added kitchen_id), dropping table');
        this.db.exec(`DROP TABLE IF EXISTS order_items`);
      }

      // Check if menu_items has 'shortcut_code' column
      const menuItemsShortcutInfo = this.db.prepare("PRAGMA table_info('menu_items')").all() as any[];
      const hasShortcutCode = menuItemsShortcutInfo.some((col: any) => col.name === 'shortcut_code');
      if (menuItemsShortcutInfo.length > 0 && !hasShortcutCode) {
        console.log('[LocalDB] Schema migration: menu_items schema changed (added shortcut_code)');
        this.db.exec('ALTER TABLE menu_items ADD COLUMN shortcut_code TEXT');
      }

      const hasMenuSortOrder = menuItemsShortcutInfo.some((col: any) => col.name === 'sort_order');
      if (menuItemsShortcutInfo.length > 0 && !hasMenuSortOrder) {
        console.log('[LocalDB] Schema migration: menu_items schema changed (added sort_order)');
        this.db.exec('ALTER TABLE menu_items ADD COLUMN sort_order INTEGER DEFAULT 0');
      }

      // Check if restaurants has 'payment_qr_content' column
      const restaurantsInfo = this.db.prepare("PRAGMA table_info('restaurants')").all() as any[];
      const hasPaymentQrContent = restaurantsInfo.some((col: any) => col.name === 'payment_qr_content');
      if (restaurantsInfo.length > 0 && !hasPaymentQrContent) {
        console.log('[LocalDB] Schema migration: restaurants schema changed (added payment_qr_content)');
        this.db.exec('ALTER TABLE restaurants ADD COLUMN payment_qr_content TEXT');
      }

      const hasLockSavedItems = restaurantsInfo.some((col: any) => col.name === 'lock_saved_items');
      if (restaurantsInfo.length > 0 && !hasLockSavedItems) {
        console.log('[LocalDB] Schema migration: restaurants schema changed (added lock_saved_items)');
        this.db.exec('ALTER TABLE restaurants ADD COLUMN lock_saved_items INTEGER DEFAULT 0');
      }

      // Check if orders has 'bill_number' column
      const ordersBillInfo = this.db.prepare("PRAGMA table_info('orders')").all() as any[];
      const hasBillNumber = ordersBillInfo.some((col: any) => col.name === 'bill_number');
      if (ordersBillInfo.length > 0 && !hasBillNumber) {
        console.log('[LocalDB] Schema migration: orders schema changed (added bill_number)');
        this.db.exec('ALTER TABLE orders ADD COLUMN bill_number INTEGER');
      }

      // Ensure orders has the billing breakdown columns (discount / GST / final /
      // payment_status). Added for the in-bill discount feature; existing DBs get
      // them via ALTER so the server-PC path can persist a discounted bill.
      if (ordersBillInfo.length > 0) {
        const ensureOrderColumn = (name: string, ddl: string) => {
          if (!ordersBillInfo.some((col: any) => col.name === name)) {
            console.log(`[LocalDB] Schema migration: orders adding ${name}`);
            this.db.exec(`ALTER TABLE orders ADD COLUMN ${ddl}`);
          }
        };
        ensureOrderColumn('discount_amount', 'discount_amount REAL DEFAULT 0');
        ensureOrderColumn('cgst_amount', 'cgst_amount REAL DEFAULT 0');
        ensureOrderColumn('sgst_amount', 'sgst_amount REAL DEFAULT 0');
        ensureOrderColumn('final_amount', 'final_amount REAL DEFAULT 0');
        ensureOrderColumn('payment_status', "payment_status TEXT DEFAULT 'pending'");
      }

      // Ensure every mirrored table has a sync_status column BEFORE TABLES_SCHEMA
      // runs. Older local DBs predate this column on some tables (notably
      // order_items), which made `CREATE INDEX ... ON order_items(sync_status)`
      // throw "no such column: sync_status" and crash the main process at startup.
      // Self-heal by adding the column instead of dropping the table (keeps data).
      for (const t of VALID_TABLES) {
        const cols = this.db.prepare(`PRAGMA table_info(${t})`).all() as any[];
        if (cols.length > 0 && !cols.some((col: any) => col.name === 'sync_status')) {
          // orders/order_items default to pending so unsynced local rows still push.
          const def = (t === 'orders' || t === 'order_items') ? "'pending_sync'" : "'synced'";
          console.log(`[LocalDB] Schema migration: ${t} adding sync_status`);
          this.db.exec(`ALTER TABLE ${t} ADD COLUMN sync_status TEXT DEFAULT ${def}`);
        }
      }

      // Parcel/takeaway flag on order_items (dine-in items on a running table can
      // also carry parcel items in the SAME order; is_parcel=1 marks those). Older
      // DBs predate the column — add it so inserts including is_parcel don't throw.
      const oiCols = this.db.prepare("PRAGMA table_info('order_items')").all() as any[];
      if (oiCols.length > 0 && !oiCols.some((c: any) => c.name === 'is_parcel')) {
        console.log('[LocalDB] Schema migration: order_items adding is_parcel');
        this.db.exec('ALTER TABLE order_items ADD COLUMN is_parcel INTEGER DEFAULT 0');
      }

      // Snapshot column on order_items (nullable → NULL = fall back to menu item).
      if (oiCols.length > 0 && !oiCols.some((c: any) => c.name === 'is_gst_exempt')) {
        console.log('[LocalDB] Schema migration: order_items adding is_gst_exempt');
        this.db.exec('ALTER TABLE order_items ADD COLUMN is_gst_exempt INTEGER');
      }

      // Per-item GST exemption: menu items flagged here are excluded from the GST
      // base at billing time. Default 0 → every existing item is taxed as before.
      const miCols = this.db.prepare("PRAGMA table_info('menu_items')").all() as any[];
      if (miCols.length > 0 && !miCols.some((c: any) => c.name === 'is_gst_exempt')) {
        console.log('[LocalDB] Schema migration: menu_items adding is_gst_exempt');
        this.db.exec('ALTER TABLE menu_items ADD COLUMN is_gst_exempt INTEGER DEFAULT 0');
      }

      // One-off "open item" lines typed in during order taking.
      if (miCols.length > 0 && !miCols.some((c: any) => c.name === 'is_open_item')) {
        console.log('[LocalDB] Schema migration: menu_items adding is_open_item');
        this.db.exec('ALTER TABLE menu_items ADD COLUMN is_open_item INTEGER DEFAULT 0');
      }

      // Table over-time alert threshold (minutes; 0 = disabled), set on the server.
      const rCols = this.db.prepare("PRAGMA table_info('restaurants')").all() as any[];
      if (rCols.length > 0 && !rCols.some((c: any) => c.name === 'table_alert_minutes')) {
        console.log('[LocalDB] Schema migration: restaurants adding table_alert_minutes');
        this.db.exec('ALTER TABLE restaurants ADD COLUMN table_alert_minutes INTEGER DEFAULT 0');
      }
    } catch (e) {
      // First run, tables don't exist yet
    }
    this.db.exec(TABLES_SCHEMA);
  }

  /**
   * Query records from a table with optional filters
   */
  query(table: string, filters?: Record<string, any>): any[] {
    this.validateTable(table);

    let sql = `SELECT * FROM ${table}`;
    const params: any[] = [];

    if (filters && Object.keys(filters).length > 0) {
      const conditions = Object.entries(filters).map(([key, _value]) => {
        // Convert boolean to integer for SQLite compatibility
        if (typeof _value === 'boolean') {
          params.push(_value ? 1 : 0);
        } else {
          params.push(_value);
        }
        return `${key} = ?`;
      });
      sql += ` WHERE ${conditions.join(' AND ')}`;
    }

    sql += ` ORDER BY updated_at DESC`;
    return this.db.prepare(sql).all(...params);
  }

  /**
   * Upsert a record (insert or update on conflict)
   */
  upsert(table: string, data: Record<string, any>) {
    this.validateTable(table);

    // Ensure updated_at is set
    data.updated_at = data.updated_at || new Date().toISOString();

    // If no sync_status provided, mark as pending
    if (!data.sync_status) {
      data.sync_status = 'pending_sync';
    }

    const columns = Object.keys(data);
    const placeholders = columns.map(() => '?').join(', ');

    // Non-destructive upsert: update ONLY the columns provided; leave all other
    // existing columns untouched. (A partial update like { id, is_occupied }
    // must not disturb floor_id, table_number, capacity, etc.)
    //
    // created_at is excluded from the UPDATE on purpose — a row is created once
    // and that timestamp is immutable. The write layer fills in a created_at of
    // "now" whenever a caller sends a partial patch that omits it (e.g. the
    // {id, bill_number} patch written when a bill is printed, or the
    // {id, status, payment_method} patch written on payment). Letting that reach
    // the UPDATE clause silently reset the order's creation time to the moment
    // it was printed/settled — which made reprinted bills show the current time
    // instead of when the order was raised, and moved orders into the wrong day
    // in Reports and in the daily bill-number lookup.
    const updates = columns
      .filter(c => c !== 'id' && c !== 'created_at')
      .map(c => `${c} = excluded.${c}`)
      .join(', ');

    const sql = updates
      ? `INSERT INTO ${table} (${columns.join(', ')})
         VALUES (${placeholders})
         ON CONFLICT(id) DO UPDATE SET ${updates}`
      : `INSERT INTO ${table} (${columns.join(', ')})
         VALUES (${placeholders})
         ON CONFLICT(id) DO NOTHING`;

    // Convert boolean values to integers for SQLite compatibility
    const values = columns.map(c => {
      const val = data[c];
      if (typeof val === 'boolean') {
        return val ? 1 : 0;
      }
      return val;
    });

    try {
      this.db.prepare(sql).run(...values);
    } catch (e: any) {
      console.error(`[LocalDB] Upsert error for ${table}:`, e.message, 'SQL:', sql, 'Values:', values);
      throw e;
    }

    // Keep the parent order's subtotal in sync with its items.
    if (table === 'order_items' && data.order_id) {
      this.recomputeOrderTotal(data.order_id);
    }
  }

  /**
   * Recompute an order's subtotal from its live order_items.
   *
   * total_amount is the one aggregate two stations could clobber by each writing
   * a value derived from their own (possibly stale) cart. Deriving it from the
   * actual item rows instead makes it self-healing: whoever writes last, the
   * total always equals the sum of items currently on the order. Cancelled/void
   * items are excluded, matching how the cart computes its total.
   */
  private recomputeOrderTotal(orderId: string) {
    if (!orderId) return;
    try {
      const row = this.db
        .prepare(
          `SELECT COALESCE(SUM(quantity * unit_price), 0) AS total
           FROM order_items
           WHERE order_id = ? AND status NOT IN ('cancelled','void')`
        )
        .get(orderId) as { total: number };
      this.db
        .prepare(`UPDATE orders SET total_amount = ?, updated_at = ? WHERE id = ?`)
        .run(row.total, new Date().toISOString(), orderId);
    } catch (e: any) {
      console.warn('[LocalDB] recomputeOrderTotal failed for', orderId, e?.message);
    }
  }

  /**
   * Get column names for a table
   */
  private getTableColumns(table: string): string[] {
    const columns: { name: string }[] = this.db.prepare(`PRAGMA table_info(${table})`).all() as any[];
    return columns.map(c => c.name);
  }

  /**
   * Bulk upsert records (for sync downloads)
   */
  bulkUpsert(table: string, records: Record<string, any>[]) {
    this.validateTable(table);
    const transaction = this.db.transaction((items: Record<string, any>[]) => {
      for (const item of items) {
        this.upsert(table, { ...item, sync_status: 'synced' });
      }
    });
    transaction(records);
  }

  /**
   * Get all records with pending sync status (including pending deletes)
   */
  getPendingSync(): SyncRecord[] {
    const results: SyncRecord[] = [];

    for (const table of VALID_TABLES) {
      const rows = this.db
        .prepare(`SELECT * FROM ${table} WHERE sync_status IN ('pending_sync', 'pending_delete')`)
        .all() as any[];

      for (const row of rows) {
        results.push({
          table_name: table,
          record_id: row.id,
          data: JSON.stringify(row),
          sync_status: row.sync_status,
          updated_at: row.updated_at,
        });
      }
    }

    return results;
  }

  /**
   * Mark a record as synced
   */
  markSynced(table: string, id: string) {
    this.validateTable(table);
    this.db.prepare(`UPDATE ${table} SET sync_status = 'synced' WHERE id = ?`).run(id);
    this.db.prepare(
      `INSERT INTO sync_log (table_name, record_id, action) VALUES (?, ?, 'synced')`
    ).run(table, id);
  }

  /**
   * Delete a record from a table
   */
  deleteRecord(table: string, id: string) {
    this.validateTable(table);

    // Capture the parent order before deleting an item so we can re-total it.
    let orderId: string | undefined;
    if (table === 'order_items') {
      const r = this.db.prepare('SELECT order_id FROM order_items WHERE id = ?').get(id) as any;
      orderId = r?.order_id;
    }

    this.db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);

    if (orderId) this.recomputeOrderTotal(orderId);
  }

  /**
   * Clear all records from a table
   */
  clearTable(table: string) {
    this.validateTable(table);
    this.db.prepare(`DELETE FROM ${table}`).run();
  }

  /**
   * Get last sync timestamp for a table
   */
  getLastSyncTime(table: string): string | null {
    this.validateTable(table);
    const row = this.db
      .prepare(`SELECT MAX(synced_at) as last_sync FROM sync_log WHERE table_name = ?`)
      .get(table) as any;
    return row?.last_sync || null;
  }

  /**
   * Atomically reserve and return the next daily bill number.
   *
   * Runs inside a transaction so two concurrent callers (e.g. the server UI and
   * a client over the LAN, both touching the same file) can never receive the
   * same number. Resets to 1 automatically each calendar day.
   */
  getNextBillNumber(): number {
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const txn = this.db.transaction((date: string) => {
      const row = this.db
        .prepare('SELECT counter FROM bill_counters WHERE date = ?')
        .get(date) as { counter: number } | undefined;
      const next = (row?.counter ?? 0) + 1;
      this.db
        .prepare(
          `INSERT INTO bill_counters (date, counter) VALUES (?, ?)
           ON CONFLICT(date) DO UPDATE SET counter = excluded.counter`
        )
        .run(date, next);
      return next;
    });
    return txn(today);
  }

  /**
   * Close the database connection
   */
  close() {
    this.db.close();
  }

  private validateTable(table: string) {
    if (!VALID_TABLES.includes(table)) {
      throw new Error(`Invalid table name: ${table}`);
    }
  }
}

