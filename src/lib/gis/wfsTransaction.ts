/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * WFS Transaction (WFS-T) engine for GeoServer.
 * Universally adaptable across all GeoServer versions (2.x through 3.x+).
 * Supports WFS 1.1.0 (GML3) and resilient fallback to WFS 1.0.0 (GML2),
 * automated geometry normalization (Point <-> MultiPoint),
 * and clean CRS binding.
 */

import { getWfsGmlSrsName, normalizeCrs } from './crsTransformer';

export interface WfsTransactionOptions {
  workspace: string;
  layerName: string;
  targetNamespace: string;
  geomFieldName: string;
  geomType?: string;
  srsName?: string;
}

export interface WfsInsertParams extends WfsTransactionOptions {
  geometry: {
    type: string;
    coordinates: any;
  };
  attributes: Record<string, any>;
}

export interface WfsUpdateParams extends WfsTransactionOptions {
  fid: string;
  updatedAttributes: Record<string, any>;
  updatedGeometry?: {
    type: string;
    coordinates: any;
  } | null;
  primaryKeyAttr?: string;
  primaryKeyValue?: any;
}

export interface WfsDeleteParams extends WfsTransactionOptions {
  fid: string;
}

export interface WfsTransactionResult {
  success: boolean;
  totalInserted?: number;
  totalUpdated?: number;
  totalDeleted?: number;
  insertedFids?: string[];
  errorMessage?: string;
  rawResponse?: string;
}

/**
 * Centralized geometry normalizer.
 * Supports bidirectional conversions between single and multi-geometries:
 * - Point <-> MultiPoint
 * - Polygon <-> MultiPolygon
 * - LineString <-> MultiLineString
 */
export function normalizeGeometry(
  geometry: { type: string; coordinates: any },
  targetGeometryType?: string
): { type: string; coordinates: any } {
  if (!geometry || !geometry.type || !geometry.coordinates) {
    return geometry;
  }

  const currentType = geometry.type;
  const targetType = (targetGeometryType || currentType).toLowerCase();

  // Polygon <-> MultiPolygon
  if ((targetType.includes('multipolygon') || targetType.includes('multisurface')) && currentType === 'Polygon') {
    return {
      type: 'MultiPolygon',
      coordinates: [geometry.coordinates],
    };
  }
  if (!targetType.includes('multi') && targetType.includes('polygon') && currentType === 'MultiPolygon') {
    return {
      type: 'Polygon',
      coordinates: geometry.coordinates[0] || [],
    };
  }

  // LineString <-> MultiLineString
  if (targetType.includes('multilinestring') && currentType === 'LineString') {
    return {
      type: 'MultiLineString',
      coordinates: [geometry.coordinates],
    };
  }
  if (!targetType.includes('multi') && targetType.includes('line') && currentType === 'MultiLineString') {
    return {
      type: 'LineString',
      coordinates: geometry.coordinates[0] || [],
    };
  }

  // Point <-> MultiPoint
  if (targetType.includes('multipoint') && currentType === 'Point') {
    return {
      type: 'MultiPoint',
      coordinates: [geometry.coordinates],
    };
  }
  if (!targetType.includes('multi') && targetType.includes('point') && currentType === 'MultiPoint') {
    return {
      type: 'Point',
      coordinates: geometry.coordinates[0] || [0, 0],
    };
  }

  return geometry;
}

/**
 * Escapes special XML characters in string values.
 */
function escapeXml(value: any): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Normalizes SRS identifier to clean EPSG code compatible with all GeoServer versions.
 */
function resolveCleanSrs(srsName?: string): string {
  if (!srsName) return 'EPSG:4326';
  const norm = normalizeCrs(srsName);
  return getWfsGmlSrsName(norm);
}

/**
 * Converts a GeoJSON geometry object into standard GML3 (WFS 1.1.0) XML string.
 */
