// ============================================================================
// Users Listing API Route (/api/auth/users)
//
// Returns a list of distinct users for selection in dashboard/map sharing modals.
// Requires authentication.
// ============================================================================

import { NextResponse } from 'next/server';
import { verifyJwt } from '@/lib/jwt';
import { pool, initDb } from '@/lib/db';

function getAuthUser(request: Request) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.substring(7);
  return verifyJwt(token);
}

export async function GET(request: Request) {
  try {
    await initDb();
    const user = getAuthUser(request);
    if (!user) {
      return NextResponse.json({ detail: 'Authentication credentials were not provided.' }, { status: 401 });
    }

    const { rows } = await pool.query(`
      SELECT DISTINCT 
        username, 
        COALESCE(first_name, '') as first_name, 
        COALESCE(last_name, '') as last_name, 
        COALESCE(email, '') as email, 
        COALESCE(role, 'MEMBER') as role
      FROM user_profiles 
      ORDER BY username ASC
    `);

    // Ensure the current user is always included if user_profiles is initially sparse
    const userMap = new Map<string, { username: string; first_name: string; last_name: string; email: string; role: string }>();
    for (const r of rows) {
      if (r.username) {
        userMap.set(r.username.toLowerCase(), {
          username: r.username,
          first_name: r.first_name || '',
          last_name: r.last_name || '',
          email: r.email || '',
          role: r.role || 'MEMBER',
        });
      }
    }

    const { searchParams } = new URL(request.url);
    const excludeCurrent = searchParams.get('exclude_current') === 'true';
    const includeAdmin = searchParams.get('include_admin') === 'true';

    if (excludeCurrent && user.username) {
      userMap.delete(user.username.toLowerCase());
    } else if (user.username && !userMap.has(user.username.toLowerCase())) {
      userMap.set(user.username.toLowerCase(), {
        username: user.username,
        first_name: '',
        last_name: '',
        email: '',
        role: user.role || 'MEMBER',
      });
    }

    let result = Array.from(userMap.values()).map((u) => {
      const base = { ...u, email: '' };
      if (u.username.toLowerCase() === 'admin') {
        return { ...base, first_name: '', last_name: '' };
      }
      return base;
    });

    return NextResponse.json(result);
  } catch (err: unknown) {
    console.error('[GET /api/auth/users]', err);
    return NextResponse.json({ detail: 'Failed to load users' }, { status: 500 });
  }
}
