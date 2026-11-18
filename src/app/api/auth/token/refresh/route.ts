// ============================================================================
// JWT Token Refresh API Route (/api/auth/token/refresh)
//
// Keeps user sessions active seamlessly:
// 1. Reads the secure HttpOnly `refresh_token` cookie from the incoming request
// 2. Validates the cryptographic JWT signature
// 3. Issues a fresh 15-minute access token without asking the user to re-type password
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { signJwt, verifyJwt } from '@/lib/jwt';
import { pool, initDb } from '@/lib/db';

export async function POST(request: NextRequest) {
  // Read the refresh token from the HttpOnly cookie (never accessible to JS)
  const refreshToken = request.cookies.get('refresh_token')?.value;

  if (!refreshToken) {
    return NextResponse.json(
      { detail: 'No refresh token found. Please log in again.' },
      { status: 401 }
    );
  }

  const payload = verifyJwt(refreshToken);
  if (!payload) {
    // Token is invalid or expired — clear the cookie
    const res = NextResponse.json(
      { detail: 'Refresh token expired or invalid. Please log in again.' },
      { status: 401 }
    );
    res.cookies.delete('refresh_token');
    res.cookies.delete('geoserver_auth');
    res.cookies.delete('geoserver_url');
    res.cookies.delete('geoserver_username');
    return res;
  }

  // Verify that the token matches the currently configured GeoServer
  const configuredUrl = (process.env.NEXT_PUBLIC_GEOSERVER_URL || process.env.GEOSERVER_URL || '').replace(/\/+$/, '').toLowerCase();
  const tokenUrl = (payload.geoserverUrl || '').replace(/\/+$/, '').toLowerCase();
  if (configuredUrl && tokenUrl && configuredUrl !== tokenUrl) {
    const res = NextResponse.json(
      { detail: 'Active GeoServer instance changed. Please sign in again.' },
      { status: 401 }
    );
    res.cookies.delete('refresh_token');
    res.cookies.delete('geoserver_auth');
    res.cookies.delete('geoserver_url');
    res.cookies.delete('geoserver_username');
    return res;
  }

  // Retrieve GeoServer credentials from secure server-side cookies
  const geoserverAuth = request.cookies.get('geoserver_auth')?.value;
  const geoserverUrl =
    request.cookies.get('geoserver_url')?.value ||
    payload.geoserverUrl ||
    process.env.NEXT_PUBLIC_GEOSERVER_URL ||
    'http://localhost:8080/geoserver';

  // Fetch profile metadata and assigned GeoServer roles from database
  let firstName = '';
  let lastName = '';
  let emailAddress = '';
  let userRoles: string[] = Array.isArray(payload.roles) && payload.roles.length > 0 ? payload.roles : [];

  try {
    await initDb();
    const profileResult = await pool.query(
      'SELECT first_name, last_name, email, role, geoserver_roles FROM user_profiles WHERE username = $1 AND (geoserver_url = $2 OR geoserver_url = \'\' OR geoserver_url IS NULL) ORDER BY geoserver_url DESC LIMIT 1',
      [payload.username, geoserverUrl]
    );
    if (profileResult.rows.length > 0) {
      firstName = profileResult.rows[0].first_name || '';
      lastName = profileResult.rows[0].last_name || '';
      emailAddress = profileResult.rows[0].email || '';
      const rawRoles = profileResult.rows[0].geoserver_roles;
      const parsedRoles = Array.isArray(rawRoles) ? rawRoles : (typeof rawRoles === 'string' ? JSON.parse(rawRoles) : []);
      if (Array.isArray(parsedRoles) && parsedRoles.length > 0) {
        userRoles = parsedRoles;
      }
    }
  } catch (dbErr) {
    // Non-fatal if database profile lookup is temporarily unavailable
  }

  // Ensure ADMINs always have admin role mappings
  if (payload.role === 'ADMIN' || payload.username?.toLowerCase() === 'admin') {
    const adminSet = new Set([...userRoles, 'ADMIN', 'ROLE_ADMINISTRATOR', 'ROLE_AUTHENTICATED']);
    userRoles = Array.from(adminSet);
  }

  // Issue a fresh access token (short-lived, 1 hour) with roles preserved
  const newAccess = signJwt(
    { username: payload.username, role: payload.role, geoserverUrl: payload.geoserverUrl, roles: userRoles },
    3600
  );

  // Rotate the refresh token (new 7-day token, resets expiry) with roles preserved
  const newRefresh = signJwt(
    { username: payload.username, role: payload.role, geoserverUrl: payload.geoserverUrl, roles: userRoles },
    7 * 24 * 3600
  );

  const role = payload.role === 'ADMIN' ? 'ADMIN' : 'USER';
  const username = payload.username;

  const user = {
    username,
    role,
    roles: userRoles,
    geoserverUrl,
    geoserverAuth: geoserverAuth || undefined,
    first_name: firstName || undefined,
    last_name: lastName || undefined,
    email: emailAddress || `${username}@vismap.com`,
  };

  const isProduction = process.env.NODE_ENV === 'production';
  const res = NextResponse.json({
    access: newAccess,
    user,
  });

  // Rotate refresh token cookie
  res.cookies.set('refresh_token', newRefresh, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60,
    path: '/api/auth/token',
  });

  // Maintain GeoServer session cookies
  if (geoserverAuth) {
    res.cookies.set('geoserver_auth', geoserverAuth, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60,
    });
  }

  if (geoserverUrl) {
    res.cookies.set('geoserver_url', geoserverUrl, {
      secure: isProduction,
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60,
    });
  }

  res.cookies.set('geoserver_username', username, {
    secure: isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60,
  });

  return res;
}
