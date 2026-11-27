// ============================================================================
// GeoServer Monitor API (GET /api/geoserver/monitor)
//
// Proxies and aggregates metrics from GeoServer's Monitor Extension REST API.
// GeoServer Monitor exports logs via /rest/monitor/requests.csv (standard OGC)
// and /rest/monitor/requests.json.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { resolveInternalGeoServerUrl } from '@/lib/geoserver';

export interface MonitorRequestItem {
  id: string | number;
  status: string;
  service: string;
  operation: string;
  startTime: string;
  endTime?: string;
  totalTime: number;
  remoteAddr: string;
  path: string;
  responseStatus?: number;
  resources?: string;
  errorMessage?: string | null;
}

export interface MonitorApiResponse {
  available: boolean;
  message?: string;
  totalRequests: number;
  wmsCount: number;
  wfsCount: number;
  wcsCount: number;
  wmtsCount: number;
  otherCount: number;
  avgLatencyMs: number;
  errorCount: number;
  requests: MonitorRequestItem[];
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === ',' && !inQuotes) {
      result.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  result.push(cur);
  return result;
}

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]).map(h => h.trim());
  const records: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = parseCsvLine(line);
    const item: Record<string, string> = {};
    headers.forEach((h, idx) => {
      item[h] = values[idx] !== undefined ? values[idx].trim() : '';
    });
    records.push(item);
  }
  return records;
}

