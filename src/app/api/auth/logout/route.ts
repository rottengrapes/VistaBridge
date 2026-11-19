// ============================================================================
// Logout API Route (/api/auth/logout)
//
// Terminates the user's active session:
// 1. Sends a logout request to GeoServer to destroy the backend Spring session
// 2. Deletes all authentication cookies (`refresh_token`, `geoserver_auth`,
//    `geoserver_url`, and `GEOSERVER_JSESSIONID`)
// ============================================================================

import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const cookiesHeader = request.headers.get('cookie') || '';
    const cookieMatch = cookiesHeader.match(/geoserver_url=([^;]+)/);
    const geoserverUrl = cookieMatch ? decodeURIComponent(cookieMatch[1]) : (process.env.NEXT_PUBLIC_GEOSERVER_URL || 'http://localhost:8080/geoserver');
    const cleanUrl = geoserverUrl.replace(/\/$/, '');

    const clientCookiesHeader = request.headers.get('cookie') || '';
    let clientCookies = clientCookiesHeader;
    if (clientCookies.includes('GEOSERVER_JSESSIONID=')) {
      clientCookies = clientCookies.replace(/GEOSERVER_JSESSIONID=/g, 'JSESSIONID=');
    }

    try {
      await fetch(`${cleanUrl}/logout`, {
        method: 'GET',
        headers: {
          'Cookie': clientCookies,
        },
        signal: AbortSignal.timeout(3000),
      });
    } catch (err) {
      console.error('GeoServer session logout failed:', err);
    }

    const isProduction = process.env.NODE_ENV === 'production';
    const proto = request.headers.get('x-forwarded-proto');
    const isHttps = proto === 'https' || request.url.startsWith('https://');
    const secureAttr = (isProduction || isHttps) ? '; Secure' : '';

    const res = NextResponse.json({ success: true });

    // Cookie names to eradicate completely
    const cookieNames = [
      'refresh_token',
      'geoserver_auth',
      'geoserver_username',
      'geoserver_url',
      'GEOSERVER_JSESSIONID',
      'JSESSIONID',
    ];

    // All paths where cookies could have been scoped across app versions
    const paths = ['/', '/api/auth/token', '/api/auth', '/api'];

    for (const name of cookieNames) {
      for (const p of paths) {
        // Clear HttpOnly version
        res.headers.append(
          'Set-Cookie',
          `${name}=; Path=${p}; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax${secureAttr}`
        );
        // Clear non-HttpOnly version (for cookies set without HttpOnly)
        res.headers.append(
          'Set-Cookie',
          `${name}=; Path=${p}; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax${secureAttr}`
        );
        // Also append without Secure flag so non-HTTPS / localhost clients reliably wipe it
        if (secureAttr) {
          res.headers.append(
            'Set-Cookie',
            `${name}=; Path=${p}; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; SameSite=Lax`
          );
          res.headers.append(
            'Set-Cookie',
            `${name}=; Path=${p}; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`
          );
        }
      }
    }

    return res;
  } catch (error) {
    return NextResponse.json({ success: false }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return POST(request);
}
