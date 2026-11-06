/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * WFS DescribeFeatureType schema discovery utility.
 * Fetches and parses GeoServer XSD schema to extract:
 * - targetNamespace (e.g. 'http://www.census.gov')
 * - workspace & layerName (e.g. 'tiger' & 'poi')
 * - geomFieldName (e.g. 'the_geom')
 * - geomType ('Point', 'MultiPolygon', 'LineString', etc.)
 * - attributes: array of { name, type, required, nillable }
 */

export interface LayerAttributeSchema {
  name: string;
  type: 'string' | 'integer' | 'float' | 'boolean' | 'date' | 'datetime';
  required: boolean;
  nillable: boolean;
}

export interface WfsLayerSchema {
  workspace: string;
  layerName: string;
  qualifiedName: string;
  targetNamespace: string;
  geomFieldName: string;
  geomType: 'Point' | 'MultiPoint' | 'LineString' | 'MultiLineString' | 'Polygon' | 'MultiPolygon';
  srsName: string;
  attributes: LayerAttributeSchema[];
}

// In-memory cache for fetched schemas
const schemaCache = new Map<string, WfsLayerSchema>();

import { normalizeCrs } from './crsTransformer';

export async function fetchWfsLayerSchema(
  layerId: string,
  geoserverUrl: string,
  geoserverAuth?: string,
  layerKnownCrs?: string,
  defaultSrs = 'EPSG:4326'
): Promise<WfsLayerSchema> {
  const cached = schemaCache.get(layerId);
  if (cached) {
    if (layerKnownCrs && cached.srsName === defaultSrs) {
      cached.srsName = normalizeCrs(layerKnownCrs);
    }
    return cached;
  }

  const cleanUrl = geoserverUrl.replace(/\/+$/, '');
  const workspace = layerId.includes(':') ? layerId.split(':')[0] : 'topp';
  const layerName = layerId.includes(':') ? layerId.split(':')[1] : layerId;

  const headers: Record<string, string> = {};
  if (geoserverAuth) {
    headers['Authorization'] = geoserverAuth;
  }

  const effectiveDefaultSrs = layerKnownCrs ? normalizeCrs(layerKnownCrs) : defaultSrs;

  // URLs to try for DescribeFeatureType
  const candidateUrls = [
    `${cleanUrl}/${workspace}/wfs?service=WFS&version=1.1.0&request=DescribeFeatureType&typeName=${encodeURIComponent(layerName)}`,
    `${cleanUrl}/ows?service=WFS&version=1.1.0&request=DescribeFeatureType&typeName=${encodeURIComponent(layerId)}`,
    `${cleanUrl}/${workspace}/wfs?service=WFS&version=2.0.0&request=DescribeFeatureType&typeNames=${encodeURIComponent(layerName)}`,
    `${cleanUrl}/ows?service=WFS&version=2.0.0&request=DescribeFeatureType&typeNames=${encodeURIComponent(layerId)}`,
  ];

  let xmlText = '';
  for (const url of candidateUrls) {
    try {
      const res = await fetch(url, { headers });
      if (res.ok) {
        const text = await res.text();
        if (!text.includes('ExceptionReport') && !text.includes('ServiceException')) {
          xmlText = text;
          break;
        }
      }
    } catch {
      // try next URL
    }
  }

  if (!xmlText) {
    // Return a safe fallback schema if GeoServer DescribeFeatureType is not reachable
    const fallback: WfsLayerSchema = {
      workspace,
      layerName,
      qualifiedName: layerId,
      targetNamespace: `http://localhost:8080/geoserver/${workspace}`,
      geomFieldName: 'the_geom',
      geomType: 'Point',
      srsName: effectiveDefaultSrs,
      attributes: [],
    };
    return fallback;
  }

  const parsed = parseDescribeFeatureTypeXml(xmlText, workspace, layerName, layerId, effectiveDefaultSrs);

  // Runtime Probe: Query 1 feature via WFS to authoritatively discover geometry_name, geometry.type, and CRS
  try {
    const probeUrls = [
      `${cleanUrl}/${workspace}/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=${encodeURIComponent(layerName)}&outputFormat=application/json&count=1`,
      `${cleanUrl}/ows?service=WFS&version=2.0.0&request=GetFeature&typeNames=${encodeURIComponent(layerId)}&outputFormat=application/json&count=1`,
      `${cleanUrl}/ows?service=WFS&version=1.1.0&request=GetFeature&typeName=${encodeURIComponent(layerId)}&outputFormat=application/json&maxFeatures=1`,
    ];
    for (const pUrl of probeUrls) {
      try {
        const probeRes = await fetch(pUrl, { headers });
        if (probeRes.ok) {
          const probeJson = await probeRes.json();
          const firstFeature = probeJson?.features?.[0];
          if (firstFeature) {
            if (firstFeature.geometry_name) {
              parsed.geomFieldName = firstFeature.geometry_name;
            }
            if (firstFeature.geometry?.type) {
              parsed.geomType = firstFeature.geometry.type;
            }
          }
          if (probeJson?.crs?.properties?.name) {
            parsed.srsName = normalizeCrs(probeJson.crs.properties.name);
          }
          if (firstFeature || probeJson?.crs) break;
        }
      } catch {
        // continue probe
      }
    }
  } catch {
    // ignore probe errors
  }

  // If CRS was not resolved by probe and layerKnownCrs is provided, use layerKnownCrs
  if (layerKnownCrs && (!parsed.srsName || parsed.srsName === defaultSrs)) {
    parsed.srsName = normalizeCrs(layerKnownCrs);
  }

  schemaCache.set(layerId, parsed);
  return parsed;
}

