// ============================================================================
// Login API (POST /api/auth/login)
//
// 1. Verifies username and password against GeoServer (/j_spring_security_check).
// 2. Checks if user is an admin (/rest/about/system-status.json).
// 3. Generates JWT access/refresh tokens.
// 4. Creates or updates the user profile in local SQLite (user_profiles table).
// 5. Sets secure HttpOnly cookies so GeoServer requests work automatically.
// ============================================================================


import { NextResponse } from 'next/server';
import { signJwt } from '@/lib/jwt';
import { pool, initDb } from '@/lib/db';
import { resolveInternalGeoServerUrl } from '@/lib/geoserver';
import { getAppSetting } from '@/lib/settings';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { username, password, geoserverUrl } = body;

    if (!username || !password) {
      return NextResponse.json(
        { detail: 'Username and password are required.' },
        { status: 400 }
      );
    }

    // ------------------------------------------------------------------------
    // STEP 1: Resolve target GeoServer URL & encode HTTP Basic credentials
    // ------------------------------------------------------------------------
    const defaultGeoserverUrl = await getAppSetting('geoserver_url', 'http://localhost:8080/geoserver');
    const rawTarget = geoserverUrl || defaultGeoserverUrl;
    const serverFetchUrl = resolveInternalGeoServerUrl(rawTarget);
    const cleanUrl = serverFetchUrl.replace(/\/+$/, '');

    // Encode Basic Authentication token
    const basicAuth = 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');


    let isAuthenticated = false;
    let isAdmin = false;

    try {
      const params = new URLSearchParams();
      params.append('username', username);
      params.append('password', password);

      const geoRes = await fetch(`${serverFetchUrl}/j_spring_security_check`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
        redirect: 'manual',
        signal: AbortSignal.timeout(5000),
      });

      const location = geoRes.headers.get('location') || '';
      if (geoRes.status === 302 && !location.includes('error=true')) {
        isAuthenticated = true;
      }
    } catch (err) {
      console.error('GeoServer login verification failed:', err);
    }

    if (isAuthenticated) {
      if (username.toLowerCase() === 'admin') {
        isAdmin = true;
      }
      // Check if user is admin via system-status
      try {
        const statusRes = await fetch(`${serverFetchUrl}/rest/about/system-status.json`, {
          method: 'GET',
          headers: {
            'Authorization': basicAuth,
            'Accept': 'application/json',
          },
          signal: AbortSignal.timeout(3000),
        });

        if (statusRes.status === 200) {
          isAdmin = true;
        }
      } catch (err) {
        // Safe to ignore, fallback is non-admin
      }
    }

    if (!isAuthenticated) {
      return NextResponse.json(
        { detail: 'Invalid credentials or unable to contact GeoServer.' },
        { status: 401 }
      );
    }

    await initDb();

    // Query user's assigned GeoServer roles
    let userRoles: string[] = [];
    try {
      const rolesRes = await fetch(`${serverFetchUrl}/rest/security/roles/user/${username}.json`, {
        method: 'GET',
        headers: {
          Authorization: basicAuth,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(3000),
      });
      if (rolesRes.ok) {
        const rolesData = await rolesRes.json();
        const rawRoles = rolesData?.roles || rolesData?.role || [];
        userRoles = (Array.isArray(rawRoles) ? rawRoles : [rawRoles])
          .map((r: any) => typeof r === 'string' ? r : (r?.name || r?.id || ''))
          .filter(Boolean);
      }
    } catch {
      // Ignore if endpoint is inaccessible
    }

    // If query with user's own credentials failed (e.g. 403 Forbidden because GeoServer rest is admin-only),
    // try with stored admin credentials from app_settings
    if (userRoles.length === 0 && !isAdmin) {
      try {
        const adminAuthRes = await pool.query(
          `SELECT value FROM app_settings WHERE key IN ($1, $2) ORDER BY key = $1 DESC LIMIT 1`,
          [`geoserver_admin_auth:${cleanUrl}`, 'geoserver_admin_auth']
        );
        const adminBasicAuth = adminAuthRes.rows?.[0]?.value || process.env.GEOSERVER_ADMIN_AUTH;
        if (adminBasicAuth) {
          const adminRolesRes = await fetch(`${serverFetchUrl}/rest/security/roles/user/${username}.json`, {
            method: 'GET',
            headers: {
              Authorization: adminBasicAuth,
              Accept: 'application/json',
            },
            signal: AbortSignal.timeout(3000),
          });
          if (adminRolesRes.ok) {
            const rolesData = await adminRolesRes.json();
            const rawRoles = rolesData?.roles || rolesData?.role || [];
            userRoles = (Array.isArray(rawRoles) ? rawRoles : [rawRoles])
              .map((r: any) => typeof r === 'string' ? r : (r?.name || r?.id || ''))
              .filter(Boolean);
          }
        }
      } catch (err) {
        console.warn('Could not query user roles with admin credentials:', err);
      }
    }

    // Fallback: check if user has previously cached geoserver_roles in user_profiles
    if (userRoles.length === 0 && !isAdmin) {
      try {
        const profileCheck = await pool.query(
          `SELECT geoserver_roles FROM user_profiles WHERE username = $1 AND geoserver_url = $2`,
          [username, cleanUrl]
        );
        const cachedStr = profileCheck.rows?.[0]?.geoserver_roles;
        if (cachedStr) {
          const parsed = JSON.parse(cachedStr);
          if (Array.isArray(parsed) && parsed.length > 0) {
            userRoles = parsed;
          }
        }
      } catch {}
    }

    if (isAdmin) {
      if (!userRoles.includes('ROLE_ADMINISTRATOR')) userRoles.unshift('ROLE_ADMINISTRATOR');
      if (!userRoles.includes('ADMIN')) userRoles.unshift('ADMIN');

      // Persist the admin basic auth token and cache all GeoServer roles in app_settings
      try {
        await pool.query(
          `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP)
           ON CONFLICT(key) DO UPDATE SET value = $2, updated_at = CURRENT_TIMESTAMP`,
          [`geoserver_admin_auth:${cleanUrl}`, basicAuth]
        );
        await pool.query(
          `INSERT INTO app_settings (key, value, updated_at) VALUES ('geoserver_admin_auth', $1, CURRENT_TIMESTAMP)
           ON CONFLICT(key) DO UPDATE SET value = $1, updated_at = CURRENT_TIMESTAMP`,
          [basicAuth]
        );

        // Fetch and cache the full GeoServer role list
        const allRolesRes = await fetch(`${serverFetchUrl}/rest/security/roles.json`, {
          headers: { Authorization: basicAuth, Accept: 'application/json' },
          signal: AbortSignal.timeout(3000),
        });
        if (allRolesRes.ok) {
          const allRolesData = await allRolesRes.json();
          const rawList = allRolesData?.roles?.role || allRolesData?.roles || [];
          const arr = (Array.isArray(rawList) ? rawList : [rawList])
            .map((item: any) => typeof item === 'string' ? item : item?.name || item?.id)
            .filter((r: any) => r && typeof r === 'string' && r.toUpperCase() !== 'ROLE_ANONYMOUS');
          if (arr.length > 0) {
            await pool.query(
              `INSERT INTO app_settings (key, value, updated_at) VALUES ($1, $2, CURRENT_TIMESTAMP)
               ON CONFLICT(key) DO UPDATE SET value = $2, updated_at = CURRENT_TIMESTAMP`,
              [`geoserver_roles:${cleanUrl}`, JSON.stringify(arr)]
            );
            await pool.query(
              `INSERT INTO app_settings (key, value, updated_at) VALUES ('geoserver_roles', $1, CURRENT_TIMESTAMP)
               ON CONFLICT(key) DO UPDATE SET value = $1, updated_at = CURRENT_TIMESTAMP`,
              [JSON.stringify(arr)]
            );
          }
        }
      } catch (err) {
        console.warn('Failed to cache admin auth / roles:', err);
      }
    }

    if (!userRoles.includes('ROLE_AUTHENTICATED')) {
      userRoles.push('ROLE_AUTHENTICATED');
    }

    // JWT sign for frontend site status compatibility
    const role = isAdmin ? 'ADMIN' : 'MEMBER';
    const payload = { username, role, geoserverUrl: cleanUrl, roles: userRoles };
    const access = signJwt(payload, 3600);
    const refresh = signJwt(payload, 7 * 24 * 3600);

    let firstName = '';
    let lastName = '';
    let emailAddress = '';

    try {
      const profileResult = await pool.query(
        'SELECT first_name, last_name, email, role FROM user_profiles WHERE username = $1 AND geoserver_url = $2',
        [username, cleanUrl]
      );
      if (profileResult.rows.length > 0) {
        firstName = profileResult.rows[0].first_name || '';
        lastName = profileResult.rows[0].last_name || '';
        emailAddress = profileResult.rows[0].email || '';
        // Keep database role and cached roles in sync with live GeoServer authority
        const currentRole = isAdmin ? 'ADMIN' : 'MEMBER';
        await pool.query(
          'UPDATE user_profiles SET role = $1, geoserver_roles = $2, updated_at = CURRENT_TIMESTAMP WHERE username = $3 AND geoserver_url = $4',
          [currentRole, JSON.stringify(userRoles), username, cleanUrl]
        );
      } else {
        // First-time login: Auto-create user profile in database
        const autoRole = isAdmin ? 'ADMIN' : 'MEMBER';
        const autoFirst = username.charAt(0).toUpperCase() + username.slice(1);
        firstName = autoFirst;
        lastName = 'User';
        emailAddress = `${username}@vismap.com`;

        await pool.query(
          `INSERT INTO user_profiles (username, geoserver_url, role, first_name, last_name, email, geoserver_roles)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (username, geoserver_url) DO UPDATE SET role = EXCLUDED.role, geoserver_roles = EXCLUDED.geoserver_roles`,
          [username, cleanUrl, autoRole, autoFirst, lastName, emailAddress, JSON.stringify(userRoles)]
        );
      }
    } catch (dbErr) {
      console.error('Error fetching or bootstrapping profile on login:', dbErr);
    }

    const isProduction = process.env.NODE_ENV === 'production';
    const response = NextResponse.json({
      success: true,
      access,
      username,
      role: isAdmin ? 'ADMIN' : 'USER',
      roles: userRoles,
      first_name: firstName || undefined,
      last_name: lastName || undefined,
      email: emailAddress || undefined,
      geoserverUrl: cleanUrl,
    });

    // Set GeoServer Auth Cookies
    response.cookies.set('geoserver_auth', basicAuth, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60, // 7 days
    });

    response.cookies.set('geoserver_username', username, {
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60, // 7 days
    });

    response.cookies.set('geoserver_url', cleanUrl, {
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60, // 7 days
    });

    // Also set standard refresh token cookie for backward compatibility
    response.cookies.set('refresh_token', refresh, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60, // 7 days
      path: '/api/auth/token',
    });

    return response;
  } catch (error: any) {
    console.error('Login route error:', error);
    return NextResponse.json(
      { detail: 'Internal server error during authentication.' },
      { status: 500 }
    );
  }
}
