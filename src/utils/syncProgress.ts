// Sync Progress Reporter
// Provides real-time progress updates during data synchronization

export interface SyncProgress {
  phase: 'downloading' | 'uploading' | 'completed' | 'error';
  table: string;
  currentRecord: number;
  totalRecords: number;
  recordsProcessed: number;
  recordsSuccessful: number;
  recordsFailed: number;
  bytesTransferred: number;
  startTime: number;
  estimatedTimeRemaining: number;
  message: string;
}

export type SyncProgressCallback = (progress: SyncProgress) => void;

export class SyncProgressReporter {
  private callbacks: SyncProgressCallback[] = [];
  private currentProgress: SyncProgress | null = null;
  private tableProgress: Map<string, { current: number; total: number; success: number; failed: number }> = new Map();

  /**
   * Register a callback for progress updates
   */
  onProgress(callback: SyncProgressCallback): () => void {
    this.callbacks.push(callback);
    return () => {
      this.callbacks = this.callbacks.filter(cb => cb !== callback);
    };
  }

  /**
   * Initialize sync session
   */
  startSync(): void {
    this.tableProgress.clear();
    this.currentProgress = {
      phase: 'downloading',
      table: '',
      currentRecord: 0,
      totalRecords: 0,
      recordsProcessed: 0,
      recordsSuccessful: 0,
      recordsFailed: 0,
      bytesTransferred: 0,
      startTime: Date.now(),
      estimatedTimeRemaining: 0,
      message: 'Starting sync...',
    };
    this.notify();
  }

  /**
   * Start processing a table
   */
  startTable(table: string, totalRecords: number, phase: 'downloading' | 'uploading' = 'downloading'): void {
    if (!this.currentProgress) return;

    this.currentProgress.phase = phase;
    this.currentProgress.table = table;
    this.currentProgress.totalRecords = totalRecords;
    this.currentProgress.currentRecord = 0;
    this.currentProgress.message = `${phase === 'downloading' ? 'Downloading' : 'Uploading'} ${table}...`;

    this.tableProgress.set(table, { current: 0, total: totalRecords, success: 0, failed: 0 });
    this.notify();
  }

  /**
   * Update progress for current table
   */
  updateProgress(recordsProcessed: number, success: boolean = true): void {
    if (!this.currentProgress) return;

    const tableStats = this.tableProgress.get(this.currentProgress.table);
    if (tableStats) {
      tableStats.current += recordsProcessed;
      if (success) {
        tableStats.success += recordsProcessed;
        this.currentProgress.recordsSuccessful += recordsProcessed;
      } else {
        tableStats.failed += recordsProcessed;
        this.currentProgress.recordsFailed += recordsProcessed;
      }
    }

    this.currentProgress.currentRecord += recordsProcessed;
    this.currentProgress.recordsProcessed += recordsProcessed;
    this.currentProgress.estimatedTimeRemaining = this.calculateETA();
    this.notify();
  }

  /**
   * Track bytes transferred
   */
  addBytes(bytes: number): void {
    if (!this.currentProgress) return;
    this.currentProgress.bytesTransferred += bytes;
    this.notify();
  }

  /**
   * Complete table processing
   */
  completeTable(table: string): void {
    if (!this.currentProgress) return;

    const tableStats = this.tableProgress.get(table);
    if (tableStats) {
      console.log(`[Sync] ${table}: ${tableStats.success} success, ${tableStats.failed} failed`);
    }
  }

  /**
   * Mark sync as completed
   */
  completeSync(): void {
    if (!this.currentProgress) return;

    const elapsed = Date.now() - this.currentProgress.startTime;
    this.currentProgress.phase = 'completed';
    this.currentProgress.message = `Sync completed in ${this.formatTime(elapsed)}`;
    this.notify();
  }

  /**
   * Mark sync as failed
   */
  failSync(error: string): void {
    if (!this.currentProgress) return;

    this.currentProgress.phase = 'error';
    this.currentProgress.message = `Sync failed: ${error}`;
    this.notify();
  }

  /**
   * Get current progress
   */
  getProgress(): SyncProgress | null {
    return this.currentProgress;
  }

  /**
   * Get summary statistics
   */
  getSummary(): { totalTables: number; totalRecords: number; successRate: number; elapsed: number } | null {
    if (!this.currentProgress) return null;

    const elapsed = Date.now() - this.currentProgress.startTime;
    const totalProcessed = this.currentProgress.recordsSuccessful + this.currentProgress.recordsFailed;
    const successRate = totalProcessed > 0 ? (this.currentProgress.recordsSuccessful / totalProcessed) * 100 : 0;

    return {
      totalTables: this.tableProgress.size,
      totalRecords: totalProcessed,
      successRate,
      elapsed,
    };
  }

  // ── Private Methods ──────────────────────────────────────────────────

  /**
   * Notify all callbacks
   */
  private notify(): void {
    if (!this.currentProgress) return;

    for (const callback of this.callbacks) {
      try {
        callback({ ...this.currentProgress });
      } catch (error) {
        console.error('[SyncProgress] Callback error:', error);
      }
    }
  }

  /**
   * Calculate estimated time remaining
   */
  private calculateETA(): number {
    if (!this.currentProgress || this.currentProgress.recordsProcessed === 0) return 0;

    const elapsed = Date.now() - this.currentProgress.startTime;
    const rate = this.currentProgress.recordsProcessed / elapsed; // records per ms
    const remaining = this.currentProgress.totalRecords - this.currentProgress.recordsProcessed;

    return Math.round(remaining / rate);
  }

  /**
   * Format time in human-readable format
   */
  private formatTime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }
}

// Export singleton instance
export const syncProgress = new SyncProgressReporter();
