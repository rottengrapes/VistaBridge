// ============================================================================
// GeoServer Security Roles API Route (/api/geoserver/roles)
//
// Fetches the list of derived security roles from the active GeoServer instance:
// - Queries GeoServer's Spring Security REST API (/rest/security/roles.json)
// - Excludes ROLE_ANONYMOUS
// - Provides standard fallback roles (ROLE_ADMINISTRATOR, ROLE_AUTHENTICATED)
// ============================================================================

import { NextResponse } from 'next/server';
import { getGeoServerUrl, getGeoServerHeaders, resolveInternalGeoServerUrl } from '@/lib/geoserver';
import { verifyJwt } from '@/lib/jwt';
import { pool, initDb } from '@/lib/db';

const DEFAULT_GEOSERVER_ROLES = [
  'ROLE_ADMINISTRATOR',
  'ROLE_AUTHENTICATED',
  'ADMIN',
  'ROLE_GIS_ANALYST',
  'ROLE_EDITOR',
  'ROLE_VIEWER',
];

function getAuthUser(request: Request) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return verifyJwt(authHeader.substring(7));
}

export async function GET(request: Request) {
  try {
    const user = getAuthUser(request);
    if (!user) {
      return NextResponse.json({ detail: 'Authentication credentials were not provided.' }, { status: 401 });
    }

    await initDb();
    const rawUrl = getGeoServerUrl(request).replace(/\/+$/, '');
    const serverUrl = resolveInternalGeoServerUrl(rawUrl);
    const headers = getGeoServerHeaders(request);

    const rolesSet = new Set<string>();

    // 1. Try with user's own credentials
    try {
      const geoRes = await fetch(`${serverUrl}/rest/security/roles.json`, {
        headers,
        signal: AbortSignal.timeout(3000),
      });

      if (geoRes.ok) {
        const data = await geoRes.json();
        const rawList = data?.roles?.role || data?.roles || [];
        const arr = Array.isArray(rawList) ? rawList : [rawList];
        for (const item of arr) {
          const roleName = typeof item === 'string' ? item : item?.name || item?.id;
          if (roleName && typeof roleName === 'string' && roleName.toUpperCase() !== 'ROLE_ANONYMOUS') {
            rolesSet.add(roleName);
          }
        }
      }
    } catch (err) {
      console.warn('[GET /api/geoserver/roles] User credentials query failed:', err);
    }

    // 2. If user is non-admin (401/403), try using stored admin credentials
    if (rolesSet.size === 0) {
      try {
        const adminAuthRes = await pool.query(
          `SELECT value FROM app_settings WHERE key IN ($1, $2) ORDER BY key = $1 DESC LIMIT 1`,
          [`geoserver_admin_auth:${rawUrl}`, 'geoserver_admin_auth']
        );
        const adminBasicAuth = adminAuthRes.rows?.[0]?.value || process.env.GEOSERVER_ADMIN_AUTH;
        if (adminBasicAuth) {
          const geoRes = await fetch(`${serverUrl}/rest/security/roles.json`, {
            headers: {
              'Authorization': adminBasicAuth,
              'Accept': 'application/json',
            },
            signal: AbortSignal.timeout(3000),
          });
          if (geoRes.ok) {
            const data = await geoRes.json();
            const rawList = data?.roles?.role || data?.roles || [];
            const arr = Array.isArray(rawList) ? rawList : [rawList];
            for (const item of arr) {
              const roleName = typeof item === 'string' ? item : item?.name || item?.id;
              if (roleName && typeof roleName === 'string' && roleName.toUpperCase() !== 'ROLE_ANONYMOUS') {
                rolesSet.add(roleName);
              }
            }
          }
        }
      } catch (err) {
        console.warn('[GET /api/geoserver/roles] Admin credentials query failed:', err);
      }
    }

    // 3. If live query failed, check cached roles in app_settings
    if (rolesSet.size === 0) {
      try {
        const cachedRes = await pool.query(
          `SELECT value FROM app_settings WHERE key IN ($1, $2) ORDER BY key = $1 DESC LIMIT 1`,
          [`geoserver_roles:${rawUrl}`, 'geoserver_roles']
        );
        if (cachedRes.rows?.[0]?.value) {
          const cachedArr = JSON.parse(cachedRes.rows[0].value);
          if (Array.isArray(cachedArr)) {
            cachedArr.forEach((r: string) => rolesSet.add(r));
          }
        }
      } catch (err) {
        console.warn('[GET /api/geoserver/roles] Cached roles lookup failed:', err);
      }
    }

    // 4. Only fall back to default roles if no roles could be retrieved or cached
    if (rolesSet.size === 0) {
      DEFAULT_GEOSERVER_ROLES.forEach((r) => rolesSet.add(r));
    }

    const result = Array.from(rolesSet).sort((a, b) => a.localeCompare(b));

    // Cache the accurate role list if we fetched live roles
    if (rolesSet.size > 0 && !result.includes('ROLE_GIS_ANALYST')) {
      try {
        await pool.query(
          `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP)
           ON CONFLICT(key) DO UPDATE SET value = $2, updated_at = CURRENT_TIMESTAMP`,
          [`geoserver_roles:${rawUrl}`, JSON.stringify(result)]
        );
      } catch {}
    }

    return NextResponse.json({ roles: result });
  } catch (err: unknown) {
    console.error('[GET /api/geoserver/roles] Error:', err);
    return NextResponse.json({ roles: DEFAULT_GEOSERVER_ROLES });
  }
}
