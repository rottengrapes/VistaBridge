// ============================================================================
// Dashboards API (GET /api/dashboards & POST /api/dashboards)
//
// Manages dashboard layouts saved by users:
// - GET: Returns all dashboards created by the logged-in user
// - POST: Creates a new dashboard with widget layouts, charts, and KPIs
// All records are saved in the SQLite dashboards table.
// ============================================================================


import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { pool, initDb } from '@/lib/db';
import { verifyJwt } from '@/lib/jwt';

import { validateSlug, slugify } from '@/lib/slug';
import {
  normalizeAllowedUsers,
  isUserInAllowedList,
  getUserAssignedRole,
  AllowedUserEntry,
  normalizeAllowedRoles,
  isRoleInAllowedList,
  getRoleAssignedPermission,
  AllowedRoleEntry,
} from '@/lib/dashboardPermissions';

let dbReady: Promise<void> | null = null;
function ensureDb() {
  if (!dbReady) dbReady = initDb().catch((err) => { dbReady = null; throw err; });
  return dbReady;
}

function getUser(req: Request) {
  const h = req.headers.get('Authorization');
  if (!h?.startsWith('Bearer ')) return null;
  return verifyJwt(h.slice(7));
}

function getGeoserverUrl(req: Request, user: any): string {
  if (user?.geoserverUrl) return user.geoserverUrl;
  const cookiesHeader = req.headers.get('cookie') || '';
  const match = cookiesHeader.match(/geoserver_url=([^;]+)/);
  if (match) {
    return decodeURIComponent(match[1]).replace(/\/+$/, '');
  }
  return (process.env.NEXT_PUBLIC_GEOSERVER_URL || 'http://localhost:8080/geoserver').replace(/\/+$/, '');
}

const COLS = `id, slug, name, description, is_public, share_type, allowed_users, allowed_roles, content, tags, version, thumbnail, created_by, created_at, updated_at`;


// GET /api/dashboards
export async function GET(request: Request) {
  try {
    await ensureDb();
    const user = getUser(request);
    if (!user) return NextResponse.json({ detail: 'Unauthorized.' }, { status: 401 });

    const configuredUrl = (process.env.NEXT_PUBLIC_GEOSERVER_URL || process.env.GEOSERVER_URL || '').replace(/\/+$/, '').toLowerCase();
    const tokenUrl = (user.geoserverUrl || '').replace(/\/+$/, '').toLowerCase();
    if (configuredUrl && tokenUrl && configuredUrl !== tokenUrl) {
      return NextResponse.json({ detail: 'Active GeoServer instance changed. Please sign in again.' }, { status: 401 });
    }

    const geoserverUrl = getGeoserverUrl(request, user);
    const { rows } = await pool.query(
      `SELECT ${COLS} FROM dashboards 
       WHERE (geoserver_url = $1 OR geoserver_url = '' OR geoserver_url IS NULL OR LOWER(RTRIM(geoserver_url, '/')) = LOWER(RTRIM($1, '/')))
       ORDER BY updated_at DESC`,
      [geoserverUrl]
    );

    const userGeoRoles: string[] = Array.isArray(user.roles) && user.roles.length > 0
      ? user.roles
      : (user.role === 'ADMIN' ? ['ADMIN', 'ROLE_ADMINISTRATOR', 'ROLE_AUTHENTICATED'] : ['ROLE_AUTHENTICATED']);

    const isSystemAdmin = user.role === 'ADMIN' || user.username?.toLowerCase() === 'admin' || userGeoRoles.includes('ADMIN') || userGeoRoles.includes('ROLE_ADMINISTRATOR');

    const mapped = (rows || []).map((r: any) => {
      const allowedUsers = normalizeAllowedUsers(r.allowed_users);
      const allowedRoles = normalizeAllowedRoles(r.allowed_roles);
      const shareType = r.share_type || (r.is_public ? 'PUBLIC' : (allowedRoles.length > 0 ? 'ROLES' : (allowedUsers.length > 0 ? 'USERS' : 'PRIVATE')));
      const isOwner = Boolean(r.created_by && r.created_by.toLowerCase() === user.username.toLowerCase());
      const isAdmin = isSystemAdmin;

      const userDirectRole = getUserAssignedRole(allowedUsers, user.username);
      const userRoleFromGroup = getRoleAssignedPermission(allowedRoles, userGeoRoles);
      const effectivePermission = isOwner
        ? 'OWNER'
        : (isAdmin
            ? 'ADMIN'
            : (userDirectRole === 'EDITOR' || userRoleFromGroup === 'EDITOR'
                ? 'EDITOR'
                : (userDirectRole || userRoleFromGroup || (shareType === 'PUBLIC' ? 'VIEWER' : 'NONE'))));
      const isEditor = effectivePermission === 'EDITOR';

      return {
        ...r,
        slug: r.slug || r.id,
        share_type: shareType,
        allowed_users: allowedUsers,
        allowed_roles: allowedRoles,
        is_owner: isOwner,
        user_role: effectivePermission,
        can_edit: isOwner || isAdmin || isEditor,
      };
    });

    // In dashboard management/overview listing:
    // 1. System administrators see ALL dashboards across the workspace
    // 2. Regular users see:
    //    a. Dashboards they created (d.is_owner)
    //    b. Dashboards shared with their GeoServer roles (isRoleInAllowedList)
    //    c. Dashboards shared with their user account (share_type === 'USERS' && allowed_users includes user)
    const visible = mapped.filter((d: any) => {
      if (isSystemAdmin) return true;
      if (d.is_owner) return true;
      if (d.share_type === 'USERS' && isUserInAllowedList(d.allowed_users, user.username)) return true;
      if (isRoleInAllowedList(d.allowed_roles, userGeoRoles)) return true;
      return false;
    });

    return NextResponse.json(visible);
  } catch (err) {
    console.error('[GET /dashboards]', err);
    return NextResponse.json({ detail: 'Internal server error.' }, { status: 500 });
  }
}

