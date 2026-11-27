// ============================================================================
// GeoServer Log Settings API Route (/api/geoserver/logs/settings)
//
// Persists user log inspection preferences (Auto-Sync interval & Line count)
// in the database (app_settings table) so they survive across:
// - User logout and re-login
// - Incognito windows and private browsing
// - Different browser profiles and devices
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { verifyJwt } from '@/lib/jwt';
import { getAppSetting, setAppSetting } from '@/lib/settings';

export const dynamic = 'force-dynamic';

function getAuthenticatedUsername(request: NextRequest): string {
  const authHeader = request.headers.get('Authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const decoded = verifyJwt(token);
    if (decoded?.username) {
      return String(decoded.username).toLowerCase();
    }
  }

  // Fallback to cookie
  const cookieUsername = request.cookies.get('geoserver_username')?.value;
  if (cookieUsername) {
    return cookieUsername.toLowerCase();
  }

  return 'default';
}

export async function GET(request: NextRequest) {
  try {
    const username = getAuthenticatedUsername(request);
    const userKey = `geoserver_log_settings:${username}`;
    let raw = await getAppSetting(userKey, '');

    // Fallback to global setting if per-user setting is not yet set
    if (!raw) {
      raw = await getAppSetting('geoserver_log_settings', '');
    }

    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        return NextResponse.json({
          success: true,
          autoSyncInterval: typeof parsed.autoSyncInterval === 'number' ? parsed.autoSyncInterval : 0,
          lineCount: typeof parsed.lineCount === 'number' ? parsed.lineCount : 1000,
        });
      } catch {
        // Fallback to defaults if corrupted
      }
    }

    return NextResponse.json({
      success: true,
      autoSyncInterval: 0,
      lineCount: 1000,
    });
  } catch (err: unknown) {
    console.error('[GET /api/geoserver/logs/settings] Failed to load settings:', err);
    return NextResponse.json(
      { success: false, autoSyncInterval: 0, lineCount: 1000 },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const username = getAuthenticatedUsername(request);
    const body = await request.json();

    const allowedIntervals = [0, 15, 30, 60, 120, 300, 600];
    const allowedLineCounts = [100, 300, 500, 1000];

    const autoSyncInterval =
      typeof body.autoSyncInterval === 'number' && allowedIntervals.includes(body.autoSyncInterval)
        ? body.autoSyncInterval
        : 0;

    const lineCount =
      typeof body.lineCount === 'number' && allowedLineCounts.includes(body.lineCount)
        ? body.lineCount
        : 1000;

    const payload = JSON.stringify({ autoSyncInterval, lineCount });

    // Save per-user setting and global fallback in SQLite app_settings
    const userKey = `geoserver_log_settings:${username}`;
    await setAppSetting(userKey, payload);
    await setAppSetting('geoserver_log_settings', payload);

    return NextResponse.json({
      success: true,
      autoSyncInterval,
      lineCount,
    });
  } catch (err: unknown) {
    console.error('[POST /api/geoserver/logs/settings] Failed to save settings:', err);
    return NextResponse.json(
      { success: false, message: 'Failed to save log settings.' },
      { status: 500 }
    );
  }
}
