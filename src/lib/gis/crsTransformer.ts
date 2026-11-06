/**
 * CRS and Projection Transformation Service for WebGIS & GeoServer WFS-T.
 *
 * Handles:
 * - Dynamic CRS normalization (URNs, URLs, EPSG codes, OGC strings)
 * - Map projection vs. Layer native projection transformations
 * - OGC Axis Order management (Lat/Lon vs. Lon/Lat in WFS 1.1.0 / 2.0.0)
 * - GeoJSON geometry coordinate transformations across any EPSG CRS
 * - Compliant GML srsName generation for GeoServer datastores (PostGIS, Shapefile, GeoPackage)
 */

import { transform } from 'ol/proj.js';
import { register } from 'ol/proj/proj4.js';
import proj4 from 'proj4';

// Register proj4 with OpenLayers so custom EPSG projections work seamlessly
if (typeof window !== 'undefined' || typeof global !== 'undefined') {
  try {
    register(proj4);
  } catch {
    // ignore if already registered
  }
}

/**
 * Normalizes any CRS representation to a standard format (e.g. 'EPSG:4326' or 'EPSG:3857').
 */
export function normalizeCrs(crs: string | undefined | null): string {
  if (!crs) return 'EPSG:4326';
  const clean = crs.trim();

  // Handle URNs like urn:ogc:def:crs:EPSG::4326 or urn:x-ogc:def:crs:EPSG:4326
  const urnMatch = clean.match(/EPSG:{1,2}(\d+)/i);
  if (urnMatch) {
    return `EPSG:${urnMatch[1]}`;
  }

  // Handle URLs like http://www.opengis.net/gml/srs/epsg.xml#4326
  const urlMatch = clean.match(/#(\d+)$/);
  if (urlMatch) {
    return `EPSG:${urlMatch[1]}`;
  }

  // Handle CRS:84 or urn:ogc:def:crs:OGC:1.3:CRS84
  if (/CRS:?84/i.test(clean)) {
    return 'CRS:84';
  }

  // Handle raw numbers like '4326' or '3857'
  if (/^\d+$/.test(clean)) {
    return `EPSG:${clean}`;
  }

  // Standard uppercase 'EPSG:XXXX'
  if (/^EPSG:\d+$/i.test(clean)) {
    return clean.toUpperCase();
  }

  return clean;
}

/**
 * Checks whether a CRS is geographic (degrees / Lat-Lon) or projected (meters/feet).
 */
export function isGeographicCrs(crs: string | undefined | null): boolean {
  const normalized = normalizeCrs(crs);
  if (normalized === 'CRS:84') return true;
  const match = normalized.match(/EPSG:(\d+)/i);
  if (!match) return false;
  const code = parseInt(match[1], 10);
  // Common geographic coordinate systems (degrees)
  return code === 4326 || code === 4269 || code === 4267 || (code >= 4000 && code < 5000 && code !== 3857);
}

/**
 * Returns the recommended srsName attribute for GML geometries in GeoServer WFS-T.
 *
 * For EPSG:4326:
 * - WFS 1.1.0 standard specifies that `srsName="EPSG:4326"` or `srsName="urn:ogc:def:crs:EPSG::4326"`
 *   has Latitude, Longitude axis order if GeoServer axis order compliance is enabled.
 * - `http://www.opengis.net/gml/srs/epsg.xml#4326` guarantees Longitude, Latitude (X, Y)
 *   in GeoServer WFS 1.1.0/2.0.0 without axis flipping.
 *
 * For projected CRS (e.g. EPSG:3857 or UTM):
 * - Returns `EPSG:XXXX` where coordinates are strictly in projected units (meters/feet).
 */
export function getWfsGmlSrsName(layerCrs: string | undefined | null, wfsVersion = '1.1.0'): string {
  const normalized = normalizeCrs(layerCrs);

  if (normalized === 'EPSG:4326' || normalized === 'CRS:84') {
    // GeoServer standard GML3 SRS URL preserving Lon/Lat (X/Y)
    return 'http://www.opengis.net/gml/srs/epsg.xml#4326';
  }

  return normalized;
}

/**
 * Transforms a single coordinate pair [x, y] from sourceCrs to targetCrs.
 */
export function transformCoordinate(
  coord: [number, number],
  sourceCrs: string,
  targetCrs: string
): [number, number] {
  const normSource = normalizeCrs(sourceCrs);
  const normTarget = normalizeCrs(targetCrs);

  // If source and target are identical (or both 4326 / CRS:84), no transformation needed
  if (normSource === normTarget) return [coord[0], coord[1]];
  if (
    (normSource === 'EPSG:4326' || normSource === 'CRS:84') &&
    (normTarget === 'EPSG:4326' || normTarget === 'CRS:84')
  ) {
    return [coord[0], coord[1]];
  }

  try {
    const srcCode = normSource === 'CRS:84' ? 'EPSG:4326' : normSource;
    const dstCode = normTarget === 'CRS:84' ? 'EPSG:4326' : normTarget;
    const res = transform(coord, srcCode, dstCode);
    return [res[0], res[1]];
  } catch (err) {
    // Fallback math transformation between EPSG:3857 and EPSG:4326 if ol/proj projection not found
    if (
      (normSource === 'EPSG:3857') &&
      (normTarget === 'EPSG:4326' || normTarget === 'CRS:84')
    ) {
      const lon = (coord[0] / 20037508.34) * 180;
      let lat = (coord[1] / 20037508.34) * 180;
      lat = (180 / Math.PI) * (2 * Math.atan(Math.exp((lat * Math.PI) / 180)) - Math.PI / 2);
      return [lon, lat];
    }

    if (
      (normSource === 'EPSG:4326' || normSource === 'CRS:84') &&
      (normTarget === 'EPSG:3857')
    ) {
      const x = (coord[0] * 20037508.34) / 180;
      let y = Math.log(Math.tan(((90 + coord[1]) * Math.PI) / 360)) / (Math.PI / 180);
      y = (y * 20037508.34) / 180;
      return [x, y];
    }

    console.warn(`[crsTransformer] Could not transform coordinate from ${normSource} to ${normTarget}:`, err);
    return [coord[0], coord[1]];
  }
}

/**
 * Recursively transforms all coordinates in a GeoJSON geometry object
 * from sourceCrs to targetCrs.
 */
export function transformGeometry(
  geometry: { type: string; coordinates: any },
  sourceCrs: string,
  targetCrs: string
): { type: string; coordinates: any } {
  const normSource = normalizeCrs(sourceCrs);
  const normTarget = normalizeCrs(targetCrs);

  if (normSource === normTarget) {
    return JSON.parse(JSON.stringify(geometry));
  }

  const transformCoords = (coords: any): any => {
    if (!Array.isArray(coords)) return coords;
    if (coords.length >= 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number') {
      return transformCoordinate([coords[0], coords[1]], normSource, normTarget);
    }
    return coords.map(transformCoords);
  };

  return {
    type: geometry.type,
    coordinates: transformCoords(geometry.coordinates),
  };
}

/**
 * Standard ray-casting test to determine if a 2D point (x, y) is inside a linear ring polygon.
 */
export function pointInRing(x: number, y: number, ring: number[][]): boolean {
  if (!ring || ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Validates whether a clicked point is truly inside a GeoJSON Polygon or MultiPolygon.
 * Handles auto-detection of coordinate projection (degrees vs meters).
 * Returns true for non-polygons (points/lines rely on click proximity).
 */
export function isPointInsideGeometry(
  ptLonLat: [number, number],
  ptMap: [number, number],
  geometry: any
): boolean {
  if (!geometry || !geometry.coordinates) return true;
  const geomType = geometry.type;
  if (!geomType || !geomType.includes('Polygon')) return true;

  // Extract a coordinate number to detect if geometry coordinates are in degrees (<= 180) or meters (> 180)
  const extractNum = (coords: any): number | null => {
    if (!coords) return null;
    if (Array.isArray(coords) && typeof coords[0] === 'number') return coords[0];
    if (Array.isArray(coords) && Array.isArray(coords[0])) return extractNum(coords[0]);
    return null;
  };

  const sampleNum = extractNum(geometry.coordinates);
  const isDegrees = sampleNum !== null && Math.abs(sampleNum) <= 180;
  const testPt = isDegrees ? ptLonLat : ptMap;
  const [x, y] = testPt;

  if (geomType === 'Polygon') {
    const rings = geometry.coordinates;
    if (!rings || rings.length === 0) return false;
    if (!pointInRing(x, y, rings[0])) return false;
    // Check interior rings (holes)
    for (let i = 1; i < rings.length; i++) {
      if (pointInRing(x, y, rings[i])) return false;
    }
    return true;
  }

  if (geomType === 'MultiPolygon') {
    for (const poly of geometry.coordinates) {
      if (poly && poly.length > 0 && pointInRing(x, y, poly[0])) {
        let inHole = false;
        for (let i = 1; i < poly.length; i++) {
          if (pointInRing(x, y, poly[i])) {
            inHole = true;
            break;
          }
        }
        if (!inHole) return true;
      }
    }
    return false;
  }

  return true;
}

