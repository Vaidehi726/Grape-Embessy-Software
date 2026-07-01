// Offline Data Service - Local-first data access
// Works with SQLite only (no cloud sync)

import { isElectron } from './printerBridge';

// ── Types ────────────────────────────────────────────────────────────────

interface ElectronDbAPI {
  query: (table: string, filters?: Record<string, any>) => Promise<{ success: boolean; data?: any[]; error?: string }>;
  upsert: (table: string, data: Record<string, any>) => Promise<{ success: boolean; error?: string }>;
  upsertBatch?: (table: string, records: Record<string, any>[]) => Promise<{ success: boolean; count?: number; error?: string }>;
  delete: (table: string, id: string) => Promise<{ success: boolean; error?: string }>;
  deleteBatch?: (table: string, ids: string[]) => Promise<{ success: boolean; count?: number; error?: string }>;
  clearTable: (table: string) => Promise<{ success: boolean; error?: string }>;
}

// ── Electron DB access ──────────────────────────────────────────────────

function getElectronDb(): ElectronDbAPI | null {
  return (window as any).electronAPI?.db ?? null;
}

/**
 * True when this machine is configured as a LAN *client* (a "slave" billing/
 * kitchen station that owns no data of its own). In that case we must NEVER
 * silently fall back to the local SQLite database: doing so would let a
 * disconnected client write bills into its own private DB that never reach the
 * server. Instead we surface an error so the UI can tell the user to reconnect.
 */
function isLanClientMode(): boolean {
  try {
    return localStorage.getItem('lan_mode') === 'client';
  } catch {
    return false;
  }
}

/** Returns true if the LAN client websocket/HTTP link is currently up. */
async function isLanConnected(): Promise<boolean> {
  const lan = (window as any).electronAPI?.lan;
  if (!lan) return false;
  try {
    const status = await lan.clientStatus();
    return !!status?.connected;
  } catch {
    return false;
  }
}

// ── Core query: Use SQLite in Electron, LAN if connected ─────────────

/**
 * Execute a data query with local-first architecture.
 * In LAN mode: Reads from LAN server SQLite
 * In Electron local mode: Reads from local SQLite
 */
export async function localQuery<T = any>(
  table: string,
  filters?: Record<string, any>
): Promise<{ data: T[] | null; error: any }> {
  // Check if we're in LAN mode first
  const lan = (window as any).electronAPI?.lan;
  if (lan) {
    try {
      const status = await lan.clientStatus();
      if (status.connected) {
        // LAN mode: Query from LAN server
        console.log(`[LocalData] LAN mode - Querying ${table} from LAN server`);
        const result = await lan.query(table, filters);
        if (result.success) {
          return { data: result.data as any, error: null };
        } else {
          return { data: null, error: { message: result.error } };
        }
      }
    } catch (err) {
      console.warn('[LocalData] LAN status check error:', err);
    }
  }

  // Configured as a LAN client but the link is down → do NOT read the empty/stale
  // local DB. Fail loudly so the UI shows "reconnecting" instead of wrong data.
  if (isLanClientMode()) {
    return { data: null, error: { message: 'Not connected to the server. Please reconnect to continue.' } };
  }

  // Electron mode (local): Use local SQLite
  const db = getElectronDb();
  if (!db) {
    return { data: null, error: { message: 'SQLite not available' } };
  }

  try {
    const result = await db.query(table, filters);
    if (result.success && result.data) {
      console.log(`[LocalData] Query ${table}:`, result.data.length, 'records');
      return { data: result.data as any, error: null };
    }
    return { data: [], error: null };
  } catch (e: any) {
    console.error('[LocalData] Query error:', e);
    return { data: null, error: { message: e?.message || 'Query failed' } };
  }
}

/**
 * Execute a data mutation with local-first architecture.
 * In LAN mode: Writes to LAN server SQLite (broadcasts to all clients)
 * In Electron local mode: Writes to local SQLite
 */
export async function localMutate<T = any>(
  table: string,
  data: Record<string, any>
): Promise<{ data: T | null; error: any }> {
  // Check if we're in LAN mode first
  const lan = (window as any).electronAPI?.lan;
  if (lan) {
    try {
      const status = await lan.clientStatus();
      if (status.connected) {
        // LAN mode: Write to LAN server
        console.log(`[LocalData] LAN mode - Mutating ${table} on LAN server`);
        
        // Ensure ID and timestamps
        if (!data.id) data.id = crypto.randomUUID();
        const now = new Date().toISOString();
        if (!data.created_at) data.created_at = now;
        data.updated_at = now;
        
        const result = await lan.upsert(table, data);
        if (result.success) {
          return { data: data as any, error: null };
        } else {
          return { data: null, error: { message: result.error } };
        }
      }
    } catch (err) {
      console.warn('[LocalData] LAN status check error:', err);
    }
  }

  // Configured as a LAN client but disconnected → refuse the write rather than
  // saving it to the client's private DB where it would be lost to everyone else.
  if (isLanClientMode()) {
    return { data: null, error: { message: 'Not connected to the server. Your change was not saved — please reconnect and try again.' } };
  }

  // Electron mode (local): Write to local SQLite
  const db = getElectronDb();
  if (!db) {
    return { data: null, error: { message: 'SQLite not available' } };
  }

  try {
    // Ensure ID exists
    if (!data.id) data.id = crypto.randomUUID();
    
    // Set timestamps
    const now = new Date().toISOString();
    if (!data.created_at) data.created_at = now;
    data.updated_at = now;

    // Write to SQLite
    console.log(`[LocalData] Upserting to ${table}:`, data);
    await db.upsert(table, data);
    
    console.log(`[LocalData] Written to ${table}, id:`, data.id);
    return { data: data as any, error: null };
  } catch (e: any) {
    console.error('[LocalData] Local write error:', e);
    return { data: null, error: { message: e?.message || 'Failed to write to local database' } };
  }
}