export function geoJsonToGml(
  geometry: { type: string; coordinates: any },
  srsName = 'EPSG:4326'
): string {
  const { type, coordinates } = geometry;
  const effectiveSrs = resolveCleanSrs(srsName);

  if (type === 'Point') {
    const [x, y] = coordinates;
    return `<gml:Point srsName="${effectiveSrs}"><gml:pos>${x} ${y}</gml:pos></gml:Point>`;
  }

  if (type === 'MultiPoint') {
    const pointsGml = coordinates
      .map(([x, y]: [number, number]) => `<gml:pointMember><gml:Point srsName="${effectiveSrs}"><gml:pos>${x} ${y}</gml:pos></gml:Point></gml:pointMember>`)
      .join('');
    return `<gml:MultiPoint srsName="${effectiveSrs}">${pointsGml}</gml:MultiPoint>`;
  }

  if (type === 'LineString') {
    const posList = coordinates
      .map(([x, y]: [number, number]) => `${x} ${y}`)
      .join(' ');
    return `<gml:LineString srsName="${effectiveSrs}"><gml:posList>${posList}</gml:posList></gml:LineString>`;
  }

  if (type === 'MultiLineString') {
    const linesGml = coordinates
      .map((lineCoords: [number, number][]) => {
        const posList = lineCoords.map(([x, y]) => `${x} ${y}`).join(' ');
        return `<gml:lineStringMember><gml:LineString srsName="${effectiveSrs}"><gml:posList>${posList}</gml:posList></gml:LineString></gml:lineStringMember>`;
      })
      .join('');
    return `<gml:MultiLineString srsName="${effectiveSrs}">${linesGml}</gml:MultiLineString>`;
  }

  if (type === 'Polygon') {
    const rings = coordinates;
    const exterior = rings[0];
    const posList = exterior.map(([x, y]: [number, number]) => `${x} ${y}`).join(' ');
    let polygonXml = `<gml:Polygon srsName="${effectiveSrs}"><gml:exterior><gml:LinearRing><gml:posList>${posList}</gml:posList></gml:LinearRing></gml:exterior>`;

    for (let i = 1; i < rings.length; i++) {
      const hole = rings[i];
      const holePosList = hole.map(([x, y]: [number, number]) => `${x} ${y}`).join(' ');
      polygonXml += `<gml:interior><gml:LinearRing><gml:posList>${holePosList}</gml:posList></gml:LinearRing></gml:interior>`;
    }
    polygonXml += `</gml:Polygon>`;
    return polygonXml;
  }

  if (type === 'MultiPolygon') {
    const polysGml = coordinates
      .map((polyCoords: [number, number][][]) => {
        const exterior = polyCoords[0];
        const posList = exterior.map(([x, y]) => `${x} ${y}`).join(' ');
        let singlePoly = `<gml:Polygon srsName="${effectiveSrs}"><gml:exterior><gml:LinearRing><gml:posList>${posList}</gml:posList></gml:LinearRing></gml:exterior>`;
        for (let i = 1; i < polyCoords.length; i++) {
          const hole = polyCoords[i];
          const holePosList = hole.map(([x, y]) => `${x} ${y}`).join(' ');
          singlePoly += `<gml:interior><gml:LinearRing><gml:posList>${holePosList}</gml:posList></gml:LinearRing></gml:interior>`;
        }
        singlePoly += `</gml:Polygon>`;
        return `<gml:polygonMember>${singlePoly}</gml:polygonMember>`;
      })
      .join('');
    return `<gml:MultiPolygon srsName="${effectiveSrs}">${polysGml}</gml:MultiPolygon>`;
  }

  throw new Error(`Unsupported geometry type for GML conversion: ${type}`);
}

/**
 * Converts a GeoJSON geometry object into standard GML2 (WFS 1.0.0) XML string.
 * GML2 coordinates format is universally supported across every GeoServer release without CRS conflicts.
 */
