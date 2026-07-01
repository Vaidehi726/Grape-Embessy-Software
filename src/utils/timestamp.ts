// Timestamp normalization utilities
// Ensures consistent ISO 8601 format across all databases

/**
 * Standardize a timestamp to ISO 8601 format
 * Handles various input formats and converts to: "2026-04-13T15:30:00.000Z"
 * 
 * @param timestamp - Can be: Date object, ISO string, SQLite datetime, or Unix timestamp
 * @returns ISO 8601 formatted string
 */
export function normalizeTimestamp(timestamp: string | Date | number | null | undefined): string | null {
  if (!timestamp) return null;

  try {
    let date: Date;

    if (timestamp instanceof Date) {
      date = timestamp;
    } else if (typeof timestamp === 'number') {
      // Unix timestamp (milliseconds or seconds)
      date = new Date(timestamp < 1e12 ? timestamp * 1000 : timestamp);
    } else if (typeof timestamp === 'string') {
      // Handle SQLite datetime format: "2026-04-13 15:30:00"
      if (!timestamp.includes('T') && timestamp.includes(' ')) {
        // Convert "2026-04-13 15:30:00" to "2026-04-13T15:30:00.000Z"
        const cleanTimestamp = timestamp.replace(' ', 'T');
        date = new Date(cleanTimestamp + 'Z');
      } else {
        // Already ISO format or parseable
        date = new Date(timestamp);
      }
    } else {
      return null;
    }

    // Validate date
    if (isNaN(date.getTime())) {
      console.warn('[Timestamp] Invalid timestamp:', timestamp);
      return null;
    }

    return date.toISOString();
  } catch (error) {
    console.warn('[Timestamp] Failed to normalize timestamp:', timestamp, error);
    return null;
  }
}

/**
 * Get current timestamp in ISO 8601 format
 * Use this instead of CURRENT_TIMESTAMP or new Date().toISOString() directly
 */
export function currentTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Normalize all timestamps in a record
 * 
 * @param record - Database record with potential timestamp fields
 * @param timestampFields - Array of field names that contain timestamps (default: ['created_at', 'updated_at'])
 * @returns New record with normalized timestamps
 */
export function normalizeRecordTimestamps<T extends Record<string, any>>(
  record: T,
  timestampFields: string[] = ['created_at', 'updated_at']
): T {
  const normalized: Record<string, any> = { ...record };

  for (const field of timestampFields) {
    if (normalized[field] !== undefined && normalized[field] !== null) {
      normalized[field] = normalizeTimestamp(normalized[field]);
    }
  }

  return normalized as T;
}

/**
 * Normalize timestamps in an array of records
 */
export function normalizeRecordsTimestamps<T extends Record<string, any>>(
  records: T[],
  timestampFields: string[] = ['created_at', 'updated_at']
): T[] {
  return records.map(record => normalizeRecordTimestamps(record, timestampFields));
}

/**
 * Compare two timestamps (handles different formats)
 * 
 * @returns -1 if a < b, 0 if a === b, 1 if a > b
 */
export function compareTimestamps(a: string | Date | null, b: string | Date | null): number {
  const dateA = a instanceof Date ? a : new Date(a || 0);
  const dateB = b instanceof Date ? b : new Date(b || 0);

  if (dateA.getTime() < dateB.getTime()) return -1;
  if (dateA.getTime() > dateB.getTime()) return 1;
  return 0;
}

/**
 * Check if a timestamp is valid
 */
export function isValidTimestamp(timestamp: string | Date | null | undefined): boolean {
  if (!timestamp) return false;
  
  try {
    const normalized = normalizeTimestamp(timestamp);
    return normalized !== null;
  } catch {
    return false;
  }
}
