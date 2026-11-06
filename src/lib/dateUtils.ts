// ============================================================================
// Date Utilities (Unified date parsing, formatting, and time calculations)
//
// Ensures uniform handling of timestamps across Manage Maps and Manage Dashboards:
// 1. Normalizes raw SQLite UTC timestamps ("YYYY-MM-DD HH:MM:SS") to ISO-8601 ("...Z")
//    so JavaScript / dayjs correctly evaluates timezone offsets without lag.
// 2. Uniform relative time rendering ("Just now", "5 minutes ago", "2 days ago")
//    handling small clock drifts smoothly.
// 3. Uniform full localized timestamp tooltip ("YYYY-MM-DD HH:mm:ss").
// 4. Uniform table sorting comparator.
// ============================================================================

import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import utc from 'dayjs/plugin/utc';
import isBetween from 'dayjs/plugin/isBetween';

dayjs.extend(relativeTime);
dayjs.extend(utc);
dayjs.extend(isBetween);

/**
 * Normalizes any date string into an ISO-8601 UTC string.
 * Specifically converts SQLite's default CURRENT_TIMESTAMP format
 * ("YYYY-MM-DD HH:MM:SS" or "YYYY-MM-DD HH:MM:SS.SSS") into "YYYY-MM-DDTHH:MM:SS.SSSZ"
 * so that JavaScript and dayjs interpret it as UTC rather than local time.
 */
export function normalizeDateString(dateStr?: string | null): string | null {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const trimmed = dateStr.trim();
  if (!trimmed) return null;

  // Pattern matching "YYYY-MM-DD HH:MM:SS" or with fractional seconds
  if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(trimmed)) {
    return trimmed.replace(' ', 'T') + (trimmed.includes('.') ? 'Z' : '.000Z');
  }

  // If it already has 'T' but lacks timezone offset or 'Z' (e.g. "2026-10-30T12:00:00")
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(trimmed)) {
    return trimmed + (trimmed.includes('.') ? 'Z' : '.000Z');
  }

  return trimmed;
}

/**
 * Returns a valid Dayjs instance parsed as UTC if string representation, or null if invalid.
 */
export function parseDate(dateStr?: string | null): dayjs.Dayjs | null {
  const normalized = normalizeDateString(dateStr);
  if (!normalized) return null;
  const d = dayjs(normalized);
  return d.isValid() ? d : null;
}

/**
 * Formats date into a user-friendly relative time string (e.g. "Just now", "5 minutes ago", "2 days ago").
 * Handles clock skews within 60 seconds by returning "Just now".
 */
export function formatRelativeTime(dateStr?: string | null): string {
  const d = parseDate(dateStr);
  if (!d) return 'N/A';

  const diffSec = dayjs().diff(d, 'second');
  // If timestamp was created within the last 60 seconds (or up to 15 seconds in the future due to clock drift)
  if (diffSec >= -15 && diffSec < 60) {
    return 'Just now';
  }

  return d.fromNow();
}

/**
 * Formats date into standard full format for tooltips: "YYYY-MM-DD HH:mm:ss" in user's local timezone.
 */
export function formatFullDate(dateStr?: string | null): string {
  const d = parseDate(dateStr);
  if (!d) return 'No date';
  return d.format('YYYY-MM-DD HH:mm:ss');
}

/**
 * Sorter comparator function for comparing two date strings.
 */
export function compareDates(a?: string | null, b?: string | null): number {
  const dateA = parseDate(a);
  const dateB = parseDate(b);
  const unixA = dateA ? dateA.valueOf() : 0;
  const unixB = dateB ? dateB.valueOf() : 0;
  return unixA - unixB;
}

export { dayjs };