export function parseDescribeFeatureTypeXml(
  xmlText: string,
  workspace: string,
  layerName: string,
  qualifiedName: string,
  defaultSrs = 'EPSG:4326'
): WfsLayerSchema {
  let targetNamespace = `http://localhost:8080/geoserver/${workspace}`;
  let geomFieldName = 'the_geom';
  let geomType: WfsLayerSchema['geomType'] = 'Point';
  const attributes: LayerAttributeSchema[] = [];

  // Match targetNamespace
  const nsMatch = xmlText.match(/targetNamespace="([^"]+)"/);
  if (nsMatch) {
    targetNamespace = nsMatch[1];
  }

  // Geometry field discovery - order agnostic (name before type OR type before name)
  const geomMatch1 =
    xmlText.match(/name="([^"]+)"[^>]*type="(?:[^"]*:)?([A-Za-z]+PropertyType)"/i) ||
    xmlText.match(/name="([^"]+)"[^>]*type="[^"]*gml:([A-Za-z]+)"/i);
  const geomMatch2 =
    xmlText.match(/type="(?:[^"]*:)?([A-Za-z]+PropertyType)"[^>]*name="([^"]+)"/i) ||
    xmlText.match(/type="[^"]*gml:([A-Za-z]+)"[^>]*name="([^"]+)"/i);

  if (geomMatch1) {
    geomFieldName = geomMatch1[1];
    const rawType = geomMatch1[2].toLowerCase();
    if (rawType.includes('multipolygon')) geomType = 'MultiPolygon';
    else if (rawType.includes('polygon') || rawType.includes('surface')) geomType = 'Polygon';
    else if (rawType.includes('multilinestring')) geomType = 'MultiLineString';
    else if (rawType.includes('linestring') || rawType.includes('curve')) geomType = 'LineString';
    else if (rawType.includes('multipoint')) geomType = 'MultiPoint';
    else if (rawType.includes('point')) geomType = 'Point';
  } else if (geomMatch2) {
    geomFieldName = geomMatch2[2];
    const rawType = geomMatch2[1].toLowerCase();
    if (rawType.includes('multipolygon')) geomType = 'MultiPolygon';
    else if (rawType.includes('polygon') || rawType.includes('surface')) geomType = 'Polygon';
    else if (rawType.includes('multilinestring')) geomType = 'MultiLineString';
    else if (rawType.includes('linestring') || rawType.includes('curve')) geomType = 'LineString';
    else if (rawType.includes('multipoint')) geomType = 'MultiPoint';
    else if (rawType.includes('point')) geomType = 'Point';
  }

  // Parse elements using regex for cross-environment compatibility (Node and Browser)
  const elementRegex = /<xsd:element\s+([^>]+)\/>/gi;
  let match: RegExpExecArray | null;

  const GEOM_COL_NAMES = new Set([
    'the_geom', 'geom', 'geometry', 'wkb_geometry', 'wkt_geometry', 'shape',
    geomFieldName.toLowerCase()
  ]);

  while ((match = elementRegex.exec(xmlText)) !== null) {
    const attrsStr = match[1];
    const nameMatch = attrsStr.match(/name="([^"]+)"/);
    const typeMatch = attrsStr.match(/type="([^"]+)"/);
    const nillableMatch = attrsStr.match(/nillable="([^"]+)"/);
    const minOccursMatch = attrsStr.match(/minOccurs="([^"]+)"/);

    if (!nameMatch || !typeMatch) continue;

    const colName = nameMatch[1];
    const rawColType = typeMatch[1];
    const isNillable = nillableMatch ? nillableMatch[1] === 'true' : true;
    const minOccurs = minOccursMatch ? parseInt(minOccursMatch[1], 10) : 0;
    const isRequired = minOccurs > 0 && !isNillable;

    // Skip geometry field
    if (
      GEOM_COL_NAMES.has(colName.toLowerCase()) ||
      rawColType.toLowerCase().includes('gml:') ||
      rawColType.toLowerCase().includes('propertytype')
    ) {
      continue;
    }

    // Map schema type
    const localType = (rawColType.split(':').pop() || '').toLowerCase();
    let mappedType: LayerAttributeSchema['type'] = 'string';
    if (['int', 'integer', 'long', 'short', 'byte'].includes(localType)) {
      mappedType = 'integer';
    } else if (['float', 'double', 'decimal', 'real'].includes(localType)) {
      mappedType = 'float';
    } else if (['boolean'].includes(localType)) {
      mappedType = 'boolean';
    } else if (['date'].includes(localType)) {
      mappedType = 'date';
    } else if (['datetime', 'time', 'timestamp'].includes(localType)) {
      mappedType = 'datetime';
    }

    attributes.push({
      name: colName,
      type: mappedType,
      required: isRequired,
      nillable: isNillable
    });
  }

  return {
    workspace,
    layerName,
    qualifiedName,
    targetNamespace,
    geomFieldName,
    geomType,
    srsName: defaultSrs,
    attributes,
  };
}
