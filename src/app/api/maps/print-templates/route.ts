// ============================================================================
// Map Print Templates API Route (/api/maps/print-templates)
//
// In GIS mapping, users customize print layout templates (arranging map canvas,
// title, office details, legend swatches, scale bar, north arrow, and footer).
//
// This route saves, retrieves, and manages custom print templates so users and
// admins can reuse them across all map workspaces.
//
// Methods:
// - GET: Retrieves all saved print templates (accessible across all workspaces)
// - POST: Saves or updates a custom print template
// - DELETE: Removes a saved print template by id
// ============================================================================

import { NextResponse } from 'next/server';
import { pool, initDb } from '@/lib/db';

let dbInitialized = false;
async function ensureDb() {
  if (!dbInitialized) {
    await initDb();
    dbInitialized = true;
  }
}

export async function GET(request: Request) {
  try {
    await ensureDb();
    // Return all saved print templates so they are accessible across all map workspaces
    const result = await pool.query(
      `SELECT id, map_id, name, layout, page_size, dpi, positions, styles, page_elements, created_by, created_at, updated_at 
       FROM map_print_templates 
       ORDER BY created_at ASC`
    );

    const templates = result.rows.map((row: any) => {
      let positions = row.positions;
      let styles = row.styles;
      let pageElements = row.page_elements;

      try {
        if (typeof positions === 'string') positions = JSON.parse(positions);
      } catch {}
      try {
        if (typeof styles === 'string') styles = JSON.parse(styles);
      } catch {}
      try {
        if (typeof pageElements === 'string') pageElements = JSON.parse(pageElements);
      } catch {}

      return {
        id: row.id,
        mapId: row.map_id || null,
        name: row.name,
        layout: row.layout,
        pageSize: row.page_size,
        dpi: Number(row.dpi) || 150,
        positions: positions || {},
        styles: styles || {},
        pageElements: pageElements || null,
        createdBy: row.created_by || '',
        createdAt: row.created_at,
        updatedAt: row.updated_at
      };
    });

    return NextResponse.json(templates);
  } catch (err: any) {
    console.error('Failed to get map print templates:', err);
    return NextResponse.json(
      { detail: err?.message || 'Internal server error retrieving print templates.' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    await ensureDb();
    const body = await request.json();
    const {
      id,
      mapId,
      name,
      layout = 'landscape',
      pageSize = 'A4',
      dpi = 150,
      positions,
      styles,
      pageElements,
      createdBy = ''
    } = body;

    if (!name || !positions || !styles) {
      return NextResponse.json(
        { detail: 'Missing required fields: name, positions, styles.' },
        { status: 400 }
      );
    }

    // Resolve map id if provided
    let resolvedMapId: string | null = null;
    if (mapId) {
      const mapCheck = await pool.query(
        'SELECT id FROM map_workspaces WHERE id = $1 OR LOWER(slug) = LOWER($1)',
        [mapId]
      );
      resolvedMapId = mapCheck.rows.length > 0 ? mapCheck.rows[0].id : mapId;
    }

    const templateId = id || `pt_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const positionsJson = typeof positions === 'string' ? positions : JSON.stringify(positions);
    const stylesJson = typeof styles === 'string' ? styles : JSON.stringify(styles);
    const elementsJson = pageElements ? (typeof pageElements === 'string' ? pageElements : JSON.stringify(pageElements)) : null;

    await pool.query(
      `INSERT INTO map_print_templates (
        id, map_id, name, layout, page_size, dpi, positions, styles, page_elements, created_by, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, CURRENT_TIMESTAMP)
      ON CONFLICT (id) DO UPDATE SET
        name = $3,
        layout = $4,
        page_size = $5,
        dpi = $6,
        positions = $7,
        styles = $8,
        page_elements = $9,
        updated_at = CURRENT_TIMESTAMP`,
      [
        templateId,
        resolvedMapId,
        String(name).trim(),
        layout,
        pageSize,
        Number(dpi) || 150,
        positionsJson,
        stylesJson,
        elementsJson,
        createdBy
      ]
    );

    return NextResponse.json({
      success: true,
      template: {
        id: templateId,
        mapId: resolvedMapId,
        name: String(name).trim(),
        layout,
        pageSize,
        dpi: Number(dpi) || 150,
        positions: typeof positions === 'string' ? JSON.parse(positions) : positions,
        styles: typeof styles === 'string' ? JSON.parse(styles) : styles,
        pageElements: pageElements ? (typeof pageElements === 'string' ? JSON.parse(pageElements) : pageElements) : null,
        createdBy
      }
    }, { status: 201 });
  } catch (err: any) {
    console.error('Failed to save map print template:', err);
    return NextResponse.json(
      { detail: err?.message || 'Internal server error saving print template.' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    await ensureDb();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { detail: 'id query parameter is required for deletion.' },
        { status: 400 }
      );
    }

    await pool.query('DELETE FROM map_print_templates WHERE id = $1', [id]);

    return NextResponse.json({ success: true, id });
  } catch (err: any) {
    console.error('Failed to delete map print template:', err);
    return NextResponse.json(
      { detail: err?.message || 'Internal server error deleting print template.' },
      { status: 500 }
    );
  }
}
