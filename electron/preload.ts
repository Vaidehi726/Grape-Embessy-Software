import { contextBridge, ipcRenderer } from 'electron';

// Expose protected APIs to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // ── Printer ─────────────────────────────────────────────────────
  printer: {
    listDevices: () => ipcRenderer.invoke('printer:list-devices'),
    connect: (vendorId: number, productId: number) =>
      ipcRenderer.invoke('printer:connect', vendorId, productId),
    print: (receiptData: number[]) =>
      ipcRenderer.invoke('printer:print', receiptData),
    disconnect: () => ipcRenderer.invoke('printer:disconnect'),
    // Windows printer support
    listWindowsPrinters: () => ipcRenderer.invoke('printer:list-windows-printers'),
    connectWindowsPrinter: (printerName: string) =>
      ipcRenderer.invoke('printer:connect-windows-printer', printerName),
    printWindowsPrinter: (receiptData: number[], printerName: string) =>
      ipcRenderer.invoke('printer:print-windows-printer', receiptData, printerName),
  },

  // ── Database ────────────────────────────────────────────────────
  db: {
    query: (table: string, filters?: Record<string, any>) =>
      ipcRenderer.invoke('db:query', table, filters),
    upsert: (table: string, data: Record<string, any>) =>
      ipcRenderer.invoke('db:upsert', table, data),
    getPending: () => ipcRenderer.invoke('db:get-pending'),
    delete: (table: string, id: string) =>
      ipcRenderer.invoke('db:delete', table, id),
    clearTable: (table: string) =>
      ipcRenderer.invoke('db:clear-table', table),
    nextBillNumber: () => ipcRenderer.invoke('db:next-bill-number'),
  },

  // ── Sync ────────────────────────────────────────────────────────
  sync: {
    start: (supabaseUrl: string, supabaseKey: string, accessToken: string) =>
      ipcRenderer.invoke('sync:start', supabaseUrl, supabaseKey, accessToken),
    stop: () => ipcRenderer.invoke('sync:stop'),
    status: () => ipcRenderer.invoke('sync:status'),
    force: () => ipcRenderer.invoke('sync:force'),
  },

  // ── LAN (Local Area Network) ────────────────────────────────────
  lan: {
    // Server mode (for the main server PC) - No config needed, fully automatic!
    startServer: () => ipcRenderer.invoke('lan:server:start'),
    stopServer: () => ipcRenderer.invoke('lan:server:stop'),
    
    // Client mode (for billing/kitchen PCs)
    connect: (config: any) => ipcRenderer.invoke('lan:client:connect', config),
    disconnect: () => ipcRenderer.invoke('lan:client:disconnect'),
    
    // Status
    status: () => ipcRenderer.invoke('lan:status'),
    clientStatus: () => ipcRenderer.invoke('lan:client-status'),
    
    // Data operations (LAN mode)
    query: (table: string, filters?: Record<string, any>) =>
      ipcRenderer.invoke('lan:query', table, filters),
    upsert: (table: string, data: Record<string, any>) =>
      ipcRenderer.invoke('lan:upsert', table, data),
    delete: (table: string, id: string) =>
      ipcRenderer.invoke('lan:delete', table, id),
    getKitchenOrders: (kitchenId?: string, status?: string) =>
      ipcRenderer.invoke('lan:get-kitchen-orders', kitchenId, status),
    updateOrderItemStatus: (itemId: string, status: string) =>
      ipcRenderer.invoke('lan:update-order-item-status', itemId, status),
    nextBillNumber: () => ipcRenderer.invoke('lan:next-bill-number'),

    // Event listeners
    onConnected: (callback: () => void) => {
      ipcRenderer.on('lan:connected', callback);
      return () => ipcRenderer.removeListener('lan:connected', callback);
    },
    onDisconnected: (callback: () => void) => {
      ipcRenderer.on('lan:disconnected', callback);
      return () => ipcRenderer.removeListener('lan:disconnected', callback);
    },
    onRecordChanged: (callback: (event: any, data: any) => void) => {
      ipcRenderer.on('lan:record-changed', callback);
      return () => ipcRenderer.removeListener('lan:record-changed', callback);
    },
    onOrderStatusChanged: (callback: (event: any, item: any) => void) => {
      ipcRenderer.on('lan:order-status-changed', callback);
      return () => ipcRenderer.removeListener('lan:order-status-changed', callback);
    },
  },

  // ── Environment ─────────────────────────────────────────────────
  isElectron: true,
  
  // ── App Management ──────────────────────────────────────────────
  app: {
    resetAllData: () => ipcRenderer.invoke('app:reset-all-data'),
  },
});
