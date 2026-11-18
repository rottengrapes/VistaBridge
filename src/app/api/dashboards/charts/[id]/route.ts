// ============================================================================
// Single Dashboard Chart Delete Route (/api/dashboards/charts/[id])
//
// Removes a saved chart widget definition from SQLite by its ID (creator only).
// ============================================================================

import { NextResponse } from 'next/server';
import { pool, initDb } from '@/lib/db';
import { verifyJwt } from '@/lib/jwt';

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
    return decodeURIComponent(match[1]).replace(/\/$/, '');
  }
  return (process.env.NEXT_PUBLIC_GEOSERVER_URL || '').replace(/\/$/, '');
}

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/dashboards/charts/[id]
export async function PATCH(req: Request, ctx: Ctx) {
  try {
    await ensureDb();
    const user = getUser(req);
    if (!user) return NextResponse.json({ detail: 'Unauthorized.' }, { status: 401 });
    const { id } = await ctx.params;
    const geoserverUrl = getGeoserverUrl(req, user);

    const body = await req.json();
    const { title, chart_type, config } = body;

    const fields: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (typeof title === 'string' && title.trim()) {
      fields.push(`title = $${idx++}`);
      params.push(title.trim().slice(0, 32));
    }
    if (typeof chart_type === 'string' && chart_type.trim()) {
      fields.push(`chart_type = $${idx++}`);
      params.push(chart_type.trim());
    }
    if (config !== undefined) {
      fields.push(`config = $${idx++}`);
      params.push(JSON.stringify(config));
    }

    if (fields.length === 0) {
      return NextResponse.json({ detail: 'No fields to update.' }, { status: 400 });
    }

    params.push(id, user.username, geoserverUrl);
    const q = `UPDATE dashboard_charts SET ${fields.join(', ')} WHERE id = $${idx++} AND created_by = $${idx++} AND geoserver_url = $${idx++} RETURNING id, title, chart_type, config, created_at`;
    const { rows } = await pool.query(q, params);
    if (!rows.length) {
      return NextResponse.json({ detail: 'Chart not found or unauthorized.' }, { status: 404 });
    }
    return NextResponse.json(rows[0]);
  } catch (err) {
    console.error('[PATCH /dashboards/charts/:id]', err);
    return NextResponse.json({ detail: 'Internal server error.' }, { status: 500 });
  }
}

// DELETE /api/dashboards/charts/[id]
export async function DELETE(req: Request, ctx: Ctx) {
  try {
    await ensureDb();
    const user = getUser(req);
    if (!user) return NextResponse.json({ detail: 'Unauthorized.' }, { status: 401 });
    const { id } = await ctx.params;
    const geoserverUrl = getGeoserverUrl(req, user);

    const { rowCount } = await pool.query(
      'DELETE FROM dashboard_charts WHERE id = $1 AND created_by = $2 AND geoserver_url = $3',
      [id, user.username, geoserverUrl]
    );
    if (!rowCount) return NextResponse.json({ detail: 'Not found.' }, { status: 404 });
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error('[DELETE /dashboards/charts/:id]', err);
    return NextResponse.json({ detail: 'Internal server error.' }, { status: 500 });
  }
}
