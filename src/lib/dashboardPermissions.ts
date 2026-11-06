// ============================================================================
// Dashboard Permissions & Access Control Utilities
//
// Normalizes and evaluates user permissions for dashboards:
// - Role types: VIEWER (read-only) | EDITOR (can edit widgets and save)
// - Supports both legacy string arrays ["user1"] and structured [{ username, role }]
// ============================================================================

export type DashboardUserRole = 'VIEWER' | 'EDITOR';

export interface AllowedUserEntry {
  username: string;
  role: DashboardUserRole;
}

/**
 * Normalizes raw allowed_users from DB (string, JSON, array of strings, or array of objects)
 * into a consistent array of { username, role } entries.
 */
export function normalizeAllowedUsers(raw: any): AllowedUserEntry[] {
  if (!raw) return [];
  const parsed = Array.isArray(raw)
    ? raw
    : (() => {
        try {
          return typeof raw === 'string' ? JSON.parse(raw) : [];
        } catch {
          return [];
        }
      })();

  if (!Array.isArray(parsed)) return [];

  const seen = new Set<string>();
  const normalized: AllowedUserEntry[] = [];

  for (const item of parsed) {
    if (typeof item === 'string') {
      const cleanName = item.trim();
      const lower = cleanName.toLowerCase();
      if (cleanName && !seen.has(lower)) {
        seen.add(lower);
        normalized.push({ username: cleanName, role: 'VIEWER' });
      }
    } else if (typeof item === 'object' && item !== null && item.username) {
      const cleanName = String(item.username).trim();
      const lower = cleanName.toLowerCase();
      const roleStr = String(item.role || item.permission || 'VIEWER').toUpperCase();
      const role: DashboardUserRole = roleStr === 'EDITOR' ? 'EDITOR' : 'VIEWER';
      if (cleanName && !seen.has(lower)) {
        seen.add(lower);
        normalized.push({ username: cleanName, role });
      }
    }
  }

  return normalized;
}

/**
 * Checks if a specific username has access in an allowed_users list
 */
export function isUserInAllowedList(allowedUsers: AllowedUserEntry[], username: string): boolean {
  if (!username) return false;
  const lower = username.toLowerCase();
  return allowedUsers.some((u) => u.username.toLowerCase() === lower);
}

/**
 * Gets a user's assigned role from allowed_users ('VIEWER' | 'EDITOR' | null)
 */
export function getUserAssignedRole(
  allowedUsers: AllowedUserEntry[],
  username: string
): DashboardUserRole | null {
  if (!username) return null;
  const lower = username.toLowerCase();
  const entry = allowedUsers.find((u) => u.username.toLowerCase() === lower);
  return entry ? entry.role : null;
}

export interface AllowedRoleEntry {
  role: string;
  permission: DashboardUserRole;
}

/**
 * Normalizes raw allowed_roles from DB (string, JSON, array of strings, or array of objects)
 * into a consistent array of { role, permission } entries.
 */
export function normalizeAllowedRoles(raw: any): AllowedRoleEntry[] {
  if (!raw) return [];
  const parsed = Array.isArray(raw)
    ? raw
    : (() => {
        try {
          return typeof raw === 'string' ? JSON.parse(raw) : [];
        } catch {
          return [];
        }
      })();

  if (!Array.isArray(parsed)) return [];

  const seen = new Set<string>();
  const normalized: AllowedRoleEntry[] = [];

  for (const item of parsed) {
    if (typeof item === 'string') {
      const cleanRole = item.trim();
      const upper = cleanRole.toUpperCase();
      if (cleanRole && !seen.has(upper)) {
        seen.add(upper);
        normalized.push({ role: cleanRole, permission: 'VIEWER' });
      }
    } else if (typeof item === 'object' && item !== null && (item.role || item.name)) {
      const cleanRole = String(item.role || item.name).trim();
      const upper = cleanRole.toUpperCase();
      const permStr = String(item.permission || item.role_type || item.access || 'VIEWER').toUpperCase();
      const permission: DashboardUserRole = permStr === 'EDITOR' ? 'EDITOR' : 'VIEWER';
      if (cleanRole && !seen.has(upper)) {
        seen.add(upper);
        normalized.push({ role: cleanRole, permission });
      }
    }
  }

  return normalized;
}

/**
 * Checks if any of the user's active GeoServer roles are present in the allowed_roles list
 */
export function isRoleInAllowedList(allowedRoles: AllowedRoleEntry[], userRoles: string[]): boolean {
  if (!Array.isArray(userRoles) || userRoles.length === 0) return false;
  const userRoleSet = new Set(userRoles.map((r) => r.toUpperCase()));
  return allowedRoles.some((entry) => userRoleSet.has(entry.role.toUpperCase()));
}

/**
 * Gets the highest permission granted by the user's matching GeoServer roles ('EDITOR' > 'VIEWER' > null)
 */
export function getRoleAssignedPermission(
  allowedRoles: AllowedRoleEntry[],
  userRoles: string[]
): DashboardUserRole | null {
  if (!Array.isArray(userRoles) || userRoles.length === 0) return null;
  const userRoleSet = new Set(userRoles.map((r) => r.toUpperCase()));
  const matches = allowedRoles.filter((entry) => userRoleSet.has(entry.role.toUpperCase()));
  if (matches.length === 0) return null;
  if (matches.some((entry) => entry.permission === 'EDITOR')) return 'EDITOR';
  return 'VIEWER';
}

/**
 * Checks whether a user has system administrator privileges
 */
export function isUserAdmin(user: any): boolean {
  if (!user) return false;
  if (user.role === 'ADMIN') return true;
  if (typeof user.username === 'string' && user.username.toLowerCase() === 'admin') return true;
  if (user.profile?.role === 'ADMIN') return true;
  const roles: string[] = Array.isArray(user.roles) ? user.roles : [];
  return roles.some((r: string) => {
    const upper = String(r).toUpperCase();
    return upper === 'ADMIN' || upper === 'ROLE_ADMINISTRATOR' || upper === 'ADMINISTRATOR';
  });
}