// POST /api/dashboards
export async function POST(request: Request) {
  try {
    await ensureDb();
    const user = getUser(request);
    if (!user) return NextResponse.json({ detail: 'Unauthorized.' }, { status: 401 });

    const configuredUrl = (process.env.NEXT_PUBLIC_GEOSERVER_URL || process.env.GEOSERVER_URL || '').replace(/\/+$/, '').toLowerCase();
    const tokenUrl = (user.geoserverUrl || '').replace(/\/+$/, '').toLowerCase();
    if (configuredUrl && tokenUrl && configuredUrl !== tokenUrl) {
      return NextResponse.json({ detail: 'Active GeoServer instance changed. Please sign in again.' }, { status: 401 });
    }

    const body = await request.json();
    const { name, slug, description, is_public, share_type, allowed_users, allowed_roles, content, tags, thumbnail } = body;
    if (!name?.trim()) return NextResponse.json({ detail: 'name is required.' }, { status: 400 });

    let finalSlug = '';
    if (typeof slug === 'string' && slug.trim()) {
      const validation = validateSlug(slug, 'dashboard');
      if (!validation.valid) {
        return NextResponse.json({ detail: validation.error }, { status: 400 });
      }
      finalSlug = validation.cleaned!;

      const existing = await pool.query('SELECT id FROM dashboards WHERE LOWER(slug) = LOWER($1)', [finalSlug]);
      if (existing.rows.length > 0) {
        return NextResponse.json(
          { detail: `Slug "${finalSlug}" is already taken. Please choose another unique slug.` },
          { status: 409 }
        );
      }
    } else {
      const baseSlug = slugify(name.trim()) || 'dashboard';
      const existingRes = await pool.query("SELECT slug FROM dashboards WHERE slug IS NOT NULL AND TRIM(slug) != ''");
      const usedSlugs = new Set((existingRes.rows || []).map((r: any) => String(r.slug).toLowerCase()));

      let candidate = baseSlug;
      let counter = 1;
      while (usedSlugs.has(candidate.toLowerCase())) {
        candidate = `${baseSlug}_${counter++}`;
      }
      finalSlug = candidate;
    }

    const tagsArr = Array.isArray(tags)
      ? `{${tags.map((t: string) => `"${t.replace(/"/g, '\\"')}"`).join(',')}}`
      : '{}';

    const finalShareType = share_type || (is_public ? 'PUBLIC' : 'PRIVATE');
    const normalizedAllowedUsers = normalizeAllowedUsers(allowed_users);
    const finalAllowedUsers = JSON.stringify(normalizedAllowedUsers);
    const finalAllowedRoles = JSON.stringify(normalizeAllowedRoles(allowed_roles));
    const finalIsPublic = finalShareType === 'PUBLIC' || Boolean(is_public) ? 1 : 0;

    const id = crypto.randomUUID();
    const geoserverUrl = getGeoserverUrl(request, user);
    const now = new Date().toISOString();
    const { rows } = await pool.query(
      `INSERT INTO dashboards (id, slug, name, description, is_public, share_type, allowed_users, allowed_roles, content, tags, thumbnail, created_by, geoserver_url, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::text[], $11, $12, $13, $14, $15)
       RETURNING ${COLS}`,
      [
        id,
        finalSlug,
        name.trim(),
        description ?? '',
        finalIsPublic,
        finalShareType,
        finalAllowedUsers,
        finalAllowedRoles,
        JSON.stringify(content ?? { widgets: [] }),
        tagsArr,
        thumbnail ?? null,
        user.username,
        geoserverUrl,
        now,
        now,
      ]
    );
    const created = {
      ...rows[0],
      slug: rows[0].slug || finalSlug,
      share_type: finalShareType,
      allowed_users: normalizedAllowedUsers,
      allowed_roles: Array.isArray(allowed_roles) ? allowed_roles : [],
      created_at: rows[0].created_at || now,
      updated_at: rows[0].updated_at || now,
      is_owner: true,
      can_edit: true,
      user_role: 'OWNER',
    };
    return NextResponse.json(created, { status: 201 });
  } catch (err) {
    console.error('[POST /dashboards]', err);
    return NextResponse.json({ detail: 'Internal server error.' }, { status: 500 });
  }
}
