const { contextBridge, ipcRenderer } = require('electron');

// Expose protected APIs to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // ── Printer ─────────────────────────────────────────────────────
  printer: {
    listDevices: () => ipcRenderer.invoke('printer:list-devices'),
    connect: (vendorId, productId) =>
      ipcRenderer.invoke('printer:connect', vendorId, productId),
    print: (receiptData) =>
      ipcRenderer.invoke('printer:print', receiptData),
    disconnect: () => ipcRenderer.invoke('printer:disconnect'),
    listWindowsPrinters: () => ipcRenderer.invoke('printer:list-windows-printers'),
    switchWindowsPrinter: (printerName) => ipcRenderer.invoke('printer:switch-windows-printer', printerName),
    listByVidPid: (vendorId, productId) => ipcRenderer.invoke('printer:list-by-vidpid', vendorId, productId),
  },

  // ── Database ────────────────────────────────────────────────────
  db: {
    query: (table, filters) =>
      ipcRenderer.invoke('db:query', table, filters),
    upsert: (table, data) =>
      ipcRenderer.invoke('db:upsert', table, data),
    getPending: () => ipcRenderer.invoke('db:get-pending'),
    delete: (table, id) =>
      ipcRenderer.invoke('db:delete', table, id),
    clearTable: (table) =>
      ipcRenderer.invoke('db:clear-table', table),
  },

  // ── Sync ────────────────────────────────────────────────────────
  sync: {
    start: (supabaseUrl, supabaseKey, accessToken) =>
      ipcRenderer.invoke('sync:start', supabaseUrl, supabaseKey, accessToken),
    stop: () => ipcRenderer.invoke('sync:stop'),
    status: () => ipcRenderer.invoke('sync:status'),
    force: () => ipcRenderer.invoke('sync:force'),
  },

  // ── LAN (Local Area Network) ────────────────────────────────────
  lan: {
    // Server mode - Fully automatic, no config needed!
    startServer: () => ipcRenderer.invoke('lan:server:start'),
    stopServer: () => ipcRenderer.invoke('lan:server:stop'),
    
    // Client mode (for billing/kitchen PCs)
    connect: (config) => ipcRenderer.invoke('lan:client:connect', config),
    disconnect: () => ipcRenderer.invoke('lan:client:disconnect'),
    
    // Status
    status: () => ipcRenderer.invoke('lan:status'),
    
    // Data operations (LAN mode)
    query: (table, filters) =>
      ipcRenderer.invoke('lan:query', table, filters),
    upsert: (table, data) =>
      ipcRenderer.invoke('lan:upsert', table, data),
    delete: (table, id) =>
      ipcRenderer.invoke('lan:delete', table, id),
    getKitchenOrders: (kitchenId, status) =>
      ipcRenderer.invoke('lan:get-kitchen-orders', kitchenId, status),
    updateOrderItemStatus: (itemId, status) =>
      ipcRenderer.invoke('lan:update-order-item-status', itemId, status),
    syncAllFromServer: (restaurantId) =>
      ipcRenderer.invoke('lan:sync-all-from-server', restaurantId),
    
    // Event listeners
    onConnected: (callback) => {
      ipcRenderer.on('lan:connected', callback);
      return () => ipcRenderer.removeListener('lan:connected', callback);
    },
    onDisconnected: (callback) => {
      ipcRenderer.on('lan:disconnected', callback);
      return () => ipcRenderer.removeListener('lan:disconnected', callback);
    },
    onRecordChanged: (callback) => {
      ipcRenderer.on('lan:record-changed', callback);
      return () => ipcRenderer.removeListener('lan:record-changed', callback);
    },
    onOrderStatusChanged: (callback) => {
      ipcRenderer.on('lan:order-status-changed', callback);
      return () => ipcRenderer.removeListener('lan:order-status-changed', callback);
    },
  },

  // ── Environment ─────────────────────────────────────────────────
  isElectron: true,
});
