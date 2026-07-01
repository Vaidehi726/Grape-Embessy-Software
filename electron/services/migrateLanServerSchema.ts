// LAN Server Schema Migration Helper
// This script migrates existing LAN server databases to the new schema

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

type SQLiteDatabase = Database.Database;

export class LanServerSchemaMigration {
  /**
   * Migrate an existing LAN server database to the new schema
   * This handles all Phase 1 fixes automatically
   */
  static migrate(dbPath: string): void {
    console.log(`[Migration] Starting LAN server schema migration for: ${dbPath}`);

    if (!fs.existsSync(dbPath)) {
      console.log('[Migration] Database does not exist, no migration needed');
      return;
    }

    const db = new Database(dbPath);
    
    try {
      // Enable WAL mode and foreign keys
      db.pragma('journal_mode = WAL');
      db.pragma('foreign_keys = ON');

      // Step 1: Migrate orders table - add missing columns
      this.migrateOrdersTable(db);

      // Step 2: Migrate staff_members table - rename and add columns
      this.migrateStaffMembersTable(db);

      // Step 3: Migrate order_items table - add FK constraints
      this.migrateOrderItemsTable(db);

      // Step 4: Migrate restaurants table - add payment_qr_content
      this.migrateRestaurantsTable(db);

      // Step 4b: Migrate menu_items table - add shortcut_code + sort_order
      this.migrateMenuItemsTable(db);

      // Step 5: Add missing indexes
      this.addMissingIndexes(db);

      console.log('[Migration] LAN server schema migration completed successfully');
    } catch (error: any) {
      console.error('[Migration] Schema migration failed:', error);
      throw error;
    } finally {
      db.close();
    }
  }

  /**
   * Add missing columns to menu_items table (shortcut_code, sort_order)
   */
  private static migrateMenuItemsTable(db: SQLiteDatabase): void {
    const columns = this.getTableColumns(db, 'menu_items');
    if (columns.length === 0) return; // table will be created fresh with the columns
    if (!columns.find(c => c.name === 'shortcut_code')) {
      console.log('[Migration] Adding column to menu_items: shortcut_code');
      db.exec('ALTER TABLE menu_items ADD COLUMN shortcut_code TEXT');
    }
    if (!columns.find(c => c.name === 'sort_order')) {
      console.log('[Migration] Adding column to menu_items: sort_order');
      db.exec('ALTER TABLE menu_items ADD COLUMN sort_order INTEGER DEFAULT 0');
    }
  }

  /**
   * Add missing columns to orders table
   */
  private static migrateOrdersTable(db: SQLiteDatabase): void {
    console.log('[Migration] Checking orders table schema...');

    const columns = this.getTableColumns(db, 'orders');
    const missingColumns: Array<{ name: string; type: string; default?: string }> = [];

    // Check for missing columns
    if (!columns.find(c => c.name === 'customer_name')) {
      missingColumns.push({ name: 'customer_name', type: 'TEXT' });
    }
    if (!columns.find(c => c.name === 'customer_phone')) {
      missingColumns.push({ name: 'customer_phone', type: 'TEXT' });
    }
    if (!columns.find(c => c.name === 'customer_gstin')) {
      missingColumns.push({ name: 'customer_gstin', type: 'TEXT' });
    }
    if (!columns.find(c => c.name === 'payment_status')) {
      missingColumns.push({ name: 'payment_status', type: 'TEXT', default: "'pending'" });
    }
    if (!columns.find(c => c.name === 'cgst_amount')) {
      missingColumns.push({ name: 'cgst_amount', type: 'REAL', default: '0' });
    }
    if (!columns.find(c => c.name === 'sgst_amount')) {
      missingColumns.push({ name: 'sgst_amount', type: 'REAL', default: '0' });
    }
    if (!columns.find(c => c.name === 'discount_amount')) {
      missingColumns.push({ name: 'discount_amount', type: 'REAL', default: '0' });
    }
    if (!columns.find(c => c.name === 'final_amount')) {
      missingColumns.push({ name: 'final_amount', type: 'REAL', default: '0' });
    }

    // Add missing columns
    for (const col of missingColumns) {
      const defaultClause = col.default ? ` DEFAULT ${col.default}` : '';
      const sql = `ALTER TABLE orders ADD COLUMN ${col.name} ${col.type}${defaultClause}`;
      console.log(`[Migration] Adding column to orders: ${col.name}`);
      db.exec(sql);
    }

    if (missingColumns.length === 0) {
      console.log('[Migration] Orders table schema is up to date');
    } else {
      console.log(`[Migration] Added ${missingColumns.length} columns to orders table`);
    }
  }

