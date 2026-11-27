// ============================================================================
// GeoServer Log Parser Utility & Root Cause Analyzer
//
// 1. Parses GeoServer Log4j lines into structured entries.
// 2. Intelligent Root Cause Extractor: analyzes 150+ lines of Java stack traces
//    and extracts the EXACT root problem and plain-English actionable suggestion.
// ============================================================================

export type LogLevel = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG' | 'TRACE';

export interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  logger: string;
  message: string;
  details?: string;
  stackTrace?: string;
  raw: string;

  // Smart Problem Summary fields (for ERROR & WARN)
  rootCause?: string;
  friendlyExplanation?: string;
  actionableFix?: string;
  affectedResource?: string;
}

export interface ParseLogsResult {
  entries: LogEntry[];
  counts: {
    ALL: number;
    ERROR: number;
    WARN: number;
    INFO: number;
    DEBUG: number;
    TRACE: number;
  };
}

const LOG_HEADER_REGEX =
  /^(?:(\d{1,2}\s+[A-Za-z]{3}\s+\d{2}:\d{2}:\d{2}(?:[,\.]\d{1,3})?|\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:[,\.]\d{1,3})?|\d{2}:\d{2}:\d{2}(?:[,\.]\d{1,3})?)\s+)?(ERROR|WARN|INFO|DEBUG|TRACE)\s+(?:\[([^\]]+)\]\s*)?(?:-\s*)?(.*)$/i;

/**
 * Inspects Java stack traces and log messages to extract the EXACT root cause
 * and provide a plain-English explanation + actionable recommendation.
 */
