// ============================================================================
// GeoServer Logs API Route (GET /api/geoserver/logs)
//
// Fetches live server logs directly from GeoServer over HTTP.
// 100% network-based — no local filesystem paths are used.
//
// Flow:
// 1. Authenticates against GeoServer Spring Security (/j_spring_security_check)
// 2. Acquires session cookie (JSESSIONID)
// 3. Fetches live console from:
//    /web/wicket/bookmarkable/org.geoserver.web.admin.LogPage?filter=false
// 4. Extracts <textarea id="log"> content and parses into structured entries
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { resolveInternalGeoServerUrl } from '@/lib/geoserver';
import { getAppSetting } from '@/lib/settings';
import { parseGeoServerLogs, ParseLogsResult } from '@/lib/gis/logParser';

function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Connects to GeoServer Web Admin over HTTP, authenticates via Spring Security,
 * and extracts the live log text from the LogPage HTML.
 */
async function fetchLogsFromGeoServerHttp(
  geoserverBase: string,
  username?: string,
  password?: string
): Promise<{ success: boolean; logText?: string; source?: string; error?: string }> {
  try {
    const cleanBase = geoserverBase.replace(/\/+$/, '');
    const urlObj = new URL(cleanBase);
    const origin = urlObj.origin;

    let sessionCookie = '';

    // Step 1: Authenticate via /j_spring_security_check
    if (username && password) {
      const loginPayload = `username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
      const loginRes = await fetch(`${cleanBase}/j_spring_security_check`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(loginPayload).toString(),
          'Origin': origin,
          'Referer': `${cleanBase}/web/`,
        },
        body: loginPayload,
        redirect: 'manual',
        signal: AbortSignal.timeout(8000),
      });

      // Extract JSESSIONID from Set-Cookie headers
      let setCookies: string[] = [];
      if (typeof loginRes.headers.getSetCookie === 'function') {
        setCookies = loginRes.headers.getSetCookie();
      } else {
        const raw = loginRes.headers.get('set-cookie');
        if (raw) setCookies = [raw];
      }

      for (const cookieStr of setCookies) {
        const match = cookieStr.match(/JSESSIONID=([^;]+)/i);
        if (match) {
          sessionCookie = `JSESSIONID=${match[1]}`;
          break;
        }
      }
    }

    // Step 2: Query the LogPage
    const logPageUrl = `${cleanBase}/web/wicket/bookmarkable/org.geoserver.web.admin.LogPage?filter=false`;
    const reqHeaders: Record<string, string> = {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) VistaBridge/1.0',
      'Referer': `${cleanBase}/web/`,
    };

    if (sessionCookie) {
      reqHeaders['Cookie'] = sessionCookie;
    }
    if (username && password) {
      reqHeaders['Authorization'] = `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;
    }

    const logPageRes = await fetch(logPageUrl, {
      method: 'GET',
      headers: reqHeaders,
      redirect: 'follow',
      signal: AbortSignal.timeout(10000),
    });

    if (!logPageRes.ok) {
      return {
        success: false,
        error: `GeoServer returned HTTP ${logPageRes.status} from ${logPageUrl}`,
      };
    }

    const html = await logPageRes.text();

    // Check if GeoServer redirected to login page due to unauthenticated session
    if (html.includes('GeoServerLoginPage') && !html.includes('id="log"') && !html.includes('name="log"')) {
      return {
        success: false,
        error: `GeoServer session authentication failed for ${username || 'admin'}. Please verify credentials.`,
      };
    }

    // Step 3: Extract the log content from <textarea ...>
    const textareaMatch =
      html.match(/<textarea[^>]*id=["']log["'][^>]*>([\s\S]*?)<\/textarea>/i) ||
      html.match(/<textarea[^>]*name=["']log["'][^>]*>([\s\S]*?)<\/textarea>/i) ||
      html.match(/<textarea[^>]*wicket:id=["']log["'][^>]*>([\s\S]*?)<\/textarea>/i) ||
      html.match(/<textarea[^>]*>([\s\S]*?)<\/textarea>/i);

    if (textareaMatch && textareaMatch[1]) {
      const decodedText = decodeHtmlEntities(textareaMatch[1]).trim();
      return {
        success: true,
        logText: decodedText,
        source: logPageUrl,
      };
    }

    return {
      success: false,
      error: 'Could not find the log console <textarea> in GeoServer LogPage HTML.',
    };
  } catch (err: any) {
    return {
      success: false,
      error: `Error communicating with GeoServer over HTTP: ${err?.message || 'Connection timeout'}`,
    };
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const linesParam = parseInt(searchParams.get('lines') || '300', 10);
    const maxLines = Math.min(Math.max(linesParam || 300, 50), 2000);

    const cookieStore = await cookies();

    // 1. Resolve GeoServer Base URL (Priority: x-geoserver-url header > cookie > database app_settings > env > default)
    const customHeaderUrl = req.headers.get('x-geoserver-url');
    const geoserverUrlCookie = cookieStore.get('geoserver_url')?.value;
    const dbGeoserverUrl = await getAppSetting('geoserver_url', '');
    const configuredBase = (
      process.env.NEXT_PUBLIC_GEOSERVER_URL ||
      process.env.GEOSERVER_URL ||
      ''
    ).replace(/\/+$/, '');
    const rawBase =
      customHeaderUrl ||
      geoserverUrlCookie ||
      dbGeoserverUrl ||
      configuredBase ||
      'http://localhost:8080/geoserver';
    const geoserverBase = resolveInternalGeoServerUrl(rawBase);

    // 2. Resolve Credentials
    const authFromHeader = req.headers.get('authorization');
    const authFromCookie = cookieStore.get('geoserver_auth')?.value;
    const geoserverAuth =
      authFromHeader ||
      authFromCookie ||
      process.env.GEOSERVER_AUTH ||
      `Basic ${Buffer.from(
        `${process.env.GEOSERVER_USERNAME || 'admin'}:${process.env.GEOSERVER_PASSWORD || 'geoserver'}`
      ).toString('base64')}`;

    let username = process.env.GEOSERVER_USERNAME || 'admin';
    let password = process.env.GEOSERVER_PASSWORD || 'geoserver';

    if (geoserverAuth && geoserverAuth.startsWith('Basic ')) {
      try {
        const decoded = Buffer.from(geoserverAuth.slice(6).trim(), 'base64').toString('utf8');
        const colonIdx = decoded.indexOf(':');
        if (colonIdx !== -1) {
          username = decoded.substring(0, colonIdx);
          password = decoded.substring(colonIdx + 1);
        }
      } catch {
        // Fallback to defaults
      }
    }

    // 3. Connect directly over HTTP to GeoServer LogPage
    const webResult = await fetchLogsFromGeoServerHttp(geoserverBase, username, password);

    if (!webResult.success || !webResult.logText) {
      return NextResponse.json({
        success: false,
        message:
          webResult.error ||
          `Could not connect to GeoServer LogPage at ${geoserverBase}. Please verify that GeoServer is reachable.`,
        totalLines: 0,
        source: geoserverBase,
        counts: { ALL: 0, ERROR: 0, WARN: 0, INFO: 0, DEBUG: 0, TRACE: 0 },
        logs: [],
      });
    }

    // 4. Tail trimming if lines requested is less than total output
    const allLines = webResult.logText.split(/\r?\n/);
    const trimmedText = allLines.length > maxLines ? allLines.slice(-maxLines).join('\n') : webResult.logText;

    // 5. Parse into structured log entries
    const { entries, counts }: ParseLogsResult = parseGeoServerLogs(trimmedText);

    return NextResponse.json({
      success: true,
      source: webResult.source,
      totalLines: allLines.length,
      entriesCount: entries.length,
      counts,
      logs: entries,
    });
  } catch (error: any) {
    console.error('Error in /api/geoserver/logs:', error);
    return NextResponse.json(
      {
        success: false,
        message: error?.message || 'Failed to fetch GeoServer logs',
        totalLines: 0,
        source: 'Error',
        counts: { ALL: 0, ERROR: 0, WARN: 0, INFO: 0, DEBUG: 0, TRACE: 0 },
        logs: [],
      },
      { status: 500 }
    );
  }
}