export function geoJsonToGml2(
  geometry: { type: string; coordinates: any },
  srsName = 'EPSG:4326'
): string {
  const { type, coordinates } = geometry;
  const effectiveSrs = resolveCleanSrs(srsName);

  if (type === 'Point') {
    const [x, y] = coordinates;
    return `<gml:Point srsName="${effectiveSrs}"><gml:coordinates decimal="." cs="," ts=" ">${x},${y}</gml:coordinates></gml:Point>`;
  }

  if (type === 'MultiPoint') {
    const pointsGml = coordinates
      .map(([x, y]: [number, number]) => `<gml:pointMember><gml:Point srsName="${effectiveSrs}"><gml:coordinates decimal="." cs="," ts=" ">${x},${y}</gml:coordinates></gml:Point></gml:pointMember>`)
      .join('');
    return `<gml:MultiPoint srsName="${effectiveSrs}">${pointsGml}</gml:MultiPoint>`;
  }

  if (type === 'LineString') {
    const coordStr = coordinates.map(([x, y]: [number, number]) => `${x},${y}`).join(' ');
    return `<gml:LineString srsName="${effectiveSrs}"><gml:coordinates decimal="." cs="," ts=" ">${coordStr}</gml:coordinates></gml:LineString>`;
  }

  if (type === 'MultiLineString') {
    const linesGml = coordinates
      .map((lineCoords: [number, number][]) => {
        const coordStr = lineCoords.map(([x, y]) => `${x},${y}`).join(' ');
        return `<gml:lineStringMember><gml:LineString srsName="${effectiveSrs}"><gml:coordinates decimal="." cs="," ts=" ">${coordStr}</gml:coordinates></gml:LineString></gml:lineStringMember>`;
      })
      .join('');
    return `<gml:MultiLineString srsName="${effectiveSrs}">${linesGml}</gml:MultiLineString>`;
  }

  if (type === 'Polygon') {
    const rings = coordinates;
    const extStr = rings[0].map(([x, y]: [number, number]) => `${x},${y}`).join(' ');
    let poly = `<gml:Polygon srsName="${effectiveSrs}"><gml:outerBoundaryIs><gml:LinearRing><gml:coordinates decimal="." cs="," ts=" ">${extStr}</gml:coordinates></gml:LinearRing></gml:outerBoundaryIs>`;
    for (let i = 1; i < rings.length; i++) {
      const holeStr = rings[i].map(([x, y]: [number, number]) => `${x},${y}`).join(' ');
      poly += `<gml:innerBoundaryIs><gml:LinearRing><gml:coordinates decimal="." cs="," ts=" ">${holeStr}</gml:coordinates></gml:LinearRing></gml:innerBoundaryIs>`;
    }
    poly += `</gml:Polygon>`;
    return poly;
  }

  if (type === 'MultiPolygon') {
    const polysGml = coordinates
      .map((polyCoords: [number, number][][]) => {
        const extStr = polyCoords[0].map(([x, y]) => `${x},${y}`).join(' ');
        let poly = `<gml:Polygon srsName="${effectiveSrs}"><gml:outerBoundaryIs><gml:LinearRing><gml:coordinates decimal="." cs="," ts=" ">${extStr}</gml:coordinates></gml:LinearRing></gml:outerBoundaryIs>`;
        for (let i = 1; i < polyCoords.length; i++) {
          const holeStr = polyCoords[i].map(([x, y]) => `${x},${y}`).join(' ');
          poly += `<gml:innerBoundaryIs><gml:LinearRing><gml:coordinates decimal="." cs="," ts=" ">${holeStr}</gml:coordinates></gml:LinearRing></gml:innerBoundaryIs>`;
        }
        poly += `</gml:Polygon>`;
        return `<gml:polygonMember>${poly}</gml:polygonMember>`;
      })
      .join('');
    return `<gml:MultiPolygon srsName="${effectiveSrs}">${polysGml}</gml:MultiPolygon>`;
  }

  throw new Error(`Unsupported geometry type for GML2 conversion: ${type}`);
}

/**
 * Builds WFS Transaction XML for INSERT operation.
 * Supports WFS 1.1.0 (default) and WFS 1.0.0.
 */