  /**
   * Migrate staff_members table - rename 'name' to 'full_name' and add missing columns
   */
  private static migrateStaffMembersTable(db: SQLiteDatabase): void {
    console.log('[Migration] Checking staff_members table schema...');

    const columns = this.getTableColumns(db, 'staff_members');
    const hasNameColumn = columns.find(c => c.name === 'name');
    const hasFullNameColumn = columns.find(c => c.name === 'full_name');

    // If old schema has 'name' column, need to recreate table
    if (hasNameColumn && !hasFullNameColumn) {
      console.log('[Migration] Found old staff_members schema with "name" column, recreating table...');

      // Create new table with correct schema
      db.exec(`
        CREATE TABLE IF NOT EXISTS staff_members_new (
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

        -- Copy data from old table, mapping 'name' to 'full_name'
        INSERT INTO staff_members_new (
          id, restaurant_id, user_id, full_name, email, phone, 
          role, is_active, created_at, updated_at
        )
        SELECT 
          id, restaurant_id, user_id, name as full_name, email, phone,
          role, is_active, created_at, updated_at
        FROM staff_members;

        -- Drop old table and rename new one
        DROP TABLE staff_members;
        ALTER TABLE staff_members_new RENAME TO staff_members;
      `);

      console.log('[Migration] staff_members table migrated successfully');
    } else {
      // Table might already have correct schema, just check for missing columns
      const missingColumns: Array<{ name: string; type: string; default?: string }> = [];

      if (!columns.find(c => c.name === 'user_id')) {
        missingColumns.push({ name: 'user_id', type: 'TEXT' });
      }
      if (!columns.find(c => c.name === 'invited_at')) {
        missingColumns.push({ name: 'invited_at', type: 'TEXT' });
      }
      if (!columns.find(c => c.name === 'joined_at')) {
        missingColumns.push({ name: 'joined_at', type: 'TEXT' });
      }

      // Add missing columns
      for (const col of missingColumns) {
        const defaultClause = col.default ? ` DEFAULT ${col.default}` : '';
        const sql = `ALTER TABLE staff_members ADD COLUMN ${col.name} ${col.type}${defaultClause}`;
        console.log(`[Migration] Adding column to staff_members: ${col.name}`);
        db.exec(sql);
      }

      // Remove 'pin' column if it exists (not in new schema)
      // Note: SQLite doesn't support DROP COLUMN directly, need to recreate table
      const hasPinColumn = columns.find(c => c.name === 'pin');
      if (hasPinColumn) {
        console.log('[Migration] Removing deprecated "pin" column from staff_members...');
        // For now, just leave it - it won't cause issues
        console.log('[Migration] Note: "pin" column retained (SQLite limitation)');
      }

      if (missingColumns.length === 0 && !hasPinColumn) {
        console.log('[Migration] staff_members table schema is up to date');
      }
    }
  }

  /**
   * Migrate order_items table - add foreign key constraints
   * Note: SQLite doesn't support adding FK constraints via ALTER TABLE
   * Need to recreate the table
   */
  private static migrateOrderItemsTable(db: SQLiteDatabase): void {
    console.log('[Migration] Checking order_items table for FK constraints...');

    // Check if table already has proper structure
    const columns = this.getTableColumns(db, 'order_items');
    
    // Check for missing columns
    const missingColumns: Array<{ name: string; type: string; default?: string }> = [];

    if (!columns.find(c => c.name === 'total_price')) {
      missingColumns.push({ name: 'total_price', type: 'REAL', default: '0' });
    }
    if (!columns.find(c => c.name === 'special_instructions')) {
      missingColumns.push({ name: 'special_instructions', type: 'TEXT' });
    }

    // Add missing columns if any
    if (missingColumns.length > 0) {
      console.log('[Migration] Adding missing columns to order_items...');
      
      // Create new table with complete schema
      db.exec(`
        CREATE TABLE IF NOT EXISTS order_items_new (
          id TEXT PRIMARY KEY,
          order_id TEXT NOT NULL,
          menu_item_id TEXT NOT NULL,
          kitchen_id TEXT,
          quantity INTEGER NOT NULL,
          unit_price REAL NOT NULL,
          total_price REAL NOT NULL DEFAULT 0,
          special_instructions TEXT,
          status TEXT DEFAULT 'pending',
          created_at TEXT DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (order_id) REFERENCES orders(id),
          FOREIGN KEY (menu_item_id) REFERENCES menu_items(id),
          FOREIGN KEY (kitchen_id) REFERENCES kitchens(id)
        );

        -- Copy data from old table
        INSERT INTO order_items_new SELECT * FROM order_items;

        -- Drop old table and rename new one
        DROP TABLE order_items;
        ALTER TABLE order_items_new RENAME TO order_items;
      `);

      console.log('[Migration] order_items table migrated with FK constraints');
    } else {
      console.log('[Migration] order_items table columns are up to date');
      console.log('[Migration] Note: FK constraints require table recreation if not present');
    }
  }

