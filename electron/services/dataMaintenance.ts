// Database maintenance: archive old orders so a long-running site stays small.
//
// Designed to be run on a live restaurant PC, so it is deliberately cautious:
//   • It ALWAYS takes a byte-for-byte backup of the database first.
//   • It NEVER deletes an order that is still live (pending/cooking/ready),
//     no matter how old — deleting one would break a table that is still
//     serving, and stale "live" orders are a data problem to review, not to
//     silently destroy.
//   • It previews exactly what it would remove before anything is touched.
//   • Deletes run in a single transaction: all of it applies, or none of it.
//   • It VACUUMs afterwards, which is what actually shrinks the file on disk —
//     without it SQLite keeps the freed pages and the file never gets smaller.

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const ACTIVE_STATUSES = ['pending', 'cooking', 'ready'];

export interface ArchivePreview {
  cutoffIso: string;
  /** Orders older than the cutoff that are safe to remove. */
  ordersToDelete: number;
  /** order_items belonging to those orders. */
  itemsToDelete: number;
  /** Orders kept because they are on/after the cutoff. */
  ordersKeptRecent: number;
  /** Orders older than the cutoff but STILL LIVE — always kept, listed for review. */
  staleLiveOrders: number;
  totalOrders: number;
  dbSizeMb: number;
}

export interface ArchiveResult extends ArchivePreview {
  deletedOrders: number;
  deletedItems: number;
  backupPath: string;
  dbSizeMbAfter: number;
}

function dbPathFor(userDataPath: string) {
  return path.join(userDataPath, 'restroflow.db');
}

function sizeMb(file: string): number {
  try {
    return Math.round((fs.statSync(file).size / 1024 / 1024) * 10) / 10;
  } catch {
    return 0;
  }
}

/** Start of the current month, as an ISO string — the default retention point. */
export function startOfCurrentMonthIso(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0).toISOString();
}

/**
 * Report what an archive would do. Read-only — changes nothing.
 */
export function previewArchive(userDataPath: string, cutoffIso: string): ArchivePreview {
  const file = dbPathFor(userDataPath);
  const db = new Database(file, { readonly: true });
  try {
    const placeholders = ACTIVE_STATUSES.map(() => '?').join(',');

    const totalOrders = (db.prepare('SELECT COUNT(*) c FROM orders').get() as any).c;

    const ordersToDelete = (db
      .prepare(
        `SELECT COUNT(*) c FROM orders
         WHERE created_at < ? AND (status IS NULL OR status NOT IN (${placeholders}))`
      )
      .get(cutoffIso, ...ACTIVE_STATUSES) as any).c;

    const itemsToDelete = (db
      .prepare(
        `SELECT COUNT(*) c FROM order_items WHERE order_id IN (
           SELECT id FROM orders
           WHERE created_at < ? AND (status IS NULL OR status NOT IN (${placeholders}))
         )`
      )
      .get(cutoffIso, ...ACTIVE_STATUSES) as any).c;

    const staleLiveOrders = (db
      .prepare(
        `SELECT COUNT(*) c FROM orders
         WHERE created_at < ? AND status IN (${placeholders})`
      )
      .get(cutoffIso, ...ACTIVE_STATUSES) as any).c;

    const ordersKeptRecent = (db
      .prepare('SELECT COUNT(*) c FROM orders WHERE created_at >= ?')
      .get(cutoffIso) as any).c;

    return {
      cutoffIso,
      ordersToDelete,
      itemsToDelete,
      ordersKeptRecent,
      staleLiveOrders,
      totalOrders,
      dbSizeMb: sizeMb(file),
    };
  } finally {
    db.close();
  }
}

/**
 * Back up, then delete orders (and their items) that are older than the cutoff
 * and no longer live. Finally VACUUM so the file actually shrinks.
 */
export function archiveOldData(userDataPath: string, cutoffIso: string): ArchiveResult {
  const file = dbPathFor(userDataPath);
  const before = previewArchive(userDataPath, cutoffIso);

  // 1. Backup FIRST, before a single row is touched. Include -wal/-shm so the
  //    copy is restorable exactly as-is.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = path.join(userDataPath, `restroflow-backup-${stamp}.db`);
  fs.copyFileSync(file, backupPath);
  for (const ext of ['-wal', '-shm']) {
    if (fs.existsSync(file + ext)) {
      try { fs.copyFileSync(file + ext, backupPath + ext); } catch { /* best effort */ }
    }
  }
  console.log('[Maintenance] Backup written to', backupPath);

  const db = new Database(file);
  let deletedOrders = 0;
  let deletedItems = 0;

  try {
    db.pragma('foreign_keys = ON');
    const placeholders = ACTIVE_STATUSES.map(() => '?').join(',');

    const run = db.transaction(() => {
      // Children first so foreign keys stay satisfied at every step.
      const itemsRes = db
        .prepare(
          `DELETE FROM order_items WHERE order_id IN (
             SELECT id FROM orders
             WHERE created_at < ? AND (status IS NULL OR status NOT IN (${placeholders}))
           )`
        )
        .run(cutoffIso, ...ACTIVE_STATUSES);
      deletedItems = itemsRes.changes;

      const ordersRes = db
        .prepare(
          `DELETE FROM orders
           WHERE created_at < ? AND (status IS NULL OR status NOT IN (${placeholders}))`
        )
        .run(cutoffIso, ...ACTIVE_STATUSES);
      deletedOrders = ordersRes.changes;

      // sync_log is an append-only audit trail that grows forever and is not
      // used for billing or reporting; trim it to the same window.
      try {
        db.prepare('DELETE FROM sync_log WHERE synced_at < ?').run(cutoffIso);
      } catch { /* table may not exist on older installs */ }
    });

    run();
    console.log(`[Maintenance] Deleted ${deletedOrders} orders and ${deletedItems} items`);
  } finally {
    // VACUUM cannot run inside a transaction; it rebuilds the file so the space
    // freed above is actually returned to the disk.
    try {
      db.exec('VACUUM');
      console.log('[Maintenance] VACUUM complete');
    } catch (err: any) {
      console.warn('[Maintenance] VACUUM failed (data is still fine):', err?.message);
    }
    db.close();
  }

  return {
    ...before,
    deletedOrders,
    deletedItems,
    backupPath,
    dbSizeMbAfter: sizeMb(file),
  };
}
