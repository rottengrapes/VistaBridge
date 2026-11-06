// ============================================================================
// GeoServer Services Capabilities Check API (POST /api/geoserver/services/check)
//
// Probes GeoServer service endpoints to determine availability:
// - WMS (GetCapabilities)
// - WFS (GetCapabilities)
// - WMTS (GWC / OWS GetCapabilities)
// - WCS (GetCapabilities)
// - WPS (GetCapabilities)
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { resolveInternalGeoServerUrl } from '@/lib/geoserver';
import { getAppSetting } from '@/lib/settings';

interface ServiceProbeResult {
  available: boolean;
  statusCode: number;
  version: string;
  message?: string;
}

export async function POST(req: NextRequest) {
  try {
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      // empty body is fine
    }

    const cookieStore = await cookies();
    const geoserverAuthCookie = cookieStore.get('geoserver_auth')?.value;
    const geoserverUrlCookie = cookieStore.get('geoserver_url')?.value;

    const defaultGeoserverUrl = await getAppSetting('geoserver_url', 'http://localhost:8080/geoserver');
    const rawTarget = body.geoserverUrl || geoserverUrlCookie || defaultGeoserverUrl;
    const serverFetchUrl = resolveInternalGeoServerUrl(rawTarget).replace(/\/+$/, '');

    let authHeader = '';
    if (body.username && body.password) {
      authHeader = 'Basic ' + Buffer.from(`${body.username}:${body.password}`).toString('base64');
    } else if (geoserverAuthCookie) {
      authHeader = geoserverAuthCookie;
    }

    const headers: Record<string, string> = {};
    if (authHeader) {
      headers['Authorization'] = authHeader;
    }

    const probeEndpoint = async (url: string, version: string): Promise<ServiceProbeResult> => {
      try {
        const res = await fetch(url, {
          method: 'GET',
          headers,
          signal: AbortSignal.timeout(3500),
        });

        // 200 is available. Note: some GeoServers return XML ExceptionReport if service is disabled
        if (res.ok) {
          const text = await res.text();
          if (text.includes('ServiceException') || text.includes('ExceptionReport') || text.includes('Service not active')) {
            return { available: false, statusCode: res.status, version, message: 'Service not active or restricted' };
          }
          return { available: true, statusCode: res.status, version };
        }
        return { available: false, statusCode: res.status, version, message: `HTTP ${res.status}` };
      } catch (err: any) {
        return { available: false, statusCode: 0, version, message: err?.message || 'Connection timed out' };
      }
    };

    // Parallel probes with fallback for WMTS
    const [wmsResult, wfsResult, wcsResult, wpsResult] = await Promise.all([
      probeEndpoint(`${serverFetchUrl}/ows?service=WMS&version=1.3.0&request=GetCapabilities`, '1.3.0'),
      probeEndpoint(`${serverFetchUrl}/ows?service=WFS&version=1.1.0&request=GetCapabilities`, '1.1.0'),
      probeEndpoint(`${serverFetchUrl}/ows?service=WCS&version=2.0.1&request=GetCapabilities`, '2.0.1'),
      probeEndpoint(`${serverFetchUrl}/ows?service=WPS&version=1.0.0&request=GetCapabilities`, '1.0.0'),
    ]);

    // WMTS can be at /gwc/service/wmts or /ows
    let wmtsResult = await probeEndpoint(`${serverFetchUrl}/gwc/service/wmts?REQUEST=GetCapabilities`, '1.0.0');
    if (!wmtsResult.available) {
      const owsWmts = await probeEndpoint(`${serverFetchUrl}/ows?service=WMTS&version=1.0.0&request=GetCapabilities`, '1.0.0');
      if (owsWmts.available) {
        wmtsResult = owsWmts;
      }
    }

    return NextResponse.json({
      success: true,
      geoserverUrl: serverFetchUrl,
      services: {
        wms: wmsResult,
        wfs: wfsResult,
        wmts: wmtsResult,
        wcs: wcsResult,
        wps: wpsResult,
      },
    });
  } catch (error: any) {
    console.error('Error probing GeoServer services:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Failed to probe GeoServer services' },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}
