// SQLite-based LAN Server
// Non-technical users just click "Start Server" - everything happens automatically

import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import { createServer } from 'http';
import path from 'path';
import os from 'os';
import fs from 'fs';
import Database from 'better-sqlite3';
import { LanServerSchemaMigration } from './migrateLanServerSchema.js';
import { DataValidator } from './dataValidator.js';

export interface SqliteLanServerStatus {
  isRunning: boolean;
  dbStatus: 'stopped' | 'starting' | 'ready' | 'error';
  serverIp: string;
  port: number;
  clientsConnected: number;
  error?: string;
}

export class SqliteLanServer {
  private app: express.Application;
  private server: ReturnType<typeof createServer>;
  private wss: WebSocketServer;
  private db: Database.Database | null = null;
  private clients = new Map<string, { ws: WebSocket; deviceType: string; deviceName: string }>();
  private _isRunning = false;
  private dbStatus: SqliteLanServerStatus['dbStatus'] = 'stopped';
  private errorMessage: string | null = null;
  private dataDir: string;
  private port = 3333;

  constructor(private userDataPath: string) {
    this.app = express();
    this.server = createServer(this.app);
    this.wss = new WebSocketServer({ server: this.server });
    // Use the SAME database as the main app (restroflow.db)
    this.dataDir = userDataPath;
    
    this.setupMiddleware();
    this.setupRoutes();
    this.setupWebSocket();
  }

  private setupMiddleware() {
    this.app.use(cors());
    this.app.use(express.json({ limit: '10mb' }));
  }

