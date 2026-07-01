// Type declarations for Electron preload API exposed via contextBridge

interface ElectronPrinterAPI {
  listDevices(): Promise<{ success: boolean; devices?: Array<{ name: string; vendorId: number; productId: number; manufacturer?: string }>; error?: string }>;
  connect(vendorId: number, productId: number): Promise<{ success: boolean; device?: { name: string; vendorId: number; productId: number }; error?: string }>;
  print(receiptData: number[]): Promise<{ success: boolean; error?: string }>;
  disconnect(): Promise<{ success: boolean; error?: string }>;
}

interface ElectronDbAPI {
  query(table: string, filters?: Record<string, any>): Promise<{ success: boolean; data?: any[]; error?: string }>;
  upsert(table: string, data: Record<string, any>): Promise<{ success: boolean; error?: string }>;
  getPending(): Promise<{ success: boolean; data?: any[]; error?: string }>;
  delete(table: string, id: string): Promise<{ success: boolean; error?: string }>;
  clearTable(table: string): Promise<{ success: boolean; error?: string }>;
  nextBillNumber(): Promise<{ success: boolean; billNumber?: number; error?: string }>;
}

interface ElectronSyncAPI {
  start(supabaseUrl: string, supabaseKey: string, accessToken: string): Promise<{ success: boolean; error?: string }>;
  stop(): Promise<{ success: boolean; error?: string }>;
  status(): Promise<{ success: boolean; data?: { isOnline: boolean; pendingCount: number }; error?: string }>;
  force(): Promise<{ success: boolean; error?: string }>;
}

interface LanServerConfig {
  dbHost: string;
  dbPort: number;
  dbName: string;
  dbUser: string;
  dbPassword: string;
  apiPort: number;
  wsPort: number;
}

interface LanClientConfig {
  serverHost: string;
  serverPort: number;
  deviceId: string;
  deviceType: 'billing' | 'kitchen' | 'manager';
  deviceName: string;
}

interface ElectronLanAPI {
  // Server mode - Fully automatic, no config needed!
  startServer(): Promise<{ success: boolean; ip?: string; port?: number; error?: string }>;
  stopServer(): Promise<{ success: boolean; error?: string }>;
  
  // Client mode
  connect(config: LanClientConfig): Promise<{ success: boolean; error?: string }>;
  disconnect(): Promise<{ success: boolean; error?: string }>;
  
  // Status
  status(): Promise<{ 
    mode: 'server' | 'client' | 'none'; 
    connected: boolean; 
    serverRunning: boolean;
    serverIp?: string;
    port?: number;
    clientsConnected?: number;
    dbStatus?: 'stopped' | 'starting' | 'ready' | 'error';
  }>;
  clientStatus(): Promise<{ connected: boolean; wsReadyState: number; error?: string }>;
  
  // Data operations
  query(table: string, filters?: Record<string, any>): Promise<{ success: boolean; data?: any[]; error?: string }>;
  upsert(table: string, data: Record<string, any>): Promise<{ success: boolean; data?: any; error?: string }>;
  delete(table: string, id: string): Promise<{ success: boolean; error?: string }>;
  getKitchenOrders(kitchenId?: string, status?: string): Promise<{ success: boolean; data?: any[]; error?: string }>;
  updateOrderItemStatus(itemId: string, status: string): Promise<{ success: boolean; data?: any; error?: string }>;
  nextBillNumber(): Promise<{ success: boolean; billNumber?: number; error?: string }>;
  syncAllFromServer(restaurantId?: string): Promise<{ success: boolean; data?: Record<string, any[]>; error?: string }>;
  
  // Event listeners
  onConnected(callback: () => void): () => void;
  onDisconnected(callback: () => void): () => void;
  onRecordChanged(callback: (event: any, data: { table: string; record: any; action: 'created' | 'updated' | 'deleted' }) => void): () => void;
  onOrderStatusChanged(callback: (event: any, item: any) => void): () => void;
}

interface ElectronAPI {
  printer: ElectronPrinterAPI;
  db: ElectronDbAPI;
  sync: ElectronSyncAPI;
  lan: ElectronLanAPI;
  app: {
    resetAllData(): Promise<{ success: boolean; message: string }>;
  };
  isElectron: true;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

export {};
