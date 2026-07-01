// LAN Client Service - Connects Electron apps to LAN Server
// Used by all client PCs (billing stations and kitchen displays)

import { WebSocket } from 'ws';

export interface LanClientConfig {
  serverHost: string;
  serverPort: number;
  deviceId: string;
  deviceType: 'billing' | 'kitchen' | 'manager';
  deviceName: string;
}

export interface LanRecord {
  id: string;
  [key: string]: any;
}

export type RecordChangeHandler = (table: string, record: LanRecord, action: 'created' | 'updated' | 'deleted') => void;
export type OrderItemStatusHandler = (item: any) => void;

export class LanClient {
  private ws: WebSocket | null = null;
  private config: LanClientConfig;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingInterval: NodeJS.Timeout | null = null;
  private isConnected = false;
  private messageQueue: any[] = [];
  
  // Event handlers
  private onRecordChange: RecordChangeHandler | null = null;
  private onOrderItemStatusChange: OrderItemStatusHandler | null = null;
  private onConnect: (() => void) | null = null;
  private onDisconnect: (() => void) | null = null;

  constructor(config: LanClientConfig) {
    this.config = config;
  }

  // Event setters
  setOnRecordChange(handler: RecordChangeHandler) {
    this.onRecordChange = handler;
  }

  setOnOrderItemStatusChange(handler: OrderItemStatusHandler) {
    this.onOrderItemStatusChange = handler;
  }

  setOnConnect(handler: () => void) {
    this.onConnect = handler;
  }

  setOnDisconnect(handler: () => void) {
    this.onDisconnect = handler;
  }

  get baseUrl(): string {
    return `http://${this.config.serverHost}:${this.config.serverPort}`;
  }

  get wsUrl(): string {
    return `ws://${this.config.serverHost}:${this.config.serverPort}`;
  }

  async connect(): Promise<boolean> {
    if (this.isConnected) return true;

    try {
      console.log('[LAN Client] Attempting to connect to:', this.baseUrl);
      
      // First check if server is reachable via HTTP
      console.log('[LAN Client] Checking health at:', `${this.baseUrl}/health`);
      const healthCheck = await fetch(`${this.baseUrl}/health`);
      console.log('[LAN Client] Health check response:', healthCheck.status, healthCheck.statusText);
      
      if (!healthCheck.ok) {
        throw new Error(`Server not reachable (HTTP ${healthCheck.status}: ${healthCheck.statusText})`);
      }

      const healthData = await healthCheck.json();
      console.log('[LAN Client] Health check data:', healthData);

      // Connect WebSocket
      console.log('[LAN Client] Connecting WebSocket to:', this.wsUrl);
      this.ws = new WebSocket(this.wsUrl);

      return new Promise((resolve, reject) => {
        if (!this.ws) {
          reject(new Error('WebSocket not initialized'));
          return;
        }

        this.ws.on('open', () => {
          console.log('[LAN Client] WebSocket connected');
          this.isConnected = true;
          
          // Register device
          this.send({
            type: 'register',
            deviceId: this.config.deviceId,
            deviceType: this.config.deviceType,
            deviceName: this.config.deviceName
          });

          // Start ping interval
          this.pingInterval = setInterval(() => {
            this.send({ type: 'ping' });
          }, 30000);

          // Flush queued messages
          while (this.messageQueue.length > 0) {
            const msg = this.messageQueue.shift();
            this.send(msg);
          }

          this.onConnect?.();
          resolve(true);
        });

        this.ws.on('message', (data) => {
          try {
            const message = JSON.parse(data.toString());
            this.handleMessage(message);
          } catch (err) {
            console.error('[LAN Client] Message parse error:', err);
          }
        });

        this.ws.on('close', () => {
          console.log('[LAN Client] WebSocket disconnected');
          this.handleDisconnect();
        });

        this.ws.on('error', (err) => {
          console.error('[LAN Client] WebSocket error:', err);
          reject(err);
        });
      });
    } catch (err) {
      console.error('[LAN Client] Connection failed:', err);
      this.scheduleReconnect();
      return false;
    }
  }