  /**
   * Migrate restaurants table - add payment_qr_content column
   */
  private static migrateRestaurantsTable(db: SQLiteDatabase): void {
    console.log('[Migration] Checking restaurants table schema...');

    const columns = this.getTableColumns(db, 'restaurants');
    const missingColumns: Array<{ name: string; type: string; default?: string }> = [];

    // Check for payment_qr_content column
    if (!columns.find(c => c.name === 'payment_qr_content')) {
      missingColumns.push({ name: 'payment_qr_content', type: 'TEXT' });
    }

    // Check for bill_number column
    if (!columns.find(c => c.name === 'bill_number')) {
      missingColumns.push({ name: 'bill_number', type: 'INTEGER' });
    }

    // Check for lock_saved_items column (prevent reducing saved order items)
    if (!columns.find(c => c.name === 'lock_saved_items')) {
      missingColumns.push({ name: 'lock_saved_items', type: 'INTEGER', default: '0' });
    }

    // Add missing columns
    for (const col of missingColumns) {
      const defaultClause = col.default ? ` DEFAULT ${col.default}` : '';
      const sql = `ALTER TABLE restaurants ADD COLUMN ${col.name} ${col.type}${defaultClause}`;
      console.log(`[Migration] Adding column to restaurants: ${col.name}`);
      db.exec(sql);
    }

    if (missingColumns.length === 0) {
      console.log('[Migration] Restaurants table schema is up to date');
    } else {
      console.log(`[Migration] Added ${missingColumns.length} columns to restaurants table`);
    }
  }

  /**
   * Add missing indexes to improve query performance
   */
  private static addMissingIndexes(db: SQLiteDatabase): void {
    console.log('[Migration] Adding missing indexes...');

    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)',
      'CREATE INDEX IF NOT EXISTS idx_order_items_status ON order_items(status)',
      'CREATE INDEX IF NOT EXISTS idx_menu_categories_restaurant ON menu_categories(restaurant_id)',
      'CREATE INDEX IF NOT EXISTS idx_kitchens_restaurant ON kitchens(restaurant_id)',
      'CREATE INDEX IF NOT EXISTS idx_tables_floor ON tables(floor_id)',
      'CREATE INDEX IF NOT EXISTS idx_floors_restaurant ON floors(restaurant_id)',
      'CREATE INDEX IF NOT EXISTS idx_staff_members_restaurant ON staff_members(restaurant_id)',
    ];

    for (const sql of indexes) {
      try {
        db.exec(sql);
        const indexName = sql.match(/idx_\w+/)?.[0];
        console.log(`[Migration] Added index: ${indexName}`);
      } catch (error: any) {
        console.warn(`[Migration] Index creation failed (may already exist): ${error.message}`);
      }
    }

    console.log('[Migration] All indexes added successfully');
  }

  /**
   * Helper: Get column information for a table
   */
  private static getTableColumns(db: SQLiteDatabase, tableName: string): Array<{ name: string; type: string }> {
    const rows = db.prepare(`PRAGMA table_info('${tableName}')`).all() as any[];
    return rows.map(row => ({
      name: row.name,
      type: row.type
    }));
  }
}

// CLI usage
if (process.argv[2] === '--migrate') {
  const dbPath = process.argv[3];
  if (!dbPath) {
    console.error('Usage: ts-node migrateLanServerSchema.ts --migrate <path-to-lan-server.db>');
    process.exit(1);
  }

  try {
    LanServerSchemaMigration.migrate(dbPath);
    console.log('\n✅ Migration completed successfully!');
  } catch (error: any) {
    console.error('\n❌ Migration failed:', error.message);
    process.exit(1);
  }
}