/**
 * Delete with local support.
 * In LAN mode: Deletes from LAN server SQLite
 * In Electron: Deletes from local SQLite
 */
export async function localDelete(
  table: string,
  id: string
): Promise<{ error: any }> {
  // Check if we're in LAN mode first
  const lan = (window as any).electronAPI?.lan;
  if (lan) {
    try {
      const status = await lan.clientStatus();
      if (status.connected) {
        // LAN mode: Delete from LAN server
        console.log(`[LocalData] LAN mode - Deleting ${table}:${id} from LAN server`);
        const result = await lan.delete(table, id);
        if (result.success) {
          return { error: null };
        } else {
          return { error: { message: result.error } };
        }
      }
    } catch (err) {
      console.warn('[LocalData] LAN status check error:', err);
    }
  }

  // Configured as a LAN client but disconnected → refuse the delete.
  if (isLanClientMode()) {
    return { error: { message: 'Not connected to the server. Please reconnect and try again.' } };
  }

  // Electron mode: Delete from local SQLite
  const db = getElectronDb();
  if (!db) {
    return { error: { message: 'SQLite not available' } };
  }

  try {
    await db.delete(table, id);
    console.log(`[LocalData] Deleted ${table}:${id} from SQLite`);
    return { error: null };
  } catch (e: any) {
    console.error('[LocalData] Local delete error:', e);
    return { error: { message: e?.message || 'Failed to delete from local database' } };
  }
}

/**
 * Clear all local data from SQLite
 */
export async function clearAllLocalData(): Promise<{ success: boolean; message: string }> {
  if (!isElectron()) {
    return { success: false, message: 'Not in Electron mode' };
  }
  const db = getElectronDb();
  if (!db) {
    return { success: false, message: 'SQLite not available' };
  }

  const tables = ['restaurants', 'kitchens', 'floors', 'tables', 'menu_categories', 'menu_items', 'staff_members', 'orders', 'order_items'];
  let cleared = 0;
  
  for (const table of tables) {
    try {
      await db.clearTable(table);
      cleared++;
    } catch (e: any) {
      console.warn(`[Clear] Could not clear ${table}:`, e?.message);
    }
  }
  
  return { success: true, message: `Cleared ${cleared} tables` };
}

/**
 * Debug function: Dump all data from SQLite to console
 */
export async function debugDumpSQLiteData(): Promise<void> {
  if (!isElectron()) {
    console.log('[Debug] Not in Electron mode');
    return;
  }
  const db = getElectronDb();
  if (!db) {
    console.log('[Debug] SQLite not available');
    return;
  }

  const tables = ['restaurants', 'kitchens', 'floors', 'tables', 'menu_categories', 'menu_items', 'staff_members', 'orders', 'order_items'];
  
  console.log('========== SQLITE DATABASE DUMP ==========');
  for (const table of tables) {
    try {
      const result = await db.query(table);
      console.log(`\n[${table}]: ${result.data?.length ?? 0} records`);
      if (result.data && result.data.length > 0) {
        console.log('Sample:', result.data.slice(0, 2));
      }
    } catch (e: any) {
      console.log(`[${table}]: ERROR - ${e?.message}`);
    }
  }
  console.log('========== END DUMP ==========');
}

/**
 * A drop-in replacement for `window.electronAPI.db` that is LAN-aware.
 *
 * Screens used to grab `(window as any).electronAPI?.db` directly, which always
 * hit the *local* SQLite — so on a client station every order/table write went
 * into that machine's private DB and never reached the server. This accessor has
 * the exact same `{ success, data }` method shape but routes reads/writes to the
 * LAN server when this machine is a connected client, and enforces the
 * disconnect guard. Existing call sites only need to swap the one line that
 * obtains `db`.
 */
export interface DataClient {
  query: (table: string, filters?: Record<string, any>) => Promise<{ success: boolean; data?: any[]; error?: string }>;
  upsert: (table: string, data: Record<string, any>) => Promise<{ success: boolean; data?: any; error?: string }>;
  delete: (table: string, id: string) => Promise<{ success: boolean; error?: string }>;
}

export function getDataClient(): DataClient {
  return {
    async query(table, filters) {
      const { data, error } = await localQuery(table, filters);
      return { success: !error, data: data ?? undefined, error: error?.message };
    },
    async upsert(table, data) {
      const result = await localMutate(table, data);
      return { success: !result.error, data: result.data, error: result.error?.message };
    },
    async delete(table, id) {
      const { error } = await localDelete(table, id);
      return { success: !error, error: error?.message };
    },
  };
}

export { isElectron } from './printerBridge';