export function buildInsertXml(
  params: WfsInsertParams,
  options?: {
    wfsVersion?: '1.1.0' | '1.0.0';
    overrideGeomType?: string;
  }
): string {
  const {
    workspace,
    layerName,
    targetNamespace,
    geomFieldName,
    geomType,
    srsName = 'EPSG:4326',
    geometry,
    attributes,
  } = params;

  const version = options?.wfsVersion || '1.1.0';
  const effectiveGeomType = options?.overrideGeomType || geomType;
  const effectiveSrs = resolveCleanSrs(srsName);

  // Auto-normalize geometry (bidirectional)
  const normalizedGeometry = normalizeGeometry(geometry, effectiveGeomType);

  const gmlGeom =
    version === '1.0.0'
      ? geoJsonToGml2(normalizedGeometry, effectiveSrs)
      : geoJsonToGml(normalizedGeometry, effectiveSrs);

  let attrXml = '';
  for (const [key, val] of Object.entries(attributes)) {
    if (val === undefined || val === null || val === '') continue;
    // Skip internal or geometry keys
    if (key === geomFieldName || key === 'geometry' || key.toLowerCase().endsWith('_geom')) continue;
    attrXml += `\n        <${workspace}:${key}>${escapeXml(val)}</${workspace}:${key}>`;
  }

  if (version === '1.0.0') {
    return `<?xml version="1.0" encoding="UTF-8"?>
<wfs:Transaction service="WFS" version="1.0.0"
  xmlns:wfs="http://www.opengis.net/wfs"
  xmlns:gml="http://www.opengis.net/gml"
  xmlns:ogc="http://www.opengis.net/ogc"
  xmlns:${workspace}="${targetNamespace}">
  <wfs:Insert>
    <${workspace}:${layerName}>
      <${workspace}:${geomFieldName}>
        ${gmlGeom}
      </${workspace}:${geomFieldName}>${attrXml}
    </${workspace}:${layerName}>
  </wfs:Insert>
</wfs:Transaction>`;
  }

  // WFS 1.1.0 standard with explicit idgen and srsName on Insert element
  return `<?xml version="1.0" encoding="UTF-8"?>
<wfs:Transaction service="WFS" version="1.1.0"
  xmlns:wfs="http://www.opengis.net/wfs"
  xmlns:gml="http://www.opengis.net/gml"
  xmlns:ogc="http://www.opengis.net/ogc"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xmlns:${workspace}="${targetNamespace}">
  <wfs:Insert idgen="GenerateNew" srsName="${effectiveSrs}">
    <${workspace}:${layerName}>
      <${workspace}:${geomFieldName}>
        ${gmlGeom}
      </${workspace}:${geomFieldName}>${attrXml}
    </${workspace}:${layerName}>
  </wfs:Insert>
</wfs:Transaction>`;
}

/**
 * Builds WFS Transaction XML for UPDATE operation.
 */
