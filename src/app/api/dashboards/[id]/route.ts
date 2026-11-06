// ============================================================================
// Single Dashboard API Route (/api/dashboards/[id])
//
// Manages individual dashboard records in SQLite:
// - GET: Retrieves the saved dashboard canvas layout, widget configurations,
//        and tags. Allows public viewing if marked as `is_public`.
// - PUT: Saves layout changes, repositioned widgets, or updated settings.
// - DELETE: Removes the dashboard from the database (creator/admin only).
// ============================================================================

import { NextResponse } from 'next/server';
import { pool, initDb } from '@/lib/db';
import { verifyJwt } from '@/lib/jwt';
import { validateSlug, slugify } from '@/lib/slug';
import {
  normalizeAllowedUsers,
  isUserInAllowedList,
  getUserAssignedRole,
  normalizeAllowedRoles,
  isRoleInAllowedList,
  getRoleAssignedPermission,
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

const COLS = `id, slug, name, description, is_public, share_type, allowed_users, allowed_roles, content, tags, version, thumbnail, created_by, geoserver_url, refresh_interval, created_at, updated_at`;

type Ctx = { params: Promise<{ id: string }> };

// GET /api/dashboards/[id]
export async function GET(req: Request, ctx: Ctx) {
  try {
    await ensureDb();
    const user = getUser(req);
    const { id } = await ctx.params;
    if (!id) {
      return NextResponse.json({ detail: 'ID parameter is required.' }, { status: 400 });
    }

    const { rows } = await pool.query(
      `SELECT ${COLS} FROM dashboards WHERE id = $1 OR LOWER(slug) = LOWER($1)`,
      [id]
    );
    if (!rows.length) {
      return NextResponse.json({ detail: `Dashboard "${id}" not found.` }, { status: 404 });
    }

    const row = rows[0];
    const allowedUsers = normalizeAllowedUsers(row.allowed_users);
    const allowedRoles = normalizeAllowedRoles(row.allowed_roles);
    const shareType = row.share_type || (row.is_public ? 'PUBLIC' : (allowedRoles.length > 0 ? 'ROLES' : (allowedUsers.length > 0 ? 'USERS' : 'PRIVATE')));

    let parsedContent = row.content;
    try {
      if (typeof parsedContent === 'string') parsedContent = JSON.parse(parsedContent);
    } catch {}

    const dashboard = {
      ...row,
      slug: row.slug || row.id,
      share_type: shareType,
      allowed_users: allowedUsers,
      allowed_roles: allowedRoles,
      refresh_interval: Number(row.refresh_interval) || (parsedContent?.refreshInterval ? Number(parsedContent.refreshInterval) : 0),
    };

    const isPublic = shareType === 'PUBLIC' || Boolean(row.is_public);
    const userGeoRoles: string[] = Array.isArray(user?.roles) && user.roles.length > 0
      ? user.roles
      : (user?.role === 'ADMIN' ? ['ADMIN', 'ROLE_ADMINISTRATOR', 'ROLE_AUTHENTICATED'] : ['ROLE_AUTHENTICATED']);
    const isAdmin = Boolean(user && (user.role === 'ADMIN' || user.username?.toLowerCase() === 'admin' || userGeoRoles.includes('ADMIN') || userGeoRoles.includes('ROLE_ADMINISTRATOR')));

    // Enforce authentication & authorization for non-public dashboards
    if (!isPublic) {
      if (!user) {
        return NextResponse.json({ detail: 'Authentication credentials were not provided.' }, { status: 401 });
      }

      const isOwner = Boolean(dashboard.created_by && dashboard.created_by.toLowerCase() === user.username.toLowerCase());

      if (!isOwner && !isAdmin) {
        const hasDirectUserAccess = isUserInAllowedList(allowedUsers, user.username);
        const hasRoleAccess = isRoleInAllowedList(allowedRoles, userGeoRoles);

        if (!hasDirectUserAccess && !hasRoleAccess) {
          return NextResponse.json(
            { detail: 'Access Denied: You do not have the required GeoServer role or user permission to view this dashboard.' },
            { status: 403 }
          );
        }
      }
    }

    const isOwner = Boolean(user?.username && dashboard.created_by && dashboard.created_by.toLowerCase() === user.username.toLowerCase());
    const userDirectRole = user?.username ? getUserAssignedRole(allowedUsers, user.username) : null;
    const userRoleFromGroup = user ? getRoleAssignedPermission(allowedRoles, userGeoRoles) : null;
    const effectivePermission = isOwner
      ? 'OWNER'
      : (isAdmin
          ? 'ADMIN'
          : (userDirectRole === 'EDITOR' || userRoleFromGroup === 'EDITOR'
              ? 'EDITOR'
              : (userDirectRole || userRoleFromGroup || (isPublic ? 'VIEWER' : 'NONE'))));
    const canEdit = isOwner || isAdmin || effectivePermission === 'EDITOR';

    return NextResponse.json({
      ...dashboard,
      is_owner: isOwner,
      user_role: effectivePermission,
      can_edit: canEdit,
    });
  } catch (err) {
    console.error('[GET /dashboards/:id]', err);
    return NextResponse.json({ detail: 'Internal server error.' }, { status: 500 });
  }
}

// PUT /api/dashboards/[id] — full save
export async function PUT(req: Request, ctx: Ctx) {
  try {
    await ensureDb();
    const user = getUser(req);
    if (!user) return NextResponse.json({ detail: 'Unauthorized.' }, { status: 401 });
    const { id } = await ctx.params;
    if (!id) return NextResponse.json({ detail: 'ID parameter is required.' }, { status: 400 });

    let body: any;
    try { body = await req.json(); }
    catch { return NextResponse.json({ detail: 'Invalid JSON body.' }, { status: 400 }); }

    const { name, slug, description, is_public, share_type, allowed_users, allowed_roles, content, tags, thumbnail, refresh_interval } = body;
    if (!content || !Array.isArray(content.widgets)) {
      return NextResponse.json({ detail: 'content.widgets array is required.' }, { status: 400 });
    }

    const check = await pool.query(
      'SELECT id, slug, created_by, allowed_users, share_type, is_public FROM dashboards WHERE id = $1 OR LOWER(slug) = LOWER($1)',
      [id]
    );
    if (!check.rows.length) {
      return NextResponse.json({
        detail: `Dashboard "${id}" not found.`,
      }, { status: 404 });
    }

    const existing = check.rows[0];
    const internalId = existing.id;
    const isOwner = Boolean(existing.created_by && existing.created_by.toLowerCase() === user.username.toLowerCase());
    const userGeoRoles: string[] = Array.isArray(user.roles) && user.roles.length > 0
      ? user.roles
      : (user.role === 'ADMIN' ? ['ADMIN', 'ROLE_ADMINISTRATOR', 'ROLE_AUTHENTICATED'] : ['ROLE_AUTHENTICATED']);
    const isAdmin = Boolean(user && (user.role === 'ADMIN' || user.username?.toLowerCase() === 'admin' || userGeoRoles.includes('ADMIN') || userGeoRoles.includes('ROLE_ADMINISTRATOR')));
    const allowedUsers = normalizeAllowedUsers(existing.allowed_users);
    const userRole = getUserAssignedRole(allowedUsers, user.username);
    const isEditor = userRole === 'EDITOR';
    const allowedRoles = normalizeAllowedRoles(existing.allowed_roles);
    const isRoleEditor = getRoleAssignedPermission(allowedRoles, userGeoRoles) === 'EDITOR';

    if (!isOwner && !isAdmin && !isEditor && !isRoleEditor) {
      return NextResponse.json({
        detail: 'You do not have permission to modify this dashboard. You have view-only access.',
      }, { status: 403 });
    }

    let updatedSlug = existing.slug;
    if (slug !== undefined) {
      const validation = validateSlug(slug, 'dashboard');
      if (!validation.valid) {
        return NextResponse.json({ detail: validation.error }, { status: 400 });
      }
      const newSlug = validation.cleaned!;
      const conflict = await pool.query(
        'SELECT id FROM dashboards WHERE LOWER(slug) = LOWER($1) AND id != $2',
        [newSlug, internalId]
      );
      if (conflict.rows.length > 0) {
        return NextResponse.json(
          { detail: `Slug "${newSlug}" is already taken.` },
          { status: 409 }
        );
      }
      updatedSlug = newSlug;
    } else if (name !== undefined && typeof name === 'string' && name.trim() && name.trim() !== existing.name) {
      // Auto-update slug on rename
      const baseSlug = slugify(name.trim()) || 'dashboard';
      const existingRes = await pool.query(
        "SELECT slug FROM dashboards WHERE slug IS NOT NULL AND TRIM(slug) != '' AND id != $1",
        [internalId]
      );
      const usedSlugs = new Set((existingRes.rows || []).map((r: any) => String(r.slug).toLowerCase()));
      let candidate = baseSlug;
      let counter = 1;
      while (usedSlugs.has(candidate.toLowerCase())) {
        candidate = `${baseSlug}_${counter++}`;
      }
      updatedSlug = candidate;
    }

    const tagsArr = Array.isArray(tags)
      ? `{${tags.map((t: string) => `"${t.replace(/"/g, '\\"')}"`).join(',')}}`
      : null;

    const canManageSettings = isOwner || isAdmin;
    const finalName = canManageSettings ? (name ?? null) : null;
    const finalSlugParam = canManageSettings ? (updatedSlug ?? null) : null;
    const finalDescription = canManageSettings ? (description ?? null) : null;
    const finalShareType = canManageSettings
      ? (share_type !== undefined ? share_type : (is_public ? 'PUBLIC' : undefined))
      : undefined;
    const finalAllowedUsers = canManageSettings && allowed_users != null
      ? JSON.stringify(normalizeAllowedUsers(allowed_users))
      : undefined;
    const finalAllowedRoles = canManageSettings && allowed_roles != null
      ? JSON.stringify(normalizeAllowedRoles(allowed_roles))
      : undefined;
    const finalIsPublic = canManageSettings
      ? (finalShareType === 'PUBLIC' ? 1 : (finalShareType ? 0 : (is_public != null ? (is_public ? 1 : 0) : null)))
      : null;

    const finalRefreshInterval = refresh_interval !== undefined ? Number(refresh_interval) : (content?.refreshInterval !== undefined ? Number(content.refreshInterval) : null);

    const now = new Date().toISOString();
    const { rows } = await pool.query(
      `UPDATE dashboards
          SET name             = COALESCE($1, name),
               slug             = COALESCE($2, slug),
               description      = COALESCE($3, description),
               is_public        = COALESCE($4, is_public),
               share_type       = COALESCE($5, share_type),
               allowed_users    = COALESCE($6, allowed_users),
               allowed_roles    = COALESCE($7, allowed_roles),
               content          = $8::jsonb,
               tags             = COALESCE($9::text[], tags),
               thumbnail        = COALESCE($10, thumbnail),
               refresh_interval = COALESCE($11, refresh_interval),
               version          = version + 1,
               updated_at       = $12
         WHERE id = $13
         RETURNING ${COLS}`,
      [
        finalName,
        finalSlugParam,
        finalDescription,
        finalIsPublic,
        finalShareType ?? null,
        finalAllowedUsers ?? null,
        finalAllowedRoles ?? null,
        JSON.stringify(content),
        tagsArr,
        thumbnail ?? null,
        finalRefreshInterval,
        now,
        internalId,
      ]
    );
    return NextResponse.json({ ...rows[0], slug: rows[0].slug || rows[0].id });
  } catch (err) {
    console.error('[PUT /dashboards/:id]', err);
    return NextResponse.json({ detail: 'Internal server error.' }, { status: 500 });
  }
}

