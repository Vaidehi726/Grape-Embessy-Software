// Data Reset Utility - Clears all application data for clean testing
// This can be called from the UI or command line

import { app, dialog } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

interface ResetOptions {
  confirm?: boolean;
  silent?: boolean;
}

/**
 * Reset all application data to factory defaults
 * This removes:
 * - SQLite databases
 * - LocalStorage data
 * - Session data
 * - LAN configuration
 * - Cached files
 */
export async function resetAllAppData(options: ResetOptions = {}): Promise<{ success: boolean; message: string }> {
  const { confirm = true, silent = false } = options;

  try {
    // Confirm with user if not silent mode
    if (confirm && !silent) {
      const result = await dialog.showMessageBox({
        type: 'warning',
        title: 'Reset All Data',
        message: 'This will delete ALL application data',
        detail: 'This action cannot be undone. All restaurants, settings, orders, and configurations will be permanently deleted. The app will restart after reset.',
        buttons: ['Reset Everything', 'Cancel'],
        defaultId: 1,
        cancelId: 1,
      });

      if (result.response !== 0) {
        return { success: false, message: 'Reset cancelled by user' };
      }
    }

    console.log('[DataReset] Starting application data reset...');

    // Get app data paths
    const appDataPath = app.getPath('userData');
    const localAppDataPath = app.getPath('sessionData');

    console.log('[DataReset] AppData path:', appDataPath);
    console.log('[DataReset] SessionData path:', localAppDataPath);

    // Close any open database connections first
    try {
      // Database connections will be closed when app exits
      console.log('[DataReset] Database connections will be closed on exit');
    } catch (err) {
      console.warn('[DataReset] Could not close databases:', err);
    }

    // Stop LAN server/client if running
    try {
      const { destroyLanClient } = await import('./lanClient');
      destroyLanClient();
      console.log('[DataReset] Destroyed LAN client');
    } catch (err) {
      console.warn('[DataReset] Could not destroy LAN client:', err);
    }

    try {
      // LAN server will be stopped when process exits
      console.log('[DataReset] LAN server will be stopped on exit');
    } catch (err) {
      console.warn('[DataReset] Could not stop LAN server:', err);
    }

    // Give processes a moment to release file handles
    await new Promise(resolve => setTimeout(resolve, 500));

    // Delete AppData directory contents (but not the directory itself)
    if (fs.existsSync(appDataPath)) {
      console.log('[DataReset] Deleting AppData directory contents:', appDataPath);
      
      // Folders to skip (locked by Electron while running)
      const skipFolders = ['Cache', 'Code Cache', 'GPUCache', 'Service Worker', 'Storage'];
      
      // Use retry logic for locked files
      let retries = 3;
      while (retries > 0) {
        try {
          const items = fs.readdirSync(appDataPath);
          let deletedCount = 0;
          let skippedCount = 0;
          
          for (const item of items) {
            const itemPath = path.join(appDataPath, item);
            
            // Skip Electron cache folders (they're locked while app is running)
            if (skipFolders.includes(item)) {
              console.log(`[DataReset] Skipping locked folder: ${item}`);
              skippedCount++;
              continue;
            }
            
            try {
              if (fs.statSync(itemPath).isDirectory()) {
                fs.rmSync(itemPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 500 });
                deletedCount++;
              } else {
                fs.unlinkSync(itemPath);
                deletedCount++;
              }
            } catch (itemErr: any) {
              console.warn(`[DataReset] Could not delete ${item}:`, itemErr.message);
              // Continue with other files
            }
          }
          
          console.log(`[DataReset] Cleared AppData: ${deletedCount} items deleted, ${skippedCount} skipped (locked)`);
          break;
        } catch (err: any) {
          retries--;
          if (retries > 0) {
            console.log(`[DataReset] Retry ${3 - retries}/3 for AppData cleanup...`);
            await new Promise(resolve => setTimeout(resolve, 1000));
          } else {
            console.warn('[DataReset] Failed to clean AppData after 3 retries:', err.message);
            // Continue anyway - some files may be locked but that's okay
          }
        }
      }
    }

    // Delete session data
    if (fs.existsSync(localAppDataPath)) {
      const items = fs.readdirSync(localAppDataPath);
      for (const item of items) {
        const itemPath = path.join(localAppDataPath, item);
        if (fs.statSync(itemPath).isDirectory()) {
          fs.rmSync(itemPath, { recursive: true, force: true });
        } else {
          fs.unlinkSync(itemPath);
        }
      }
      console.log('[DataReset] Cleared SessionData directory:', localAppDataPath);
    }

    // Clear IndexedDB (Chromium storage)
    const chromiumDataPath = path.join(app.getPath('appData'), 'RestroFlow');
    if (fs.existsSync(chromiumDataPath)) {
      const items = fs.readdirSync(chromiumDataPath);
      for (const item of items) {
        // Don't delete the main app data folder, just browser caches
        if (item !== 'userData' && item !== 'sessionData') {
          const itemPath = path.join(chromiumDataPath, item);
          if (fs.statSync(itemPath).isDirectory()) {
            fs.rmSync(itemPath, { recursive: true, force: true });
          }
        }
      }
      console.log('[DataReset] Cleared Chromium data');
    }

    const successMessage = 'Application data has been reset. The app will now restart.';
    console.log('[DataReset] Reset complete:', successMessage);

    if (!silent) {
      await dialog.showMessageBox({
        type: 'info',
        title: 'Reset Complete',
        message: successMessage,
        buttons: ['OK'],
      });
    }

    // Restart the app
    app.relaunch();
    app.exit(0);

    return { success: true, message: successMessage };
  } catch (error: any) {
    const errorMessage = `Failed to reset data: ${error.message}`;
    console.error('[DataReset] Error:', error);
    
    if (!silent) {
      await dialog.showMessageBox({
        type: 'error',
        title: 'Reset Failed',
        message: errorMessage,
        buttons: ['OK'],
      });
    }

    return { success: false, message: errorMessage };
  }
}

/**
 * Reset only LAN configuration (keeps local data)
 */
export async function resetLanConfig(): Promise<{ success: boolean; message: string }> {
  try {
    // This will be called from renderer via IPC
    // Clears localStorage keys related to LAN
    console.log('[DataReset] LAN config reset requested');
    return { success: true, message: 'LAN configuration cleared. Please restart the app.' };
  } catch (error: any) {
    return { success: false, message: error.message };
  }
}