export function buildUpdateXml(
  params: WfsUpdateParams,
  options?: { wfsVersion?: '1.1.0' | '1.0.0'; usePkFilter?: boolean }
): string {
  const {
    workspace,
    layerName,
    targetNamespace,
    geomFieldName,
    srsName = 'EPSG:4326',
    fid,
    updatedAttributes,
    updatedGeometry,
    primaryKeyAttr,
    primaryKeyValue,
  } = params;

  const version = options?.wfsVersion || '1.1.0';
  const effectiveSrs = resolveCleanSrs(srsName);

  // System, geometry, and Primary Key column names that MUST NOT be modified via <wfs:Property>
  const systemCols = new Set([
    'ogc_fid',
    'fid',
    'gid',
    'objectid',
    'feature_id',
    'geometry',
    'the_geom',
    'geom',
    'key',
    'layer',
    geomFieldName.toLowerCase(),
  ]);

  let propertiesXml = '';

  for (const [key, val] of Object.entries(updatedAttributes)) {
    const keyLower = key.toLowerCase();
    if (systemCols.has(keyLower) || keyLower.endsWith('_geom')) continue;
    if (val === undefined || val === null) continue;
    propertiesXml += `
    <wfs:Property>
      <wfs:Name>${key}</wfs:Name>
      <wfs:Value>${escapeXml(val)}</wfs:Value>
    </wfs:Property>`;
  }

  if (updatedGeometry) {
    const normalizedGeom = normalizeGeometry(updatedGeometry, params.geomType);
    const gmlGeom =
      version === '1.0.0'
        ? geoJsonToGml2(normalizedGeom, effectiveSrs)
        : geoJsonToGml(normalizedGeom, effectiveSrs);

    propertiesXml += `
    <wfs:Property>
      <wfs:Name>${geomFieldName}</wfs:Name>
      <wfs:Value>
        ${gmlGeom}
      </wfs:Value>
    </wfs:Property>`;
  }

  // Clean fid: strip workspace prefix if present (e.g. "ne:ne_10m_airports.1" -> "ne_10m_airports.1")
  let cleanFid = fid ? String(fid).trim() : '';
  if (cleanFid.includes(':')) {
    cleanFid = cleanFid.split(':').pop()!;
  }
  // If fid is purely numeric (e.g. "1"), prefix with layerName (e.g. "ne_10m_airports.1")
  if (/^\d+$/.test(cleanFid)) {
    cleanFid = `${layerName}.${cleanFid}`;
  }

  let filterXml = '';
  const isTemporaryFid =
    !cleanFid ||
    cleanFid === 'none' ||
    cleanFid.includes('new-') ||
    cleanFid.endsWith('.new') ||
    cleanFid.startsWith('wms_');

  if ((options?.usePkFilter || isTemporaryFid) && primaryKeyAttr && primaryKeyValue !== undefined && primaryKeyValue !== null) {
    filterXml = `
    <ogc:Filter>
      <ogc:PropertyIsEqualTo>
        <ogc:PropertyName>${primaryKeyAttr}</ogc:PropertyName>
        <ogc:Literal>${escapeXml(primaryKeyValue)}</ogc:Literal>
      </ogc:PropertyIsEqualTo>
    </ogc:Filter>`;
  } else {
    filterXml = `
    <ogc:Filter>
      <ogc:FeatureId fid="${cleanFid}"/>
    </ogc:Filter>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<wfs:Transaction service="WFS" version="${version}"
  xmlns:wfs="http://www.opengis.net/wfs"
  xmlns:gml="http://www.opengis.net/gml"
  xmlns:ogc="http://www.opengis.net/ogc"
  xmlns:${workspace}="${targetNamespace}">
  <wfs:Update typeName="${workspace}:${layerName}">${propertiesXml}${filterXml}
  </wfs:Update>
</wfs:Transaction>`;
}

/**
 * Builds WFS Transaction XML for DELETE operation.
 */
export function buildDeleteXml(
  params: WfsDeleteParams,
  options?: { wfsVersion?: '1.1.0' | '1.0.0' }
): string {
  const { workspace, layerName, targetNamespace, fid } = params;
  const version = options?.wfsVersion || '1.1.0';

  let cleanFid = fid ? String(fid).trim() : '';
  if (cleanFid.includes(':')) {
    cleanFid = cleanFid.split(':').pop()!;
  }
  if (/^\d+$/.test(cleanFid)) {
    cleanFid = `${layerName}.${cleanFid}`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<wfs:Transaction service="WFS" version="${version}"
  xmlns:wfs="http://www.opengis.net/wfs"
  xmlns:ogc="http://www.opengis.net/ogc"
  xmlns:${workspace}="${targetNamespace}">
  <wfs:Delete typeName="${workspace}:${layerName}">
    <ogc:Filter>
      <ogc:FeatureId fid="${cleanFid}"/>
    </ogc:Filter>
  </wfs:Delete>
</wfs:Transaction>`;
}

/**
 * Parses GeoServer XML response from a WFS-T request (supports WFS 1.1.0 and 1.0.0).
 */
export function parseWfsTransactionResponse(xmlText: string): WfsTransactionResult {
  if (!xmlText) {
    return {
      success: false,
      errorMessage: 'Empty response received from GeoServer.'
    };
  }

  // Check for OGC ExceptionReport
  if (xmlText.includes('ExceptionReport') || xmlText.includes('ServiceExceptionReport')) {
    const msgMatch =
      xmlText.match(/<ows:ExceptionText>([\s\S]*?)<\/ows:ExceptionText>/i) ||
      xmlText.match(/<ServiceException>([\s\S]*?)<\/ServiceException>/i);

    let errorDetails = msgMatch ? msgMatch[1].trim() : 'GeoServer returned an exception report.';
    if (errorDetails.includes('violates check constraint')) {
      errorDetails = 'Validation failed: A database constraint was violated.';
    } else if (errorDetails.includes('violates not-null constraint')) {
      errorDetails = 'Validation failed: Required field is missing.';
    }

    return {
      success: false,
      errorMessage: errorDetails,
      rawResponse: xmlText,
    };
  }

  // WFS 1.1.0 summary tags
  const insertedMatch = xmlText.match(/<wfs:totalInserted>(\d+)<\/wfs:totalInserted>/i);
  const updatedMatch = xmlText.match(/<wfs:totalUpdated>(\d+)<\/wfs:totalUpdated>/i);
  const deletedMatch = xmlText.match(/<wfs:totalDeleted>(\d+)<\/wfs:totalDeleted>/i);

  let totalInserted = insertedMatch ? parseInt(insertedMatch[1], 10) : 0;
  let totalUpdated = updatedMatch ? parseInt(updatedMatch[1], 10) : 0;
  let totalDeleted = deletedMatch ? parseInt(deletedMatch[1], 10) : 0;

  // WFS 1.0.0 summary tags (<wfs:SUCCESS/>, <wfs:InsertResult>, <wfs:UpdateResult>)
  if (!insertedMatch && !updatedMatch && !deletedMatch) {
    if (xmlText.includes('<wfs:SUCCESS') || xmlText.includes('<wfs:Status>')) {
      if (xmlText.includes('UpdateResult') || xmlText.includes('Update')) {
        totalUpdated = 1;
      } else if (xmlText.includes('DeleteResult') || xmlText.includes('Delete')) {
        totalDeleted = 1;
      } else {
        totalInserted = 1;
      }
    }
  }

  // Extract inserted feature IDs
  const insertedFids: string[] = [];
  const fidMatches = xmlText.matchAll(/(?:fid|id)="([^"]+)"/gi);
  for (const m of fidMatches) {
    if (m[1] && !insertedFids.includes(m[1])) {
      insertedFids.push(m[1]);
    }
  }

  const hasModifiedFeatures = totalInserted > 0 || totalUpdated > 0 || totalDeleted > 0;
  const isSuccess = hasModifiedFeatures;

  return {
    success: isSuccess,
    totalInserted,
    totalUpdated,
    totalDeleted,
    insertedFids,
    rawResponse: xmlText,
    errorMessage: isSuccess ? undefined : (
      totalUpdated === 0 && (xmlText.includes('totalUpdated>0') || xmlText.includes('TransactionSummary'))
        ? 'GeoServer transaction completed but 0 features were updated. Feature ID was not found in the layer.'
        : totalInserted === 0 && (xmlText.includes('totalInserted>0') || xmlText.includes('TransactionSummary'))
        ? 'GeoServer transaction completed but 0 features were inserted. The layer datastore may be read-only, non-editable, or coordinate format rejected.'
        : 'Transaction did not modify any features.'
    )
  };
}

/**
 * Low-level executor: sends XML payload to GeoServer endpoints.
 */
export async function executeWfsTransaction(
  geoserverUrl: string,
  xmlPayload: string,
  workspace?: string,
  geoserverAuth?: string
): Promise<WfsTransactionResult> {
  const cleanUrl = geoserverUrl.replace(/\/+$/, '');

  const endpoints = [
    workspace ? `${cleanUrl}/${workspace}/wfs` : null,
    `${cleanUrl}/ows`,
    `${cleanUrl}/wfs`,
  ].filter(Boolean) as string[];

  const headers: Record<string, string> = {
    'Content-Type': 'text/xml;charset=UTF-8',
  };

  if (geoserverAuth) {
    headers['Authorization'] = geoserverAuth;
  }

  let lastError = 'Failed to execute WFS transaction.';

  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: xmlPayload,
        credentials: 'include',
      });

      const responseText = await response.text();
      const parsed = parseWfsTransactionResponse(responseText);

      if (parsed.success) {
        return parsed;
      }

      if (parsed.errorMessage) {
        lastError = parsed.errorMessage;
        // If the workspace-scoped virtual service returned an OGC response (e.g. ExceptionReport),
        // that is the definitive response from the workspace. Do not fall through to global /ows
        // which may lack workspace scoping and misreport read-only errors.
        if (workspace && endpoint.includes(`/${workspace}/`)) {
          return parsed;
        }
      } else {
        lastError = `GeoServer responded with HTTP ${response.status}: ${responseText.substring(0, 200)}`;
      }
    } catch (err: any) {
      lastError = err?.message || 'Network error communicating with GeoServer.';
    }
  }

  return {
    success: false,
    errorMessage: lastError,
  };
}

/**
 * Adaptive WFS Insert Runner.
 * Automatically adapts across GeoServer 2.x and 3.x:
 * 1. Attempt 1: Standard WFS 1.1.0 with clean EPSG CRS and GenerateNew ID.
 * 2. Attempt 2: If rejected due to geometry mismatch, inverts Point <-> MultiPoint.
 * 3. Attempt 3: Falls back to universal WFS 1.0.0 (GML2) which bypasses strict GML3 validation.
 */
export async function executeAdaptiveWfsInsert(
  params: WfsInsertParams,
  geoserverUrl: string,
  geoserverAuth?: string
): Promise<WfsTransactionResult> {
  // Strategy 1: Standard WFS 1.1.0
  const xml1 = buildInsertXml(params, { wfsVersion: '1.1.0' });
  let res = await executeWfsTransaction(geoserverUrl, xml1, params.workspace, geoserverAuth);
  if (res.success && (res.totalInserted ?? 0) > 0) return res;

  // If geometry is point-based and GeoServer complained about feature insertion,
  // test inverting Point <-> MultiPoint (common with shapefiles where DescribeFeatureType returned Point but datastore expects MultiPoint)
  const isPointType = params.geometry.type === 'Point' || (params.geomType && params.geomType.toLowerCase().includes('point'));
  if (isPointType) {
    const invertedGeomType = params.geomType?.toLowerCase().includes('multipoint') ? 'Point' : 'MultiPoint';
    const xml2 = buildInsertXml(params, { wfsVersion: '1.1.0', overrideGeomType: invertedGeomType });
    res = await executeWfsTransaction(geoserverUrl, xml2, params.workspace, geoserverAuth);
    if (res.success && (res.totalInserted ?? 0) > 0) return res;
  }

  // Strategy 3: Fallback to universal WFS 1.0.0 (GML2)
  const xml3 = buildInsertXml(params, { wfsVersion: '1.0.0' });
  const res3 = await executeWfsTransaction(geoserverUrl, xml3, params.workspace, geoserverAuth);
  if (res3.success && (res3.totalInserted ?? 0) > 0) return res3;

  // Return best informative result
  return res3.errorMessage ? res3 : res;
}

/**
 * Adaptive WFS Update Runner.
 * Tries WFS 1.1.0 with FeatureId filter, then primary key filter,
 * with fallback to WFS 1.0.0.
 */
export async function executeAdaptiveWfsUpdate(
  params: WfsUpdateParams,
  geoserverUrl: string,
  geoserverAuth?: string
): Promise<WfsTransactionResult> {
  // Strategy 1: WFS 1.1.0 with FeatureId (or PK if temporary/fallback fid)
  const xml1 = buildUpdateXml(params, { wfsVersion: '1.1.0' });
  const res1 = await executeWfsTransaction(geoserverUrl, xml1, params.workspace, geoserverAuth);
  if (res1.success && (res1.totalUpdated ?? 0) > 0) return res1;

  // Strategy 2: If primary key attribute is available and Strategy 1 updated 0 features, try WFS 1.1.0 with PK filter
  if (params.primaryKeyAttr && params.primaryKeyValue !== undefined && params.primaryKeyValue !== null) {
    const xmlPk = buildUpdateXml(params, { wfsVersion: '1.1.0', usePkFilter: true });
    const resPk = await executeWfsTransaction(geoserverUrl, xmlPk, params.workspace, geoserverAuth);
    if (resPk.success && (resPk.totalUpdated ?? 0) > 0) return resPk;
  }

  // Strategy 3: Fallback to WFS 1.0.0 with FeatureId
  const xml2 = buildUpdateXml(params, { wfsVersion: '1.0.0' });
  const res2 = await executeWfsTransaction(geoserverUrl, xml2, params.workspace, geoserverAuth);
  if (res2.success && (res2.totalUpdated ?? 0) > 0) return res2;

  // Strategy 4: Fallback to WFS 1.0.0 with PK filter
  if (params.primaryKeyAttr && params.primaryKeyValue !== undefined && params.primaryKeyValue !== null) {
    const xml2Pk = buildUpdateXml(params, { wfsVersion: '1.0.0', usePkFilter: true });
    const res2Pk = await executeWfsTransaction(geoserverUrl, xml2Pk, params.workspace, geoserverAuth);
    if (res2Pk.success && (res2Pk.totalUpdated ?? 0) > 0) return res2Pk;
  }

  return (res1.totalUpdated ?? 0) > 0 ? res1 : res2.errorMessage ? res2 : res1;
}

/**
 * Adaptive WFS Delete Runner.
 * Tries WFS 1.1.0 then falls back to WFS 1.0.0.
 */
export async function executeAdaptiveWfsDelete(
  params: WfsDeleteParams,
  geoserverUrl: string,
  geoserverAuth?: string
): Promise<WfsTransactionResult> {
  const xml1 = buildDeleteXml(params, { wfsVersion: '1.1.0' });
  const res1 = await executeWfsTransaction(geoserverUrl, xml1, params.workspace, geoserverAuth);
  if (res1.success) return res1;

  // Fallback to WFS 1.0.0
  const xml2 = buildDeleteXml(params, { wfsVersion: '1.0.0' });
  return await executeWfsTransaction(geoserverUrl, xml2, params.workspace, geoserverAuth);
}
