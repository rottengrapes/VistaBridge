// ============================================================================
// Slug Utilities (Validation, Formatting, and Collision Handling)
//
// Rules per ticket VISTABRIDG-8:
// - Allowed: Lowercase alphanumeric (a-z, 0-9), hyphens (-), underscores (_)
// - Forbidden: Spaces, uppercase, symbols (!@#$%^&*()+={}[]|\:;"'<>,.?/~ etc.)
// - Must be unique across maps and dashboards respectively
// - Must not conflict with Next.js static reserved route segments
// ============================================================================

export const SLUG_REGEX = /^[a-z0-9_-]+$/;

export const RESERVED_MAP_SLUGS = new Set([
  'new',
  'manage',
  '2d',
  '3d',
  'api',
  'edit',
  'settings',
  'view',
  'overview',
  'dashboard',
]);

export const RESERVED_DASHBOARD_SLUGS = new Set([
  'new',
  'manage',
  'view',
  'api',
  'edit',
  'settings',
  'overview',
  'map',
]);

export interface SlugValidationResult {
  valid: boolean;
  error?: string;
  cleaned?: string;
}

/**
 * Validates a candidate slug string against strict format and reserved keywords.
 */
export function validateSlug(
  rawSlug: string,
  type: 'map' | 'dashboard' = 'map'
): SlugValidationResult {
  if (typeof rawSlug !== 'string') {
    return { valid: false, error: 'Slug must be a string.' };
  }

  const slug = rawSlug.trim();

  if (!slug) {
    return { valid: false, error: 'Slug cannot be empty.' };
  }

  if (slug.length < 2) {
    return { valid: false, error: 'Slug must be at least 2 characters long.' };
  }

  if (slug.length > 64) {
    return { valid: false, error: 'Slug cannot exceed 64 characters.' };
  }

  if (/\s/.test(slug)) {
    return { valid: false, error: 'Slug cannot contain spaces.' };
  }

  if (/[A-Z]/.test(slug)) {
    return { valid: false, error: 'Slug must be in lowercase only.' };
  }

  if (!SLUG_REGEX.test(slug)) {
    return {
      valid: false,
      error: 'Slug can only contain lowercase letters, numbers, hyphens (-), and underscores (_). No symbols or spaces allowed.',
    };
  }

  const reserved = type === 'map' ? RESERVED_MAP_SLUGS : RESERVED_DASHBOARD_SLUGS;
  if (reserved.has(slug.toLowerCase())) {
    return {
      valid: false,
      error: `"${slug}" is a reserved system keyword. Please choose a different slug.`,
    };
  }

  return { valid: true, cleaned: slug };
}

/**
 * Converts arbitrary text (e.g. workspace name) into a safe, valid slug.
 * Spaces and invalid symbols are converted to the chosen separator (_ or -).
 */
export function slugify(
  text: string,
  separator: '_' | '-' = '_'
): string {
  if (!text) return '';

  return text
    .toString()
    .toLowerCase()
    .trim()
    // Replace spaces and special characters with the separator
    .replace(/[^a-z0-9_-]+/g, separator)
    // Replace consecutive separators with a single one
    .replace(new RegExp(`\\${separator}+`, 'g'), separator)
    // Remove leading and trailing separators
    .replace(new RegExp(`^\\${separator}+|\\${separator}+$`, 'g'), '')
    .slice(0, 64);
}