  private setupRoutes() {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ 
        status: this.dbStatus === 'ready' ? 'ok' : 'error',
        dbStatus: this.dbStatus,
        clients: this.clients.size
      });
    });

    // Query endpoint
    this.app.post('/query/:table', (req, res) => {
      try {
        if (!this.db) throw new Error('Database not ready');
        
        const { table } = req.params;
        const filters = req.body.filters || {};
        
        console.log('[LAN Server] ========================================');
        console.log('[LAN Server] QUERY REQUEST from client');
        console.log('[LAN Server] Table:', table);
        console.log('[LAN Server] Filters:', JSON.stringify(filters));
        console.log('[LAN Server] Client IP:', req.ip);
        
        let sql = `SELECT * FROM ${table}`;
        const params: any[] = [];
        
        const conditions = Object.entries(filters);
        if (conditions.length > 0) {
          sql += ' WHERE ' + conditions.map(([key, value]) => {
            // Array value → `col IN (...)`, so a client can ask for just the live
            // orders instead of downloading the entire order history over HTTP.
            if (Array.isArray(value)) {
              if (value.length === 0) return '0'; // match nothing
              for (const v of value) params.push(typeof v === 'boolean' ? (v ? 1 : 0) : v);
              return `${key} IN (${value.map(() => '?').join(',')})`;
            }
            params.push(typeof value === 'boolean' ? (value ? 1 : 0) : value);
            return `${key} = ?`;
          }).join(' AND ');
        }
        
        console.log('[LAN Server] SQL Query:', sql);
        console.log('[LAN Server] SQL Params:', params);
        
        const stmt = this.db.prepare(sql);
        const rows = stmt.all(...params);
        
        console.log('[LAN Server] Query result:', rows.length, 'records');
        if (rows.length > 0) {
          console.log('[LAN Server] Sample data (first 2 records):', JSON.stringify(rows.slice(0, 2), null, 2));
        } else {
          console.warn('[LAN Server] ⚠️ No records found in table:', table);
          // Check if table exists and has ANY data
          const countStmt = this.db.prepare(`SELECT COUNT(*) as count FROM ${table}`);
          const totalCount = countStmt.get() as { count: number };
          console.warn('[LAN Server] Total records in', table, ':', totalCount.count);
        }
        console.log('[LAN Server] ========================================');
        
        res.json({ success: true, data: rows });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // Upsert endpoint
    this.app.post('/upsert/:table', (req, res) => {
      try {
        if (!this.db) throw new Error('Database not ready');
        
        const { table } = req.params;
        const data = req.body;
        
        console.log('[LAN Server] ========================================');
        console.log('[LAN Server] UPSERT REQUEST from client');
        console.log('[LAN Server] Table:', table);
        console.log('[LAN Server] Record ID:', data.id);
        console.log('[LAN Server] Data keys:', Object.keys(data));
        console.log('[LAN Server] Client IP:', req.ip);
        
        // Validate data before insert
        DataValidator.validate(table, data);
        
        const columns = Object.keys(data);
        const placeholders = columns.map(() => '?').join(',');
        const values = Object.values(data);

        // Non-destructive upsert: update ONLY the columns provided and leave the
        // rest untouched. INSERT OR REPLACE would delete+reinsert the row, so a
        // partial update like { id, is_occupied } from a client would blank
        // floor_id/table_number — making the table vanish from the kiosk.
        //
        // created_at is never updated: it is set once when the row is created.
        // Clients send a "now" created_at on partial patches that omit it, which
        // would otherwise reset an order's creation time on every bill print or
        // payment (see the matching note in localDb.upsert).
        const updateClause = columns.filter(c => c !== 'id' && c !== 'created_at').map(c => `${c} = excluded.${c}`).join(', ');
        const sql = updateClause
          ? `INSERT INTO ${table} (${columns.join(',')}) VALUES (${placeholders}) ON CONFLICT(id) DO UPDATE SET ${updateClause}`
          : `INSERT INTO ${table} (${columns.join(',')}) VALUES (${placeholders}) ON CONFLICT(id) DO NOTHING`;
        console.log('[LAN Server] SQL:', sql.substring(0, 100) + '...');

        const stmt = this.db.prepare(sql);
        const result = stmt.run(...values);
        
        console.log('[LAN Server] ✓ Upsert successful, lastInsertRowid:', result.lastInsertRowid);
        console.log('[LAN Server] ========================================');
        
        // Broadcast change to all clients
        this.broadcast({ type: 'record-changed', table, data });

        // Keep the parent order's subtotal correct (and broadcast it).
        if (table === 'order_items' && data.order_id) {
          this.recomputeOrderTotal(data.order_id);
        }

        res.json({ success: true, id: data.id || result.lastInsertRowid });
      } catch (err: any) {
        console.error(`[LAN Server] ✗ Upsert error:`, err.message);
        res.status(400).json({ success: false, error: err.message });
      }
    });

    // Delete endpoint
    this.app.post('/delete/:table', (req, res) => {
      try {
        if (!this.db) throw new Error('Database not ready');
        
        const { table } = req.params;
        const { id } = req.body;

        if (!id) {
          throw new Error('ID is required for delete operation');
        }

        // Capture the parent order before deleting an item so we can re-total it.
        let affectedOrderId: string | undefined;
        if (table === 'order_items') {
          const r = this.db.prepare('SELECT order_id FROM order_items WHERE id = ?').get(id) as any;
          affectedOrderId = r?.order_id;
        }

        const stmt = this.db.prepare(`DELETE FROM ${table} WHERE id = ?`);
        const result = stmt.run(id);

        if (result.changes === 0) {
          return res.status(404).json({ success: false, error: 'Record not found' });
        }

        this.broadcast({ type: 'record-deleted', table, id });

        if (affectedOrderId) {
          this.recomputeOrderTotal(affectedOrderId);
        }

        res.json({ success: true });
      } catch (err: any) {
        console.error(`[SqliteLAN] Delete error:`, err.message);
        res.status(400).json({ success: false, error: err.message });
      }
    });

    // Batch upsert endpoint
    this.app.post('/upsert-batch/:table', (req, res) => {
      try {
        if (!this.db) throw new Error('Database not ready');
        
        const { table } = req.params;
        const records = req.body.records;
        
        if (!Array.isArray(records) || records.length === 0) {
          throw new Error('Records array is required and must not be empty');
        }
        
        if (records.length > 1000) {
          throw new Error('Batch size limit exceeded (max 1000 records)');
        }
        
        // Validate all records first
        for (let i = 0; i < records.length; i++) {
          try {
            DataValidator.validate(table, records[i]);
          } catch (validationError: any) {
            throw new Error(`Validation failed for record ${i}: ${validationError.message}`);
          }
        }
        
        // Use transaction for atomicity
        const transaction = this.db.transaction(() => {
          let successCount = 0;
          for (const data of records) {
            const columns = Object.keys(data);
            const placeholders = columns.map(() => '?').join(',');
            const values = Object.values(data);

            // created_at excluded from UPDATE — immutable once the row exists.
            const updateClause = columns.filter(c => c !== 'id' && c !== 'created_at').map(c => `${c} = excluded.${c}`).join(', ');
            const sql = updateClause
              ? `INSERT INTO ${table} (${columns.join(',')}) VALUES (${placeholders}) ON CONFLICT(id) DO UPDATE SET ${updateClause}`
              : `INSERT INTO ${table} (${columns.join(',')}) VALUES (${placeholders}) ON CONFLICT(id) DO NOTHING`;
            const stmt = this.db!.prepare(sql);
            stmt.run(...values);
            successCount++;
          }
          return successCount;
        });
        
        const count = transaction();

        // Broadcast batch change
        this.broadcast({ type: 'batch-upsert', table, count });

        // Re-total any orders touched by an item batch.
        if (table === 'order_items') {
          const orderIds = [...new Set(records.map((r: any) => r.order_id).filter(Boolean))];
          for (const oid of orderIds) this.recomputeOrderTotal(oid as string);
        }

        res.json({ success: true, count });
      } catch (err: any) {
        console.error(`[SqliteLAN] Batch upsert error:`, err.message);
        res.status(400).json({ success: false, error: err.message });
      }
    });

    // Batch delete endpoint
    this.app.post('/delete-batch/:table', (req, res) => {
      try {
        if (!this.db) throw new Error('Database not ready');
        
        const { table } = req.params;
        const { ids } = req.body;
        
        if (!Array.isArray(ids) || ids.length === 0) {
          throw new Error('IDs array is required and must not be empty');
        }
        
        if (ids.length > 1000) {
          throw new Error('Batch size limit exceeded (max 1000 records)');
        }

        // Capture parent orders before deleting items so we can re-total them.
        let affectedOrderIds: string[] = [];
        if (table === 'order_items') {
          const placeholders = ids.map(() => '?').join(',');
          const rows = this.db.prepare(`SELECT DISTINCT order_id FROM order_items WHERE id IN (${placeholders})`).all(...ids) as any[];
          affectedOrderIds = rows.map(r => r.order_id).filter(Boolean);
        }

        // Use transaction for atomicity
        const transaction = this.db.transaction(() => {
          let deleteCount = 0;
          const stmt = this.db!.prepare(`DELETE FROM ${table} WHERE id = ?`);

          for (const id of ids) {
            const result = stmt.run(id);
            deleteCount += result.changes;
          }

          return deleteCount;
        });

        const count = transaction();

        // Broadcast batch deletion
        this.broadcast({ type: 'batch-delete', table, count, ids });

        for (const oid of affectedOrderIds) this.recomputeOrderTotal(oid);

        res.json({ success: true, count });
      } catch (err: any) {
        console.error(`[SqliteLAN] Batch delete error:`, err.message);
        res.status(400).json({ success: false, error: err.message });
      }
    });

    // Atomically reserve the next daily bill number (shared across all clients)
    this.app.post('/next-bill-number', (req, res) => {
      try {
        if (!this.db) throw new Error('Database not ready');

        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        const db = this.db;
        const txn = db.transaction((date: string) => {
          const row = db
            .prepare('SELECT counter FROM bill_counters WHERE date = ?')
            .get(date) as { counter: number } | undefined;
          const next = (row?.counter ?? 0) + 1;
          db.prepare(
            `INSERT INTO bill_counters (date, counter) VALUES (?, ?)
             ON CONFLICT(date) DO UPDATE SET counter = excluded.counter`
          ).run(date, next);
          return next;
        });
        const billNumber = txn(today);

        res.json({ success: true, billNumber });
      } catch (err: any) {
        console.error('[LAN Server] next-bill-number error:', err.message);
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // Get kitchen orders
    this.app.get('/kitchen-orders/:kitchenId', (req, res) => {
      try {
        if (!this.db) throw new Error('Database not ready');
        
        const kitchenId = (req.params as any).kitchenId === 'all' ? null : (req.params as any).kitchenId;
        const status = req.query.status as string | undefined;
        
        let sql = `
          SELECT oi.*, o.table_id, o.status as order_status, mi.name as item_name
          FROM order_items oi
          JOIN orders o ON oi.order_id = o.id
          JOIN menu_items mi ON oi.menu_item_id = mi.id
          WHERE 1=1
        `;
        const params: any[] = [];
        
        if (kitchenId) {
          sql += ' AND mi.kitchen_id = ?';
          params.push(kitchenId);
        }
        if (status) {
          sql += ' AND oi.status = ?';
          params.push(status);
        }
        
        sql += ' ORDER BY oi.created_at DESC';
        
        const stmt = this.db.prepare(sql);
        const rows = stmt.all(...params);
        res.json({ success: true, data: rows });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
      }
    });

    // Update order item status
    this.app.post('/update-order-item-status', (req, res) => {
      try {
        if (!this.db) throw new Error('Database not ready');
        
        const { itemId, status } = req.body;
        
        const stmt = this.db.prepare(`
          UPDATE order_items 
          SET status = ?, updated_at = datetime('now') 
          WHERE id = ?
        `);
        stmt.run(status, itemId);
        
        this.broadcast({ type: 'order-status-changed', itemId, status });
        
        res.json({ success: true });
      } catch (err: any) {
        res.status(500).json({ success: false, error: err.message });
      }
    });
  }

  private setupWebSocket() {
    this.wss.on('connection', (ws) => {
      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message.toString());
          
          if (data.type === 'register') {
            const { deviceId, deviceType, deviceName } = data;
            this.clients.set(deviceId, { ws, deviceType, deviceName });
            ws.send(JSON.stringify({ type: 'registered', success: true }));
          }
          
          if (data.type === 'ping') {
            ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          }
        } catch (err) {
          console.error('[SqliteLAN] WebSocket message error:', err);
        }
      });
      
      ws.on('close', () => {
        for (const [deviceId, client] of this.clients.entries()) {
          if (client.ws === ws) {
            this.clients.delete(deviceId);
            break;
          }
        }
      });
    });
  }

  private broadcast(message: any) {
    const messageStr = JSON.stringify(message);
    this.clients.forEach((client) => {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(messageStr);
      }
    });
  }

  /**
   * Broadcast a change that was written to SQLite by the SERVER PC's own UI
   * (i.e. through the main-process `db:*` IPC handlers, not the HTTP endpoints).
   * Those local writes bypass `setupRoutes()` entirely, so without this bridge a
   * bill number assigned / table freed / payment taken on the server would not
   * reach connected clients until their next poll (~10s). Calling this from the
   * IPC handlers makes server-side changes reflect on every client in real time
   * — the same `record-changed` message a client-originated write produces.
   * No-op when nothing is connected.
   */
  broadcastLocalChange(table: string, data: any) {
    if (!this._isRunning || this.clients.size === 0) return;
    this.broadcast({ type: 'record-changed', table, data });
  }

  broadcastLocalDelete(table: string, id: string) {
    if (!this._isRunning || this.clients.size === 0) return;
    this.broadcast({ type: 'record-deleted', table, id });
  }

  /**
   * Recompute an order's subtotal from its live order_items and broadcast the
   * change. total_amount is the one aggregate two stations could clobber with a
   * stale-cart value; deriving it from the actual item rows makes it self-healing
   * regardless of which client writes last. Returns the updated order row (or
   * null) so callers can broadcast it.
   */
  private recomputeOrderTotal(orderId: string): any | null {
    if (!this.db || !orderId) return null;
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
      const updated = this.db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      if (updated) {
        this.broadcast({ type: 'record-changed', table: 'orders', data: updated });
      }
      return updated ?? null;
    } catch (err: any) {
      console.warn('[LAN Server] recomputeOrderTotal failed for', orderId, err?.message);
      return null;
    }
  }

  private getServerIp(): string {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name] || []) {
        if (iface.family === 'IPv4' && !iface.internal) {
          return iface.address;
        }
      }
    }
    return 'localhost';
  }

  private initializeDatabase(): boolean {
    try {
      this.dbStatus = 'starting';
      console.log('[SqliteLAN] Initializing SQLite database...');
      console.log('[SqliteLAN] Data directory:', this.dataDir);

      // Ensure data directory exists
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
        console.log('[SqliteLAN] Created data directory');
      }

      const dbPath = path.join(this.dataDir, 'restroflow.db');
      
      // Run schema migration before opening database
      console.log('[SqliteLAN] Running schema migration check...');
      try {
        LanServerSchemaMigration.migrate(dbPath);
        console.log('[SqliteLAN] Schema migration check completed');
      } catch (migrationError: any) {
        console.warn('[SqliteLAN] Schema migration warning:', migrationError.message);
        // Continue anyway - migration is best-effort
      }
      
      // Open database with WAL mode for better concurrency
      this.db = new Database(dbPath);
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('foreign_keys = ON');
      // The main app holds a second connection to this same file; a busy timeout
      // lets concurrent writes serialize instead of throwing SQLITE_BUSY.
      this.db.pragma('busy_timeout = 5000');
      
      console.log('[SqliteLAN] Database opened at:', dbPath);

      // Initialize schema (CREATE TABLE IF NOT EXISTS will skip if tables exist)
      this.createTables();

      this.dbStatus = 'ready';
      console.log('[SqliteLAN] Database ready!');
      return true;
    } catch (err: any) {
      console.error('[SqliteLAN] Failed to initialize database:', err);
      this.dbStatus = 'error';
      this.errorMessage = err.message;
      return false;
    }
  }

  private createTables() {
    if (!this.db) return;

    // Create all necessary tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS restaurants (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        name TEXT NOT NULL,
        address TEXT,
        phone TEXT,
        email TEXT,
        gstin TEXT,
        slug TEXT UNIQUE,
        cgst_percentage REAL DEFAULT 0,
        sgst_percentage REAL DEFAULT 0,
        print_qr_on_bill INTEGER DEFAULT 1,
        payment_qr_content TEXT,
        lock_saved_items INTEGER DEFAULT 0,
        table_alert_minutes INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS floors (
        id TEXT PRIMARY KEY,
        restaurant_id TEXT NOT NULL,
        name TEXT NOT NULL,
        floor_number INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS tables (
        id TEXT PRIMARY KEY,
        floor_id TEXT,
        table_number TEXT,
        capacity INTEGER DEFAULT 4,
        is_occupied INTEGER DEFAULT 0,
        current_order_id TEXT,
        occupied_since TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS menu_categories (
        id TEXT PRIMARY KEY,
        restaurant_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        sort_order INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS kitchens (
        id TEXT PRIMARY KEY,
        restaurant_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        is_active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
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
        -- 1 = one-off "open item" line (see the note in localDb.ts).
        is_open_item INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

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
        bill_number INTEGER,
        created_by TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS order_items (
        id TEXT PRIMARY KEY,
        order_id TEXT NOT NULL,
        menu_item_id TEXT NOT NULL,
        kitchen_id TEXT,
        quantity INTEGER NOT NULL,
        unit_price REAL NOT NULL,
        total_price REAL NOT NULL,
        special_instructions TEXT,
        status TEXT DEFAULT 'pending',
        is_parcel INTEGER DEFAULT 0,
        -- Snapshot of the menu item's GST-exempt flag when ordered (NULL = not
        -- recorded → callers fall back to the menu item's current flag).
        is_gst_exempt INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (order_id) REFERENCES orders(id),
        FOREIGN KEY (menu_item_id) REFERENCES menu_items(id),
        FOREIGN KEY (kitchen_id) REFERENCES kitchens(id)
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
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS bill_counters (
        date TEXT PRIMARY KEY,
        counter INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_orders_restaurant ON orders(restaurant_id);
      CREATE INDEX IF NOT EXISTS idx_orders_table ON orders(table_id);
      CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
      CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
      CREATE INDEX IF NOT EXISTS idx_order_items_status ON order_items(status);
      CREATE INDEX IF NOT EXISTS idx_menu_items_category ON menu_items(category_id);
      CREATE INDEX IF NOT EXISTS idx_menu_categories_restaurant ON menu_categories(restaurant_id);
      CREATE INDEX IF NOT EXISTS idx_kitchens_restaurant ON kitchens(restaurant_id);
      CREATE INDEX IF NOT EXISTS idx_tables_floor ON tables(floor_id);
      CREATE INDEX IF NOT EXISTS idx_floors_restaurant ON floors(restaurant_id);
      CREATE INDEX IF NOT EXISTS idx_staff_members_restaurant ON staff_members(restaurant_id);
    `);

    console.log('[SqliteLAN] Tables created');
  }

  async start(): Promise<boolean> {
    if (this._isRunning) {
      console.log('[LAN Server] Server already running');
      return true;
    }

    console.log('[LAN Server] ========================================');
    console.log('[LAN Server] STARTING LAN SERVER');
    console.log('[LAN Server] ========================================');

    try {
      // Initialize SQLite database
      console.log('[LAN Server] Step 1: Starting database...');
      const dbStarted = this.initializeDatabase();
      if (!dbStarted) {
        console.error('[LAN Server] ✗ Database failed to start:', this.errorMessage);
        return false;
      }
      console.log('[LAN Server] ✓ Database started successfully');
      console.log('[LAN Server] Database path:', path.join(this.dataDir, 'restroflow.db'));

      // Log initial table counts
      if (this.db) {
        console.log('[LAN Server] ========================================');
        console.log('[LAN Server] INITIAL DATABASE STATE:');
        const tables = ['restaurants', 'floors', 'tables', 'menu_categories', 'menu_items', 'kitchens', 'staff_members', 'orders', 'order_items'];
        for (const table of tables) {
          try {
            const countStmt = this.db.prepare(`SELECT COUNT(*) as count FROM ${table}`);
            const result = countStmt.get() as { count: number };
            console.log(`[LAN Server]   ${table}: ${result.count} records`);
          } catch (err) {
            console.log(`[LAN Server]   ${table}: TABLE NOT FOUND`);
          }
        }
        console.log('[LAN Server] ========================================');
      }

      // Start HTTP/WebSocket server
      console.log('[LAN Server] Step 2: Starting HTTP server on port', this.port);
      return new Promise((resolve, reject) => {
        this.server.listen(this.port, () => {
          console.log(`[LAN Server] ========================================`);
          console.log(`[LAN Server] ✓ SERVER RUNNING`);
          console.log(`[LAN Server] URL: http://${this.getServerIp()}:${this.port}`);
          console.log(`[LAN Server] Clients connected: ${this.clients.size}`);
          console.log(`[LAN Server] ========================================`);
          this._isRunning = true;
          resolve(true);
        });

        this.server.on('error', (err: any) => {
          console.error('[LAN Server] ✗ HTTP server error:', err);
          if (err.code === 'EADDRINUSE') {
            this.errorMessage = `Port ${this.port} is already in use. Try stopping the server first.`;
          } else {
            this.errorMessage = err.message;
          }
          this.dbStatus = 'error';
          reject(err);
        });
      });
    } catch (err: any) {
      console.error('[LAN Server] ✗ Failed to start server:', err);
      this.errorMessage = err.message || String(err);
      return false;
    }
  }

  async stop(): Promise<void> {
    if (!this._isRunning) return;

    // Close all client connections
    this.clients.forEach((client) => {
      client.ws.close();
    });
    this.clients.clear();

    // Close WebSocket server
    this.wss.close();

    // Close HTTP server
    await new Promise<void>((resolve) => {
      this.server.close(() => resolve());
    });

    // Close database
    if (this.db) {
      this.db.close();
      this.db = null;
    }

    this._isRunning = false;
    this.dbStatus = 'stopped';
    console.log('[SqliteLAN] Server stopped');
  }

  getStatus(): SqliteLanServerStatus {
    return {
      isRunning: this._isRunning,
      dbStatus: this.dbStatus,
      serverIp: this.getServerIp(),
      port: this.port,
      clientsConnected: this.clients.size,
      error: this.errorMessage || undefined,
    };
  }
}

// Factory function
export function createSqliteLanServer(userDataPath: string): SqliteLanServer {
  return new SqliteLanServer(userDataPath);
}
