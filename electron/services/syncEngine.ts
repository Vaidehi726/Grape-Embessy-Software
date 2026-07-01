// Background Sync Engine for Electron
// Handles initial data load from Supabase to local SQLite
// NOTE: Push sync is now manual-only via the renderer process

import { LocalDatabase } from './localDb.js';

const SYNC_TABLES = ['restaurants', 'kitchens', 'floors', 'tables', 'menu_categories', 'menu_items', 'staff_members', 'orders', 'order_items'];

interface SupabaseClient {
  url: string;
  key: string;
  accessToken: string;
}

export class SyncEngine {
  private db: LocalDatabase;
  private supabaseUrl: string;
  private supabaseKey: string;
  private accessToken: string = '';
  private online: boolean = true;

  constructor(db: LocalDatabase, supabaseUrl: string, supabaseKey: string) {
    this.db = db;
    this.supabaseUrl = supabaseUrl;
    this.supabaseKey = supabaseKey;
  }

  /**
   * Start the sync engine - only pulls data from cloud on initial load
   * Push sync is now manual-only via manualSyncToCloud() in renderer
   */
  async startSync(accessToken: string) {
    this.accessToken = accessToken;
    this.online = await this.checkOnline();

    // Initial pull from cloud to populate SQLite
    if (this.online) {
      console.log('[SyncEngine] Initial data pull from cloud...');
      await this.pullAll();
    }

    // No automatic periodic sync - push is manual-only
    console.log('[SyncEngine] Sync engine started (manual push only)');
  }

  /**
   * Stop the background sync (no-op now since no auto-sync)
   */
  stopSync() {
    // No-op - no automatic sync running
  }

  /**
   * Force push all pending records now - DEPRECATED
   * Use manualSyncToCloud() from renderer process instead
   */
  async forcePush() {
    console.warn('[SyncEngine] forcePush() is deprecated. Use manualSyncToCloud() from renderer.');
    throw new Error('Use manual sync from UI instead');
  }

  isOnline(): boolean {
    return this.online;
  }

  /**
   * Pull all data from Supabase → Local SQLite
   * Called on initial app load when online
   */
  async pullAll() {
    console.log('[SyncEngine] Pulling all data from cloud...');
    for (const table of SYNC_TABLES) {
      try {
        const lastSync = this.db.getLastSyncTime(table);
        let url = `${this.supabaseUrl}/rest/v1/${table}?select=*`;

        if (lastSync) {
          url += `&updated_at=gte.${lastSync}`;
        }

        url += '&order=updated_at.asc&limit=1000';

        const response = await fetch(url, {
          headers: {
            'apikey': this.supabaseKey,
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          console.error(`[SyncEngine] Pull failed for ${table}: ${response.status}`);
          continue;
        }

        const records = await response.json();
        if (records.length > 0) {
          this.db.bulkUpsert(table, records);
          console.log(`[SyncEngine] Pulled ${records.length} records for ${table}`);
        }
      } catch (err) {
        console.error(`[SyncEngine] Pull error for ${table}:`, err);
      }
    }
    console.log('[SyncEngine] Initial data pull complete');
  }

  // ── Check internet connectivity ─────────────────────────────────
  private async checkOnline(): Promise<boolean> {
    try {
      const response = await fetch(`${this.supabaseUrl}/rest/v1/`, {
        method: 'HEAD',
        headers: {
          'apikey': this.supabaseKey,
        },
        signal: AbortSignal.timeout(5000),
      });
      return response.ok || response.status === 400;
    } catch {
      return false;
    }
  }
}