// PATCH /api/dashboards/[id] — partial update
export async function PATCH(req: Request, ctx: Ctx) {
  try {
    await ensureDb();
    const user = getUser(req);
    if (!user) return NextResponse.json({ detail: 'Unauthorized.' }, { status: 401 });
    const { id } = await ctx.params;
    if (!id) return NextResponse.json({ detail: 'ID parameter is required.' }, { status: 400 });

    let body: any;
    try { body = await req.json(); }
    catch { return NextResponse.json({ detail: 'Invalid JSON body.' }, { status: 400 }); }

    const check = await pool.query(
      'SELECT id, slug, created_by FROM dashboards WHERE id = $1 OR LOWER(slug) = LOWER($1)',
      [id]
    );
    if (!check.rows.length) {
      return NextResponse.json({ detail: `Dashboard "${id}" not found.` }, { status: 404 });
    }

    const existing = check.rows[0];
    const internalId = existing.id;
    const isOwner = Boolean(existing.created_by && existing.created_by.toLowerCase() === user.username.toLowerCase());
    const userGeoRoles: string[] = Array.isArray(user?.roles) && user.roles.length > 0
      ? user.roles
      : (user?.role === 'ADMIN' ? ['ADMIN', 'ROLE_ADMINISTRATOR', 'ROLE_AUTHENTICATED'] : ['ROLE_AUTHENTICATED']);
    const isAdmin = Boolean(user && (user.role === 'ADMIN' || user.username?.toLowerCase() === 'admin' || userGeoRoles.includes('ADMIN') || userGeoRoles.includes('ROLE_ADMINISTRATOR')));

    if (!isOwner && !isAdmin) {
      return NextResponse.json({ detail: 'You do not have permission to update this dashboard.' }, { status: 403 });
    }

    const sets: string[] = [];
    const vals: any[] = [];
    let i = 1;

    if (body.name != null) { sets.push(`name=$${i++}`); vals.push(body.name); }
    if (body.slug != null) {
      const validation = validateSlug(body.slug, 'dashboard');
      if (!validation.valid) {
        return NextResponse.json({ detail: validation.error }, { status: 400 });
      }
      const newSlug = validation.cleaned!;
      const conflict = await pool.query(
        'SELECT id FROM dashboards WHERE LOWER(slug) = LOWER($1) AND id != $2',
        [newSlug, internalId]
      );
      if (conflict.rows.length > 0) {
        return NextResponse.json({ detail: `Slug "${newSlug}" is already taken.` }, { status: 409 });
      }
      sets.push(`slug=$${i++}`);
      vals.push(newSlug);
    } else if (body.name != null && typeof body.name === 'string' && body.name.trim() && body.name.trim() !== existing.name) {
      // Auto-update slug on rename
      const baseSlug = slugify(body.name.trim()) || 'dashboard';
      const existingRes = await pool.query(
        "SELECT slug FROM dashboards WHERE slug IS NOT NULL AND TRIM(slug) != '' AND id != $1",
        [internalId]
      );
      const usedSlugs = new Set((existingRes.rows || []).map((r: any) => String(r.slug).toLowerCase()));
      let candidate = baseSlug;
      let counter = 1;
      while (usedSlugs.has(candidate.toLowerCase())) {
        candidate = `${baseSlug}_${counter++}`;
      }
      sets.push(`slug=$${i++}`);
      vals.push(candidate);
    }
    if (body.description != null) { sets.push(`description=$${i++}`); vals.push(body.description); }
    if (body.share_type != null) {
      sets.push(`share_type=$${i++}`);
      vals.push(body.share_type);
      sets.push(`is_public=$${i++}`);
      vals.push(body.share_type === 'PUBLIC' ? 1 : 0);
    } else if (body.is_public != null) {
      sets.push(`is_public=$${i++}`);
      vals.push(body.is_public ? 1 : 0);
      sets.push(`share_type=$${i++}`);
      vals.push(body.is_public ? 'PUBLIC' : 'PRIVATE');
    }
    if (body.allowed_users != null) {
      sets.push(`allowed_users=$${i++}`);
      vals.push(JSON.stringify(normalizeAllowedUsers(body.allowed_users)));
    }
    if (body.allowed_roles != null) {
      sets.push(`allowed_roles=$${i++}`);
      vals.push(JSON.stringify(normalizeAllowedRoles(body.allowed_roles)));
    }
    if (body.content != null) { sets.push(`content=$${i++}::jsonb`); vals.push(JSON.stringify(body.content)); }
    if (body.thumbnail != null) { sets.push(`thumbnail=$${i++}`); vals.push(body.thumbnail); }
    if (Array.isArray(body.tags)) {
      sets.push(`tags=$${i++}::text[]`);
      vals.push(`{${body.tags.map((t: string) => `"${t.replace(/"/g, '\\"')}"`).join(',')}}`);
    }

    if (!sets.length) return NextResponse.json({ detail: 'No fields to update.' }, { status: 400 });
    const now = new Date().toISOString();
    sets.push(`version=version+1`, `updated_at=$${i++}`);
    vals.push(now);
    vals.push(internalId);

    const { rows } = await pool.query(
      `UPDATE dashboards SET ${sets.join(',')} WHERE id=$${i++} RETURNING ${COLS}`,
      vals
    );
    if (!rows.length) return NextResponse.json({ detail: 'Not found.' }, { status: 404 });
    return NextResponse.json({ ...rows[0], slug: rows[0].slug || rows[0].id });
  } catch (err) {
    console.error('[PATCH /dashboards/:id]', err);
    return NextResponse.json({ detail: 'Internal server error.' }, { status: 500 });
  }
}