function analyzeLogProblem(entry: LogEntry): void {
  const combinedText = `${entry.message}\n${entry.details || ''}\n${entry.stackTrace || ''}`;

  // 1. Extract the true "Caused by:" or primary Exception line
  const causedByMatch = combinedText.match(/Caused by:\s*([^\r\n]+)/i);
  const exceptionMatch = combinedText.match(/([a-zA-Z0-9\._]+Exception:[^\r\n]+)/i);

  let rawRootCause = '';
  if (causedByMatch && causedByMatch[1]) {
    rawRootCause = causedByMatch[1].trim();
  } else if (exceptionMatch && exceptionMatch[1]) {
    rawRootCause = exceptionMatch[1].trim();
  } else if (entry.message && entry.message !== '(Details below)') {
    rawRootCause = entry.message;
  }

  // 2. Extract affected resource (URL, layer name, file name)
  let affectedResource = '';
  const urlMatch = combinedText.match(/https?:\/\/[^\s"'<>\)]+/i);
  const layerMatch = combinedText.match(/layer\s+['"]?([a-zA-Z0-9_\-:]+)['"]?/i);
  const fileMatch = combinedText.match(/([a-zA-Z0-9_\-]+\.(?:tif|tiff|shp|geotiff|properties|xml|sld))/i);

  if (urlMatch) {
    const rawUrl = urlMatch[0];
    const fileName = rawUrl.split('/').pop()?.split('?')[0];
    affectedResource = fileName || rawUrl;
  } else if (layerMatch) {
    affectedResource = layerMatch[1];
  } else if (fileMatch) {
    affectedResource = fileMatch[1];
  }

  // 3. Match against known common GeoServer failure patterns
  let friendlyExplanation = '';
  let actionableFix = '';

  const lower = combinedText.toLowerCase();

  if (lower.includes('code: 403') || lower.includes('forbidden') || lower.includes('403 forbidden')) {
    friendlyExplanation = 'Remote cloud storage (Cloudflare R2 / AWS S3) denied access (HTTP 403 Forbidden). GeoServer cannot read the raster header.';
    actionableFix = 'Ensure the Cloudflare R2 bucket or custom domain has Public Read access enabled, or update the COG URL with valid pre-signed authorization credentials.';
  } else if (lower.includes('code: 401') || lower.includes('unauthorized')) {
    friendlyExplanation = 'Authentication failed connecting to remote resource. Access credentials or tokens are invalid.';
    actionableFix = 'Verify the username, password, or bearer token for the data store in GeoServer.';
  } else if (lower.includes('code: 404') || lower.includes('not found') || lower.includes('filenotfoundexception')) {
    friendlyExplanation = 'The requested file or layer could not be found.';
    actionableFix = 'Verify the file exists at the specified server path or that the remote URL is still active and spelled correctly.';
  } else if (lower.includes('connection refused') || lower.includes('connectexception')) {
    friendlyExplanation = 'GeoServer could not establish a network connection to the database (e.g. PostGIS) or remote service.';
    actionableFix = 'Ensure the database server is running, the host and port are correct, and no firewall is blocking port 5432.';
  } else if (lower.includes('read timed out') || lower.includes('sockettimeoutexception') || lower.includes('timeout')) {
    friendlyExplanation = 'The request timed out while waiting for a response from the database or external store.';
    actionableFix = 'Increase connection / read timeouts in GeoServer store settings, or check database query performance.';
  } else if (lower.includes('outofmemoryerror') || lower.includes('java heap space')) {
    friendlyExplanation = 'GeoServer ran out of Java JVM memory.';
    actionableFix = 'Increase GeoServer memory allocation by setting -Xmx2G or -Xmx4G in your Java / Tomcat startup parameters.';
  } else if (lower.includes('nosuchauthoritycodeexception') || lower.includes('crs') || lower.includes('srs')) {
    friendlyExplanation = 'Coordinate Reference System (CRS) error or unrecognized projection EPSG code.';
    actionableFix = 'Verify that the layer or map request uses a valid EPSG code (e.g. EPSG:4326 or EPSG:3857) recognized by GeoServer.';
  } else if (lower.includes('nullpointerexception')) {
    friendlyExplanation = 'Null reference during rendering or query processing.';
    actionableFix = 'Check your SLD style rules for missing attributes or invalid symbolizer expressions.';
  } else if (lower.includes('could not parse the kvp') || (lower.includes('kvp') && lower.includes('serviceexception'))) {
    friendlyExplanation = 'GeoServer received an OWS request with malformed or invalid Key-Value Pair (KVP) query parameters in the URL.';
    actionableFix = 'Check the request URL query parameters (such as BBOX, LAYERS, SERVICE, or REQUEST) sent to the /ows endpoint for syntax errors or invalid values.';
  } else if (lower.includes('inspire') && (lower.includes('empty') || lower.includes('skipped'))) {
    friendlyExplanation = 'GeoServer skipped outputting INSPIRE extended metadata in capabilities XML because an identifier code was left blank.';
    actionableFix = 'In GeoServer Admin, uncheck INSPIRE in WMS/WFS service settings if not required, or provide a valid Dataset Identifier Code.';
  } else if (lower.includes('datastore.dispose') || lower.includes('jdbc based datastore and not disposing')) {
    friendlyExplanation = 'A JDBC/PostGIS datastore instance was garbage-collected without explicit disposal, often triggered by a store reload or REST configuration change.';
    actionableFix = 'Enable "Validate connections" and set "Evictor run period" to 300 on your PostGIS store in GeoServer to automatically recycle idle pool connections.';
  } else if (entry.level === 'ERROR') {
    friendlyExplanation = rawRootCause || 'An unexpected server exception was caught by GeoServer.';
    actionableFix = 'Inspect the stack trace for the failing Java package or check GeoServer store configuration.';
  }

  if (rawRootCause || friendlyExplanation) {
    entry.rootCause = rawRootCause || entry.message;
    entry.friendlyExplanation = friendlyExplanation;
    entry.actionableFix = actionableFix;
    entry.affectedResource = affectedResource || undefined;
  }
}

export function parseGeoServerLogs(rawContent: string): ParseLogsResult {
  const lines = rawContent.split(/\r?\n/);
  const entries: LogEntry[] = [];
  const counts = {
    ALL: 0,
    ERROR: 0,
    WARN: 0,
    INFO: 0,
    DEBUG: 0,
    TRACE: 0,
  };

  let currentEntry: LogEntry | null = null;
  const detailBuffer: string[] = [];
  const stackBuffer: string[] = [];

  const flushCurrent = () => {
    if (currentEntry) {
      if (detailBuffer.length > 0) {
        currentEntry.details = detailBuffer.join('\n').trim();
      }
      if (stackBuffer.length > 0) {
        currentEntry.stackTrace = stackBuffer.join('\n').trim();
      }

      // Analyze root cause and plain-English solution for errors & warnings
      if (currentEntry.level === 'ERROR' || currentEntry.level === 'WARN') {
        analyzeLogProblem(currentEntry);
      }

      entries.push(currentEntry);
      currentEntry = null;
      detailBuffer.length = 0;
      stackBuffer.length = 0;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const match = line.match(LOG_HEADER_REGEX);

    if (match) {
      flushCurrent();

      const timestamp = (match[1] || '').trim() || new Date().toLocaleTimeString();
      const levelStr = (match[2] || 'INFO').toUpperCase().trim() as LogLevel;
      const logger = (match[3] || 'geoserver').trim();
      const message = (match[4] || '').trim();

      const validLevel: LogLevel = ['ERROR', 'WARN', 'INFO', 'DEBUG', 'TRACE'].includes(levelStr)
        ? levelStr
        : 'INFO';

      counts.ALL++;
      counts[validLevel]++;

      currentEntry = {
        id: `log-${entries.length + 1}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp,
        level: validLevel,
        logger,
        message: message || '(Details below)',
        raw: line,
      };
    } else {
      const trimmed = line.trim();
      if (!trimmed && !currentEntry) continue;

      if (!currentEntry) {
        const isErrorLine =
          trimmed.startsWith('at ') ||
          trimmed.startsWith('Caused by:') ||
          trimmed.includes('Exception') ||
          trimmed.includes('Error');

        const initialLevel: LogLevel = isErrorLine ? 'ERROR' : 'INFO';
        counts.ALL++;
        counts[initialLevel]++;

        currentEntry = {
          id: `log-orphan-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          timestamp: new Date().toLocaleTimeString(),
          level: initialLevel,
          logger: 'geoserver.log',
          message: trimmed.slice(0, 120),
          raw: line,
        };
      }

      const isStackTraceLine =
        trimmed.startsWith('at ') ||
        trimmed.startsWith('Caused by:') ||
        trimmed.startsWith('... ') ||
        trimmed.includes('Exception:') ||
        trimmed.includes('Error:');

      if (isStackTraceLine) {
        stackBuffer.push(line);
      } else {
        detailBuffer.push(line);
      }
    }
  }

  flushCurrent();

  // Ultimate fallback
  if (entries.length === 0 && rawContent.trim().length > 0) {
    const isError = rawContent.includes('Exception') || rawContent.includes('ERROR');
    const level: LogLevel = isError ? 'ERROR' : 'INFO';
    counts.ALL = 1;
    counts[level] = 1;

    const fallbackEntry: LogEntry = {
      id: `log-raw-${Date.now()}`,
      timestamp: new Date().toLocaleTimeString(),
      level,
      logger: 'geoserver.raw',
      message: 'Raw GeoServer Log Output',
      details: rawContent.slice(0, 5000),
      raw: rawContent.slice(0, 5000),
    };
    if (level === 'ERROR') {
      analyzeLogProblem(fallbackEntry);
    }
    entries.push(fallbackEntry);
  }

  return { entries, counts };
}
