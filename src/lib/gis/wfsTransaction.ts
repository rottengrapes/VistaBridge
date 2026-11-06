/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * WFS Transaction (WFS-T) engine for GeoServer.
 * Builds compliant OGC WFS 1.1.0 XML payloads for Insert, Update, and Delete operations.
 * Executes HTTP POST requests and parses OGC Transaction responses.
 */

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
 * Automatically wraps single geometries into multi-geometries if the target layer schema expects Multi*.
 * Ensures ONE feature contains ONE MultiPolygon with multiple members.
 */
export function normalizeGeometry(
  geometry: { type: string; coordinates: any },
  targetGeometryType?: string
): { type: string; coordinates: any } {
  if (!geometry || !geometry.type || !geometry.coordinates) {
    return geometry;
  }

  const currentType = geometry.type;
  const targetType = targetGeometryType || currentType;

  const isMultiPolygonTarget =
    targetType.toLowerCase().includes('multipolygon') ||
    targetType.toLowerCase().includes('multisurface');

  if (isMultiPolygonTarget && currentType === 'Polygon') {
    return {
      type: 'MultiPolygon',
      coordinates: [geometry.coordinates],
    };
  }

  if (targetType.toLowerCase().includes('multilinestring') && currentType === 'LineString') {
    return {
      type: 'MultiLineString',
      coordinates: [geometry.coordinates],
    };
  }

  if (targetType.toLowerCase().includes('multipoint') && currentType === 'Point') {
    return {
      type: 'MultiPoint',
      coordinates: [geometry.coordinates],
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

import { getWfsGmlSrsName } from './crsTransformer';

/**
 * Converts a GeoJSON geometry object into standard GML3 XML string.
 */
export function geoJsonToGml(
  geometry: { type: string; coordinates: any },
  srsName = 'http://www.opengis.net/gml/srs/epsg.xml#4326'
): string {
  const { type, coordinates } = geometry;
  const effectiveSrs = srsName || getWfsGmlSrsName('EPSG:4326');

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

    // Interior rings (holes) if any
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
 * Builds WFS 1.1.0 Transaction XML for INSERT operation.
 */
export function buildInsertXml(params: WfsInsertParams): string {
  const {
    workspace,
    layerName,
    targetNamespace,
    geomFieldName,
    geomType,
    srsName = 'http://www.opengis.net/gml/srs/epsg.xml#4326',
    geometry,
    attributes,
  } = params;

  // Auto-normalize geometry (Polygon -> MultiPolygon if schema requires)
  const normalizedGeometry = normalizeGeometry(geometry, geomType);
  const gmlGeom = geoJsonToGml(normalizedGeometry, srsName);

  let attrXml = '';
  for (const [key, val] of Object.entries(attributes)) {
    if (val === undefined || val === null || val === '') continue;
    // Skip internal or geometry keys
    if (key === geomFieldName || key === 'geometry' || key.toLowerCase().endsWith('_geom')) continue;
    attrXml += `\n        <${workspace}:${key}>${escapeXml(val)}</${workspace}:${key}>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<wfs:Transaction service="WFS" version="1.1.0"
  xmlns:wfs="http://www.opengis.net/wfs"
  xmlns:gml="http://www.opengis.net/gml"
  xmlns:ogc="http://www.opengis.net/ogc"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
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

/**
 * Builds WFS 1.1.0 Transaction XML for UPDATE operation.
 */
export function buildUpdateXml(params: WfsUpdateParams): string {
  const {
    workspace,
    layerName,
    targetNamespace,
    geomFieldName,
    srsName = 'EPSG:4326',
    fid,
    updatedAttributes,
    updatedGeometry,
  } = params;

  let propertiesXml = '';

  // Attributes to update
  for (const [key, val] of Object.entries(updatedAttributes)) {
    if (key === geomFieldName || key === 'geometry' || key.toLowerCase().endsWith('_geom')) continue;
    propertiesXml += `
    <wfs:Property>
      <wfs:Name>${key}</wfs:Name>
      <wfs:Value>${escapeXml(val)}</wfs:Value>
    </wfs:Property>`;
  }

  // Geometry to update if changed
  if (updatedGeometry) {
    const normalizedGeom = normalizeGeometry(updatedGeometry, params.geomType);
    const gmlGeom = geoJsonToGml(normalizedGeom, srsName);
    propertiesXml += `
    <wfs:Property>
      <wfs:Name>${geomFieldName}</wfs:Name>
      <wfs:Value>
        ${gmlGeom}
      </wfs:Value>
    </wfs:Property>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<wfs:Transaction service="WFS" version="1.1.0"
  xmlns:wfs="http://www.opengis.net/wfs"
  xmlns:gml="http://www.opengis.net/gml"
  xmlns:ogc="http://www.opengis.net/ogc"
  xmlns:${workspace}="${targetNamespace}">
  <wfs:Update typeName="${workspace}:${layerName}">${propertiesXml}
    <ogc:Filter>
      <ogc:FeatureId fid="${fid}"/>
    </ogc:Filter>
  </wfs:Update>
</wfs:Transaction>`;
}

/**
 * Builds WFS 1.1.0 Transaction XML for DELETE operation.
 */
export function buildDeleteXml(params: WfsDeleteParams): string {
  const { workspace, layerName, targetNamespace, fid } = params;

  return `<?xml version="1.0" encoding="UTF-8"?>
<wfs:Transaction service="WFS" version="1.1.0"
  xmlns:wfs="http://www.opengis.net/wfs"
  xmlns:ogc="http://www.opengis.net/ogc"
  xmlns:${workspace}="${targetNamespace}">
  <wfs:Delete typeName="${workspace}:${layerName}">
    <ogc:Filter>
      <ogc:FeatureId fid="${fid}"/>
    </ogc:Filter>
  </wfs:Delete>
</wfs:Transaction>`;
}

/**
 * Parses GeoServer XML response from a WFS-T request.
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
    // Clean up common error messages for user readability
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

  // Parse transaction summary
  const insertedMatch = xmlText.match(/<wfs:totalInserted>(\d+)<\/wfs:totalInserted>/i);
  const updatedMatch = xmlText.match(/<wfs:totalUpdated>(\d+)<\/wfs:totalUpdated>/i);
  const deletedMatch = xmlText.match(/<wfs:totalDeleted>(\d+)<\/wfs:totalDeleted>/i);

  const totalInserted = insertedMatch ? parseInt(insertedMatch[1], 10) : 0;
  const totalUpdated = updatedMatch ? parseInt(updatedMatch[1], 10) : 0;
  const totalDeleted = deletedMatch ? parseInt(deletedMatch[1], 10) : 0;

  // Extract inserted feature IDs
  const insertedFids: string[] = [];
  const fidMatches = xmlText.matchAll(/(?:fid|id)="([^"]+)"/gi);
  for (const m of fidMatches) {
    if (m[1] && !insertedFids.includes(m[1])) {
      insertedFids.push(m[1]);
    }
  }

  // Verify that the transaction actually affected rows or reported success
  const isSuccess =
    xmlText.includes('TransactionResponse') ||
    xmlText.includes('wfs:TransactionSummary') ||
    totalInserted > 0 ||
    totalUpdated > 0 ||
    totalDeleted > 0;

  return {
    success: isSuccess,
    totalInserted,
    totalUpdated,
    totalDeleted,
    insertedFids,
    rawResponse: xmlText,
    errorMessage: isSuccess ? undefined : 'Transaction did not modify any features.'
  };
}

/**
 * Executes a WFS-T transaction by sending the XML payload to GeoServer via HTTP POST.
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
      });

      const responseText = await response.text();
      const parsed = parseWfsTransactionResponse(responseText);

      if (response.ok && parsed.success) {
        return parsed;
      }

      if (parsed.errorMessage) {
        lastError = parsed.errorMessage;
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