export async function GET(req: NextRequest) {
  try {
    const cookieStore = await cookies();

    // 1. Resolve Authorization Header:
    const authFromHeader = req.headers.get('authorization');
    const authFromCookie = cookieStore.get('geoserver_auth')?.value;
    const envAuth = process.env.GEOSERVER_AUTH;
    const defaultBasicAuth = `Basic ${Buffer.from(
      `${process.env.GEOSERVER_USERNAME || 'admin'}:${process.env.GEOSERVER_PASSWORD || 'geoserver'}`
    ).toString('base64')}`;

    const geoserverAuth = authFromHeader || authFromCookie || envAuth || defaultBasicAuth;

    // 2. Resolve GeoServer Base URL:
    const customHeaderUrl = req.headers.get('x-geoserver-url');
    const geoserverUrlCookie = cookieStore.get('geoserver_url')?.value;
    const configuredBase = (process.env.NEXT_PUBLIC_GEOSERVER_URL || process.env.GEOSERVER_URL || '').replace(/\/+$/, '');
    const rawGeoserverBase = customHeaderUrl || geoserverUrlCookie || configuredBase || 'http://localhost:8080/geoserver';
    const geoserverBase = resolveInternalGeoServerUrl(rawGeoserverBase);

    const headers: Record<string, string> = {
      'Accept': 'text/csv, application/json, text/plain, */*',
    };
    if (geoserverAuth) {
      headers['Authorization'] = geoserverAuth;
    }

    // 3. Query GeoServer Monitor REST API
    // GeoServer Monitor natively provides /rest/monitor/requests.csv
    let rawText = '';
    let isJson = false;
    let monitorRes: Response | null = null;

    try {
      // First attempt: CSV endpoint (native to gs-monitor)
      monitorRes = await fetch(`${geoserverBase}/rest/monitor/requests.csv?count=100`, {
        headers,
        signal: AbortSignal.timeout(6000),
      });

      if (monitorRes.ok) {
        rawText = await monitorRes.text();
      } else if (monitorRes.status === 404) {
        // Fallback: try JSON endpoint
        const jsonRes = await fetch(`${geoserverBase}/rest/monitor/requests.json?count=100`, {
          headers: { ...headers, 'Accept': 'application/json' },
          signal: AbortSignal.timeout(6000),
        });
        if (jsonRes.ok) {
          monitorRes = jsonRes;
          rawText = await jsonRes.text();
          isJson = true;
        }
      }
    } catch (fetchErr: any) {
      return NextResponse.json({
        available: false,
        message: `Cannot connect to GeoServer at ${geoserverBase}: ${fetchErr?.message || 'Connection timeout'}`,
        totalRequests: 0,
        wmsCount: 0,
        wfsCount: 0,
        wcsCount: 0,
        wmtsCount: 0,
        otherCount: 0,
        avgLatencyMs: 0,
        errorCount: 0,
        requests: [],
      } satisfies MonitorApiResponse);
    }

    if (!monitorRes || !monitorRes.ok) {
      const status = monitorRes?.status || 500;
      if (status === 401 || status === 403) {
        return NextResponse.json({
          available: false,
          message: `Authentication failed (HTTP ${status}) connecting to GeoServer Monitor at ${geoserverBase}. Please verify credentials.`,
          totalRequests: 0,
          wmsCount: 0,
          wfsCount: 0,
          wcsCount: 0,
          wmtsCount: 0,
          otherCount: 0,
          avgLatencyMs: 0,
          errorCount: 0,
          requests: [],
        } satisfies MonitorApiResponse);
      }

      return NextResponse.json({
        available: false,
        message: `GeoServer Monitor not reachable (HTTP ${status}). Ensure gs-monitor is installed in WEB-INF/lib and GeoServer is restarted.`,
        totalRequests: 0,
        wmsCount: 0,
        wfsCount: 0,
        wcsCount: 0,
        wmtsCount: 0,
        otherCount: 0,
        avgLatencyMs: 0,
        errorCount: 0,
        requests: [],
      } satisfies MonitorApiResponse);
    }

    // 4. Parse response into records
    let rawList: any[] = [];
    if (isJson) {
      try {
        const data = JSON.parse(rawText);
        if (data?.requests?.request) {
          rawList = Array.isArray(data.requests.request) ? data.requests.request : [data.requests.request];
        } else if (Array.isArray(data?.requests)) {
          rawList = data.requests;
        } else if (Array.isArray(data)) {
          rawList = data;
        } else if (data?.request) {
          rawList = Array.isArray(data.request) ? data.request : [data.request];
        }
      } catch {
        rawList = [];
      }
    } else {
      // Parse CSV
      rawList = parseCsv(rawText);
    }

    let wmsCount = 0;
    let wfsCount = 0;
    let wcsCount = 0;
    let wmtsCount = 0;
    let otherCount = 0;
    let totalLatency = 0;
    let validLatencyCount = 0;
    let errorCount = 0;

    const parsedRequests: MonitorRequestItem[] = rawList.map((item: any, idx: number) => {
      const rawService = String(item.service || item.Service || '').toUpperCase().trim();
      let service = 'OTHER';
      if (rawService.includes('WMS')) {
        service = 'WMS';
        wmsCount++;
      } else if (rawService.includes('WFS')) {
        service = 'WFS';
        wfsCount++;
      } else if (rawService.includes('WCS')) {
        service = 'WCS';
        wcsCount++;
      } else if (rawService.includes('WMTS')) {
        service = 'WMTS';
        wmtsCount++;
      } else if (rawService) {
        service = rawService;
        otherCount++;
      } else {
        const path = String(item.path || '').toLowerCase();
        if (path.includes('/wms')) {
          service = 'WMS';
          wmsCount++;
        } else if (path.includes('/wfs')) {
          service = 'WFS';
          wfsCount++;
        } else if (path.includes('/wcs')) {
          service = 'WCS';
          wcsCount++;
        } else if (path.includes('/wmts')) {
          service = 'WMTS';
          wmtsCount++;
        } else {
          otherCount++;
        }
      }

      const totalTime = Number(item.totalTime ?? item.TotalTime ?? item.total_time ?? 0);
      if (totalTime > 0) {
        totalLatency += totalTime;
        validLatencyCount++;
      }

      const responseStatus = item.responseStatus !== undefined && item.responseStatus !== ''
        ? Number(item.responseStatus)
        : (item.status_code ? Number(item.status_code) : undefined);

      const statusStr = String(item.status || item.Status || (item.failed === 'true' ? 'FAILED' : 'COMPLETED')).toUpperCase();
      if ((responseStatus && responseStatus >= 400) || statusStr === 'FAILED' || item.errorMessage || item.failed === 'true') {
        errorCount++;
      }

      return {
        id: item.id ?? item.Id ?? idx + 1,
        status: statusStr,
        service,
        operation: item.operation || item.Operation || item.path || 'Unknown',
        startTime: item.startTime || item.StartTime || item.start_time || new Date().toISOString(),
        endTime: item.endTime || item.EndTime || item.end_time,
        totalTime,
        remoteAddr: item.remoteAddr || item.RemoteAddr || item.remote_addr || 'Unknown',
        path: item.path || item.Path || '',
        responseStatus,
        resources: Array.isArray(item.resources?.string)
          ? item.resources.string.join(', ')
          : (typeof item.resources === 'string' ? item.resources : ''),
        errorMessage: item.errorMessage || item.ErrorMessage || null,
      };
    });

    // Sort by startTime descending if not already sorted
    parsedRequests.sort((a, b) => {
      try {
        return new Date(b.startTime).getTime() - new Date(a.startTime).getTime();
      } catch {
        return 0;
      }
    });

    // Calculate true overall average latency across all recorded requests in the log
    const avgLatencyMs = validLatencyCount > 0 ? Math.round(totalLatency / validLatencyCount) : 0;

    return NextResponse.json({
      available: true,
      totalRequests: parsedRequests.length,
      wmsCount,
      wfsCount,
      wcsCount,
      wmtsCount,
      otherCount,
      avgLatencyMs,
      errorCount,
      requests: parsedRequests,
    } satisfies MonitorApiResponse);
  } catch (error: any) {
    console.error('Error in /api/geoserver/monitor:', error);
    return NextResponse.json({
      available: false,
      message: error?.message || 'Failed to process monitoring data',
      totalRequests: 0,
      wmsCount: 0,
      wfsCount: 0,
      wcsCount: 0,
      wmtsCount: 0,
      otherCount: 0,
      avgLatencyMs: 0,
      errorCount: 0,
      requests: [],
    } satisfies MonitorApiResponse);
  }
}
