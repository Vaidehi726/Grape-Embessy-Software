import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { NativePrinterService } from './services/nativePrinter.js';
import { LocalDatabase } from './services/localDb.js';
import { SyncEngine } from './services/syncEngine.js';
import { LanClient, LanClientConfig, createLanClient, destroyLanClient, getLanClient } from './services/lanClient.js';
import { SqliteLanServer, createSqliteLanServer } from './services/sqliteLanServer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Keep the data folder stable across the rebrand. Electron derives userData
// from productName ("Grape Embassy"), which would point at a NEW empty folder
// and orphan the existing database. Pin it to the original "RestroFlow" folder
// so all existing data (restroflow.db) keeps working after rebranding.
try {
  app.setPath('userData', path.join(app.getPath('appData'), 'RestroFlow'));
} catch (err) {
  console.error('[Main] Failed to pin userData path:', err);
}

let mainWindow: BrowserWindow | null = null;
const printerService = new NativePrinterService();
let localDb: LocalDatabase | null = null;
let syncEngine: SyncEngine | null = null;
let autoLanServer: SqliteLanServer | null = null;
let lanMode: 'server' | 'client' | 'none' = 'none';

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 600,
    title: 'Grape Embassy',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // In dev, load from Vite dev server; in prod, load built files
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    // DevTools should NOT be open in production - it intercepts keyboard shortcuts like Ctrl+K
    // To debug in production, use: mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Prevent the web page's <title> from overriding the window title
  mainWindow.on('page-title-updated', (evt) => {
    evt.preventDefault();
  });
}