// DELETE /api/dashboards/[id]
export async function DELETE(req: Request, ctx: Ctx) {
  try {
    await ensureDb();
    const user = getUser(req);
    if (!user) return NextResponse.json({ detail: 'Unauthorized.' }, { status: 401 });
    const { id } = await ctx.params;
    if (!id) return NextResponse.json({ detail: 'ID parameter is required.' }, { status: 400 });

    const check = await pool.query(
      'SELECT id, created_by FROM dashboards WHERE id = $1 OR LOWER(slug) = LOWER($1)',
      [id]
    );
    if (!check.rows.length) {
      return NextResponse.json({ detail: `Dashboard "${id}" not found.` }, { status: 404 });
    }

    const existing = check.rows[0];
    const isOwner = Boolean(existing.created_by && existing.created_by.toLowerCase() === user.username.toLowerCase());
    const userGeoRoles: string[] = Array.isArray(user?.roles) && user.roles.length > 0
      ? user.roles
      : (user?.role === 'ADMIN' ? ['ADMIN', 'ROLE_ADMINISTRATOR', 'ROLE_AUTHENTICATED'] : ['ROLE_AUTHENTICATED']);
    const isAdmin = Boolean(user && (user.role === 'ADMIN' || user.username?.toLowerCase() === 'admin' || userGeoRoles.includes('ADMIN') || userGeoRoles.includes('ROLE_ADMINISTRATOR')));

    if (!isOwner && !isAdmin) {
      return NextResponse.json({ detail: 'You do not have permission to delete this dashboard.' }, { status: 403 });
    }

    const { rowCount } = await pool.query(
      'DELETE FROM dashboards WHERE id=$1',
      [existing.id]
    );
    if (!rowCount) return NextResponse.json({ detail: 'Not found.' }, { status: 404 });
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error('[DELETE /dashboards/:id]', err);
    return NextResponse.json({ detail: 'Internal server error.' }, { status: 500 });
  }
}