  private handleMessage(message: any) {
    // NOTE: these names/fields must stay in lockstep with the broadcasts emitted
    // by SqliteLanServer.broadcast(). They previously diverged ('record_changed'
    // vs 'record-changed', message.record vs message.data), which silently
    // disabled all real-time updates on clients.
    switch (message.type) {
      case 'registered':
        console.log('[LAN Client] Registered with server');
        break;
      case 'pong':
        // Ping response received
        break;
      case 'record-changed':
        this.onRecordChange?.(message.table, message.data, 'updated');
        break;
      case 'record-deleted':
        this.onRecordChange?.(message.table, { id: message.id }, 'deleted');
        break;
      case 'batch-upsert':
      case 'batch-delete':
        // No per-record payload for batches — signal a table-level refresh.
        this.onRecordChange?.(message.table, null as any, 'updated');
        break;
      case 'order-status-changed':
        this.onOrderItemStatusChange?.({ id: message.itemId, status: message.status });
        break;
    }
  }

  private handleDisconnect() {
    this.isConnected = false;
    
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    this.onDisconnect?.();
    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return;
    
    console.log('[LAN Client] Scheduling reconnect in 5s...');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 5000);
  }

  private send(message: any) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    } else {
      this.messageQueue.push(message);
    }
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.isConnected = false;
  }

  // HTTP API Methods

  async query(table: string, filters?: Record<string, any>): Promise<{ success: boolean; data?: any[]; error?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/query/${table}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filters: filters || {} })
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      return { success: result.success, data: result.data, error: result.error };
    } catch (err: any) {
      console.error(`[LAN Client] query error:`, err);
      return { success: false, error: err.message };
    }
  }

  async upsert(table: string, data: Record<string, any>): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/upsert/${table}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      return { success: result.success, data: result, error: result.error };
    } catch (err: any) {
      console.error(`[LAN Client] upsert error:`, err);
      return { success: false, error: err.message };
    }
  }

  async delete(table: string, id: string): Promise<{ success: boolean; error?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/delete/${table}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      return { success: result.success, error: result.error };
    } catch (err: any) {
      console.error(`[LAN Client] delete error:`, err);
      return { success: false, error: err.message };
    }
  }

  // Batch upsert - much faster for multiple records
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

  // Batch delete - faster for multiple deletions
  async deleteBatch(table: string, ids: string[]): Promise<{ success: boolean; count?: number; error?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/delete-batch/${table}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      return { success: result.success, count: result.count, error: result.error };
    } catch (err: any) {
      console.error(`[LAN Client] deleteBatch error:`, err);
      return { success: false, error: err.message };
    }
  }

  /**
   * Fetch ALL data from LAN Server (fresh load, no local cache)
   * Two-phase sync:
   * Phase 1: Fetch all restaurants (no filter)
   * Phase 2: Fetch restaurant-specific data (floors, tables, menus, etc.)
   */
  async syncAllFromServer(restaurantId?: string): Promise<{ success: boolean; data?: Record<string, any[]>; error?: string }> {
    try {
      console.log('[LAN Client] ========== Sync All Data from Server ==========');
      console.log('[LAN Client] Restaurant ID:', restaurantId || 'Fetching all restaurants first');
      
      const allData: Record<string, any[]> = {};
      let totalRecords = 0;
      
      // Phase 1: Fetch ALL restaurants (no filter - multi-tenant)
      console.log('[LAN Client] Phase 1: Fetching all restaurants...');
      const restaurantsResult = await this.query('restaurants', {});
      
      if (restaurantsResult.success && restaurantsResult.data) {
        allData['restaurants'] = restaurantsResult.data;
        const count = restaurantsResult.data.length;
        totalRecords += count;
        console.log(`[LAN Client] ✓ Fetched ${count} restaurant(s) from server`);
        
        if (count === 0) {
          console.warn('[LAN Client] No restaurants found on server');
          return { success: true, data: allData };
        }
        
        // If no restaurantId provided, use the first one
        const selectedRestaurantId = restaurantId || restaurantsResult.data[0].id;
        console.log('[LAN Client] Using restaurant ID:', selectedRestaurantId);
        
        // Phase 2: Fetch restaurant-specific data
        const restaurantTables = [
          'menu_categories',
          'menu_items',
          'floors',
          'kitchens',
          'staff_members',
          'orders',
          'order_items'
        ];
        
        for (const table of restaurantTables) {
          try {
            console.log(`[LAN Client] Phase 2: Fetching ${table}...`);
            const result = await this.query(table, { restaurant_id: selectedRestaurantId });
            
            if (result.success && result.data) {
              allData[table] = result.data;
              const tableCount = result.data.length;
              totalRecords += tableCount;
              console.log(`[LAN Client] ✓ Fetched ${tableCount} records from ${table}`);
            } else {
              allData[table] = [];
              console.warn(`[LAN Client] ✗ No data for ${table}:`, result.error);
            }
          } catch (err: any) {
            console.error(`[LAN Client] ✗ Failed to fetch ${table}:`, err.message);
            allData[table] = [];
          }
        }
        
        // Phase 3: Fetch tables (filtered by floor_ids, not restaurant_id)
        console.log('[LAN Client] Phase 3: Fetching tables...');
        if (allData['floors'] && allData['floors'].length > 0) {
          const floorIds = allData['floors'].map((f: any) => f.id);
          console.log('[LAN Client] Fetching tables for floor IDs:', floorIds);
          
          // Fetch all tables and filter client-side
          const tablesResult = await this.query('tables', {});
          if (tablesResult.success && tablesResult.data) {
            const filteredTables = tablesResult.data.filter((t: any) => floorIds.includes(t.floor_id));
            allData['tables'] = filteredTables;
            totalRecords += filteredTables.length;
            console.log(`[LAN Client] ✓ Fetched ${filteredTables.length} tables (filtered from ${tablesResult.data.length} total)`);
          } else {
            allData['tables'] = [];
            console.warn('[LAN Client] ✗ No tables data:', tablesResult.error);
          }
        } else {
          allData['tables'] = [];
          console.warn('[LAN Client] No floors found, skipping tables');
        }
      } else {
        console.error('[LAN Client] ✗ Failed to fetch restaurants:', restaurantsResult.error);
        allData['restaurants'] = [];
      }

      console.log('[LAN Client] ========== Sync Complete ==========');
      console.log(`[LAN Client] Total records fetched: ${totalRecords}`);
      console.log('[LAN Client] Data is ready for use (no local caching)');
      
      return { success: true, data: allData };
    } catch (error: any) {
      console.error('[LAN Client] Sync all data failed:', error);
      return { success: false, error: error.message };
    }
  }

  // Kitchen-specific methods
  async getKitchenOrders(kitchenId?: string, status?: string): Promise<{ success: boolean; data?: any[]; error?: string }> {
    try {
      const kitchenIdParam = kitchenId || 'all';
      const params = new URLSearchParams();
      if (status) params.append('status', status);

      const url = `${this.baseUrl}/kitchen-orders/${kitchenIdParam}${params.toString() ? '?' + params.toString() : ''}`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      return { success: result.success, data: result.data, error: result.error };
    } catch (err: any) {
      console.error(`[LAN Client] getKitchenOrders error:`, err);
      return { success: false, error: err.message };
    }
  }

  async updateOrderItemStatus(itemId: string, status: string): Promise<{ success: boolean; data?: any; error?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/update-order-item-status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, status })
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      return { success: result.success, data: result.data, error: result.error };
    } catch (err: any) {
      console.error(`[LAN Client] updateOrderItemStatus error:`, err);
      return { success: false, error: err.message };
    }
  }

  // Reserve the next daily bill number from the server (shared sequence)
  async getNextBillNumber(): Promise<{ success: boolean; billNumber?: number; error?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/next-bill-number`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}'
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      return { success: result.success, billNumber: result.billNumber, error: result.error };
    } catch (err: any) {
      console.error(`[LAN Client] getNextBillNumber error:`, err);
      return { success: false, error: err.message };
    }
  }

  // Health check
  async checkHealth(): Promise<{ connected: boolean; clients?: number; error?: string }> {
    try {
      const response = await fetch(`${this.baseUrl}/health`);
      if (!response.ok) {
        return { connected: false, error: 'Server returned error' };
      }
      const data = await response.json();
      return { connected: true, clients: data.clients };
    } catch (err: any) {
      return { connected: false, error: err.message };
    }
  }

  get connected(): boolean {
    return this.isConnected;
  }

  // Get current connection status (for status checks)
  getConnectionStatus(): { connected: boolean; wsReadyState: number } {
    return {
      connected: this.isConnected,
      wsReadyState: this.ws?.readyState ?? WebSocket.CLOSED
    };
  }
}

// Singleton instance
let lanClientInstance: LanClient | null = null;

export function getLanClient(): LanClient | null {
  return lanClientInstance;
}

export function createLanClient(config: LanClientConfig): LanClient {
  lanClientInstance = new LanClient(config);
  return lanClientInstance;
}

export function destroyLanClient() {
  if (lanClientInstance) {
    lanClientInstance.disconnect();
    lanClientInstance = null;
  }
}