// ── Printer IPC Handlers ──────────────────────────────────────────
function registerPrinterHandlers() {
  ipcMain.handle('printer:list-devices', async () => {
    try {
      return { success: true, devices: await printerService.listDevices() };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('printer:connect', async (_event, vendorId: number, productId: number) => {
    try {
      const device = await printerService.connect(vendorId, productId);
      return { success: true, device };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('printer:print', async (_event, receiptData: number[]) => {
    try {
      await printerService.printRaw(new Uint8Array(receiptData));
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('printer:disconnect', async () => {
    try {
      await printerService.disconnect();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // List Windows printers (for selecting specific printer when multiple match)
  ipcMain.handle('printer:list-windows-printers', async () => {
    try {
      const psCmd = `Get-Printer | Where-Object { $_.PortName -match 'USB' } | Select-Object -ExpandProperty Name | ConvertTo-Json`;
      const output = execSync(
        `powershell -NoProfile -Command "${psCmd}"`,
        { encoding: 'utf-8', timeout: 10000 }
      );
      const printers = JSON.parse(output.trim());
      const printerList = Array.isArray(printers) ? printers : [printers];
      return { success: true, printers: printerList.filter((p: string) => p && p.trim()) };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Switch to a different Windows printer (same USB device)
  ipcMain.handle('printer:switch-windows-printer', async (_event, printerName: string) => {
    try {
      printerService.switchWindowsPrinter(printerName);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Alias for connectWindowsPrinter (used by printerBridge)
  ipcMain.handle('printer:connect-windows-printer', async (_event, printerName: string) => {
    try {
      printerService.switchWindowsPrinter(printerName);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Print to a specific Windows printer
  ipcMain.handle('printer:print-windows-printer', async (_event, receiptData: number[], printerName: string) => {
    try {
      // Switch to the specified printer
      printerService.switchWindowsPrinter(printerName);
      // Print the receipt
      await printerService.printRaw(new Uint8Array(receiptData));
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // List Windows printers matching specific VID/PID (for choosing between printers on same port)
  ipcMain.handle('printer:list-by-vidpid', async (_event, vendorId: number, productId: number) => {
    try {
      const printers = printerService.findAllWindowsPrintersByVidPid(vendorId, productId);
      return { success: true, printers };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });
}

// ── Database IPC Handlers ─────────────────────────────────────────
function registerDbHandlers() {
  const userDataPath = app.getPath('userData');
  localDb = new LocalDatabase(userDataPath);

  ipcMain.handle('db:query', async (_event, table: string, filters?: Record<string, any>) => {
    try {
      const rows = localDb!.query(table, filters);
      return { success: true, data: rows };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('db:upsert', async (_event, table: string, data: Record<string, any>) => {
    try {
      localDb!.upsert(table, data);
      // Server-PC UI writes go straight to SQLite here, bypassing the LAN HTTP
      // endpoints that normally broadcast. Push the change to connected clients
      // so bill numbers, table colour/occupancy and payments reflect live.
      autoLanServer?.broadcastLocalChange(table, data);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('db:get-pending', async () => {
    try {
      const pending = localDb!.getPendingSync();
      return { success: true, data: pending };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('db:delete', async (_event, table: string, id: string) => {
    try {
      localDb!.deleteRecord(table, id);
      autoLanServer?.broadcastLocalDelete(table, id);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('db:clear-table', async (_event, table: string) => {
    try {
      localDb!.clearTable(table);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // ── Database maintenance (archive old orders) ───────────────────
  ipcMain.handle('db:archive-preview', async (_event, cutoffIso?: string) => {
    try {
      const { previewArchive, startOfCurrentMonthIso } = await import('./services/dataMaintenance.js');
      const cutoff = cutoffIso || startOfCurrentMonthIso();
      return { success: true, data: previewArchive(app.getPath('userData'), cutoff) };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('db:archive-run', async (_event, cutoffIso?: string) => {
    try {
      const { archiveOldData, startOfCurrentMonthIso } = await import('./services/dataMaintenance.js');
      const cutoff = cutoffIso || startOfCurrentMonthIso();
      // The LAN server holds a second connection to the same file; stop it so the
      // VACUUM can rebuild the database cleanly, then bring it back up.
      const wasRunning = autoLanServer?.getStatus().isRunning ?? false;
      if (wasRunning && autoLanServer) await autoLanServer.stop();

      const result = archiveOldData(app.getPath('userData'), cutoff);

      if (wasRunning) {
        autoLanServer = createSqliteLanServer(app.getPath('userData'));
        await autoLanServer.start();
      }
      return { success: true, data: result };
    } catch (err: any) {
      console.error('[Main] Archive failed:', err);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('db:next-bill-number', async () => {
    try {
      return { success: true, billNumber: localDb!.getNextBillNumber() };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });
}

// ── Sync IPC Handlers ─────────────────────────────────────────────
function registerSyncHandlers() {
  ipcMain.handle('sync:start', async (_event, supabaseUrl: string, supabaseKey: string, accessToken: string) => {
    try {
      if (!syncEngine && localDb) {
        syncEngine = new SyncEngine(localDb, supabaseUrl, supabaseKey);
      }
      if (syncEngine) {
        await syncEngine.startSync(accessToken);
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('sync:stop', async () => {
    try {
      if (syncEngine) {
        syncEngine.stopSync();
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('sync:status', async () => {
    try {
      const isOnline = syncEngine?.isOnline() ?? true;
      const pendingCount = localDb?.getPendingSync().length ?? 0;
      return { success: true, data: { isOnline, pendingCount } };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('sync:force', async () => {
    try {
      if (syncEngine) {
        await syncEngine.forcePush();
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });
}

// ── LAN IPC Handlers ──────────────────────────────────────────────
function registerLanHandlers() {
  // Start Auto LAN Server (for the server PC) - No config needed!
  ipcMain.handle('lan:server:start', async () => {
    try {
      console.log('[Main] Starting LAN server...');
      
      if (autoLanServer) {
        console.log('[Main] Stopping existing server...');
        await autoLanServer.stop();
        autoLanServer = null;
      }
      
      console.log('[Main] Creating new server instance...');
      autoLanServer = createSqliteLanServer(app.getPath('userData'));
      
      console.log('[Main] Calling server.start()...');
      const started = await autoLanServer.start();
      
      if (started) {
        console.log('[Main] Server started successfully');
        lanMode = 'server';
        const status = autoLanServer.getStatus();
        return { success: true, ip: status.serverIp, port: status.port };
      } else {
        const status = autoLanServer!.getStatus();
        const errorMsg = status.error || 'Failed to start server (unknown error)';
        console.error('[Main] Server failed to start:', errorMsg);
        return { success: false, error: errorMsg };
      }
    } catch (err: any) {
      console.error('[Main] Exception starting server:', err);
      return { success: false, error: err.message || String(err) };
    }
  });

  // Stop LAN Server
  ipcMain.handle('lan:server:stop', async () => {
    try {
      if (autoLanServer) {
        await autoLanServer.stop();
        autoLanServer = null;
      }
      if (lanMode === 'server') {
        lanMode = 'none';
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Connect to LAN Server (for client PCs)
  ipcMain.handle('lan:client:connect', async (_event, config: LanClientConfig) => {
    try {
      console.log('[Main] LAN client connect attempt:', config);
      destroyLanClient();
      const client = createLanClient(config);
      
      // Set up event handlers that forward to renderer
      client.setOnConnect(() => {
        console.log('[Main] LAN client connected event fired');
        mainWindow?.webContents.send('lan:connected');
      });
      
      client.setOnDisconnect(() => {
        console.log('[Main] LAN client disconnected event fired');
        mainWindow?.webContents.send('lan:disconnected');
      });
      
      client.setOnRecordChange((table, record, action) => {
        mainWindow?.webContents.send('lan:record-changed', { table, record, action });
      });
      
      client.setOnOrderItemStatusChange((item) => {
        mainWindow?.webContents.send('lan:order-status-changed', item);
      });

      console.log('[Main] Attempting client.connect()...');
      const connected = await client.connect();
      console.log('[Main] client.connect() result:', connected);
      
      if (connected) {
        lanMode = 'client';
        console.log('[Main] LAN mode set to client');
      } else {
        console.warn('[Main] Client connection returned false');
      }
      
      return { success: connected, error: connected ? undefined : 'Connection returned false' };
    } catch (err: any) {
      console.error('[Main] LAN client connect exception:', err);
      console.error('[Main] Error details:', err.message, err.stack);
      return { success: false, error: err.message || String(err) };
    }
  });

  // Disconnect from LAN Server
  ipcMain.handle('lan:client:disconnect', async () => {
    try {
      destroyLanClient();
      if (lanMode === 'client') {
        lanMode = 'none';
      }
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  // Check LAN connection status
  ipcMain.handle('lan:status', async () => {
    const client = getLanClient();
    const serverStatus = autoLanServer?.getStatus();
    return {
      mode: lanMode,
      connected: client?.connected ?? false,
      serverRunning: serverStatus?.isRunning ?? false,
      serverIp: serverStatus?.serverIp,
      port: serverStatus?.port,
      clientsConnected: serverStatus?.clientsConnected ?? 0,
      dbStatus: serverStatus?.dbStatus
    };
  });

  // Check LAN client connection status (for data layer routing)
  ipcMain.handle('lan:client-status', async () => {
    const client = getLanClient();
    if (!client) {
      return { connected: false, error: 'LAN client not initialized' };
    }
    const status = client.getConnectionStatus();
    return { connected: status.connected, wsReadyState: status.wsReadyState };
  });

  // LAN Client HTTP API wrappers
  ipcMain.handle('lan:query', async (_event, table: string, filters?: Record<string, any>) => {
    const client = getLanClient();
    if (!client) return { success: false, error: 'LAN client not initialized' };
    return client.query(table, filters);
  });

  ipcMain.handle('lan:upsert', async (_event, table: string, data: Record<string, any>) => {
    const client = getLanClient();
    if (!client) return { success: false, error: 'LAN client not initialized' };
    return client.upsert(table, data);
  });

  ipcMain.handle('lan:delete', async (_event, table: string, id: string) => {
    const client = getLanClient();
    if (!client) return { success: false, error: 'LAN client not initialized' };
    return client.delete(table, id);
  });

  ipcMain.handle('lan:get-kitchen-orders', async (_event, kitchenId?: string, status?: string) => {
    const client = getLanClient();
    if (!client) return { success: false, error: 'LAN client not initialized' };
    return client.getKitchenOrders(kitchenId, status);
  });

  ipcMain.handle('lan:update-order-item-status', async (_event, itemId: string, status: string) => {
    const client = getLanClient();
    if (!client) return { success: false, error: 'LAN client not initialized' };
    return client.updateOrderItemStatus(itemId, status);
  });

  ipcMain.handle('lan:next-bill-number', async () => {
    const client = getLanClient();
    if (!client) return { success: false, error: 'LAN client not initialized' };
    return client.getNextBillNumber();
  });

  // Sync all data from LAN Server (fresh load)
  ipcMain.handle('lan:sync-all-from-server', async (_event, restaurantId: string) => {
    const client = getLanClient();
    if (!client) return { success: false, error: 'LAN client not initialized' };
    return client.syncAllFromServer(restaurantId);
  });
}

// ── App Lifecycle ─────────────────────────────────────────────────

// Single-instance lock: a POS PC should never run two copies (two SQLite
// writers / two LAN servers). Focus the existing window instead.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(() => {
  // Auto-launch the app at Windows/macOS login on installed machines so the
  // POS (and its SQLite LAN server) comes up on boot with no manual step.
  // Only for packaged builds — never hijack the dev machine's startup.
  if (app.isPackaged) {
    try {
      app.setLoginItemSettings({ openAtLogin: true, path: process.execPath });
    } catch (err) {
      console.error('[Main] Failed to set login item:', err);
    }
  }

  // Register IPC handlers defensively: a failure in any one of them (e.g. a
  // SQLite schema error while opening the local DB) must NOT prevent the window
  // from being created. Otherwise the app launches headless — background
  // processes alive, but no visible window — which looks like "nothing happens"
  // when the desktop shortcut is clicked.
  try { registerPrinterHandlers(); } catch (err) { console.error('[Main] registerPrinterHandlers failed:', err); }
  try { registerDbHandlers(); } catch (err) { console.error('[Main] registerDbHandlers failed:', err); }
  try { registerSyncHandlers(); } catch (err) { console.error('[Main] registerSyncHandlers failed:', err); }
  try { registerLanHandlers(); } catch (err) { console.error('[Main] registerLanHandlers failed:', err); }
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', async () => {
  console.log('[Main] Window all closed - shutting down...');
  
  // Stop sync engine
  if (syncEngine) {
    syncEngine.stopSync();
  }
  
  // Stop LAN server (this closes SQLite database)
  if (autoLanServer) {
    try {
      await autoLanServer.stop();
      console.log('[Main] LAN server stopped (SQLite DB closed)');
    } catch (err) {
      console.error('[Main] Error stopping LAN server:', err);
    }
  }
  
  // Destroy LAN client
  destroyLanClient();
  
  // Disconnect printer
  printerService.disconnect().catch(() => {});
  
  // Give SQLite database a moment to close cleanly
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// ── Data Reset IPC Handler ────────────────────────────────────────
ipcMain.handle('app:reset-all-data', async () => {
  try {
    const { resetAllAppData } = await import('./services/dataReset');
    return await resetAllAppData({ confirm: true, silent: false });
  } catch (error: any) {
    console.error('[Main] Reset error:', error);
    return { success: false, message: error.message };
  }
});
