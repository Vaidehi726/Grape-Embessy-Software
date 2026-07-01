// Compatibility wrapper - maps old offlineDataService API to new localDataService
// This allows gradual migration without breaking all imports

import { localQuery, localMutate, localDelete, isElectron } from './localDataService';

// Re-export isElectron
export { isElectron };

// Connectivity functions (simplified - always online for local mode)
export function isOffline(): boolean {
  return false;
}

export function isOnline(): boolean {
  return true;
}

export function onConnectivityChange(fn: (online: boolean) => void): () => void {
  // Immediately call with true
  fn(true);
  // Return noop unsubscribe
  return () => {};
}

// Map old function names to new ones
export async function offlineQuery<T = any>(
  supabaseFn: () => Promise<{ data: T | null; error: any }>,
  cacheConfig: { table: string; filters?: Record<string, any> },
  options?: { forceRefresh?: boolean }
): Promise<{ data: T | null; error: any; fromCache: boolean }> {
  // Ignore supabaseFn, just query local database
  const result = await localQuery(cacheConfig.table, cacheConfig.filters);
  return {
    data: result.data as any,
    error: result.error,
    fromCache: true
  };
}

export async function offlineMutate<T = any>(
  table: string,
  data: Record<string, any>,
  supabaseFn?: () => Promise<{ data: T | null; error: any }>
): Promise<{ data: T | null; error: any; pendingSync: boolean }> {
  const result = await localMutate(table, data);
  return {
    data: result.data,
    error: result.error,
    pendingSync: false // No sync in local-only mode
  };
}

export async function offlineDelete(
  table: string,
  id: string,
  supabaseFn?: () => Promise<{ error: any }>
): Promise<{ error: any }> {
  return await localDelete(table, id);
}

// Sync functions - no-op in local-only mode
export async function initializeSync(accessToken: string): Promise<void> {
  // No sync needed
  return;
}

export async function stopSync(): Promise<void> {
  // No sync to stop
  return;
}

export async function forceSyncPush(): Promise<void> {
  // No sync needed
  return;
}

export async function manualSyncToCloud(): Promise<{
  success: boolean;
  uploaded: number;
  deleted: number;
  errors: string[];
}> {
  return { success: true, uploaded: 0, deleted: 0, errors: [] };
}

export async function cleanupOrphanedRecords(): Promise<{ success: boolean; deleted: number; message: string }> {
  return { success: true, deleted: 0, message: 'No cleanup needed in local mode' };
}

export async function clearAllCachedData(): Promise<{ success: boolean; message: string }> {
  const { clearAllLocalData } = await import('./localDataService');
  const result = await clearAllLocalData();
  return {
    success: result.success,
    message: result.message
  };
}

export async function getPendingSyncCount(): Promise<number> {
  return 0; // No pending syncs in local mode
}

export async function downloadAllDataFromCloud(restaurantId?: string): Promise<{
  success: boolean;
  downloaded: number;
  errors: string[];
}> {
  return { success: true, downloaded: 0, errors: [] };
}

export async function clearAllLocalData(): Promise<{ success: boolean; message: string }> {
  const { clearAllLocalData: clearData } = await import('./localDataService');
  return await clearData();
}

export async function debugDumpSQLiteData(): Promise<void> {
  const { debugDumpSQLiteData: debugDump } = await import('./localDataService');
  return await debugDump();
}

export async function pushToLanServer(): Promise<{ success: boolean; count: number }> {
  return { success: true, count: 0 };
}

// Export supabase as null for backwards compatibility
export const supabase = null;
