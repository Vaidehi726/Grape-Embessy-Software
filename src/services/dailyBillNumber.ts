// Daily Sequential Bill Number Service
// Generates unique bill numbers that reset to 1 each day.
//
// The counter is authoritative on the SERVER's SQLite database, not in each
// device's localStorage. Previously every station kept its own localStorage
// counter, so two billing stations both produced bill #1, #2, #3 → duplicate
// bill numbers. Now the next number is reserved atomically from a single shared
// `bill_counters` table (over the LAN when a client, locally otherwise), so all
// stations draw from one sequence and can never collide.

const BILL_COUNTER_KEY = 'restroflow_daily_bill_counter';

interface BillCounterData {
  date: string; // YYYY-MM-DD
  counter: number;
}

/**
 * Kept for backwards compatibility with existing callers. Continuity is now
 * handled by the shared `bill_counters` table seeded from real orders, so there
 * is nothing to pre-compute here. This is a safe no-op.
 */
export async function initializeBillCounter(): Promise<void> {
  return;
}

/**
 * Reserve the next bill number for today.
 *
 * Routing:
 *   1. LAN client connected  → ask the server (single shared sequence).
 *   2. Local Electron (server/standalone) → atomic counter in local SQLite.
 *   3. Plain browser (no Electron) → localStorage fallback (dev only).
 */
export async function getNextBillNumber(): Promise<number> {
  const electronAPI = (window as any).electronAPI;

  // 1. LAN client mode → server-authoritative number.
  try {
    const lan = electronAPI?.lan;
    if (lan) {
      const status = await lan.clientStatus();
      if (status?.connected) {
        const result = await lan.nextBillNumber();
        if (result?.success && typeof result.billNumber === 'number') {
          return result.billNumber;
        }
        console.warn('[DailyBillNumber] LAN nextBillNumber failed:', result?.error);
      }
    }
  } catch (err) {
    console.warn('[DailyBillNumber] LAN bill-number error, falling back:', err);
  }

  // 2. Local Electron (server PC or standalone) → atomic local DB counter.
  try {
    const db = electronAPI?.db;
    if (db?.nextBillNumber) {
      const result = await db.nextBillNumber();
      if (result?.success && typeof result.billNumber === 'number') {
        return result.billNumber;
      }
      console.warn('[DailyBillNumber] Local nextBillNumber failed:', result?.error);
    }
  } catch (err) {
    console.warn('[DailyBillNumber] Local bill-number error, falling back:', err);
  }

  // 3. Plain-browser fallback (no Electron) — not shared, dev use only.
  return getNextBillNumberFromLocalStorage();
}

function getNextBillNumberFromLocalStorage(): number {
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
  try {
    const stored = localStorage.getItem(BILL_COUNTER_KEY);
    const data: BillCounterData | null = stored ? JSON.parse(stored) : null;

    const nextNumber = data && data.date === today ? data.counter + 1 : 1;

    localStorage.setItem(BILL_COUNTER_KEY, JSON.stringify({ date: today, counter: nextNumber }));
    return nextNumber;
  } catch (error) {
    console.error('[DailyBillNumber] Error generating bill number:', error);
    return 1; // Fallback
  }
}

/**
 * Format bill number with zero-padding (e.g., 1 -> "001", 10 -> "010")
 */
export function formatBillNumber(billNumber: number): string {
  return String(billNumber).padStart(3, '0');
}
