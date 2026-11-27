// ============================================================================
// GeoServer Logs Console Page (/logs)
//
// Administrative & Developer log inspection console:
// - Fetches live server logs directly from GeoServer over HTTP via "Get Logs"
// - 100% network/HTTP-based — no local filesystem paths required
// - Smart Problem Summary: Automatically extracts the EXACT root cause from
//   Java stack traces and provides plain-English actionable fixes
// - Mode Switcher: "Smart Problem Summary" vs "Full Terminal Console"
// - Global Controls: Line depth (100–1000 lines) and sort order (Newest/Oldest)
//   available across BOTH views with zero unwanted tab auto-switching
// - Real-time filtering by Log Level (ALL, ERROR, WARN, INFO, DEBUG)
// - Responsive design across mobile, tablet, and desktop viewports
// ============================================================================

'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { useConfigStore } from '@/store/useConfigStore';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { LogEntry } from '@/lib/gis/logParser';
import {
  Card,
  Typography,
  Button,
  Select,
  Tag,
  Alert,
  Spin,
  notification,
  Dropdown,
  type MenuProps
} from 'antd';
import {
  Terminal,
  RefreshCw,
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  AlertCircle,
  ExternalLink,
  Activity,
  Clock,
  Check
} from 'lucide-react';

const { Title, Text } = Typography;

export default function GeoServerLogsPage() {
  const { user, token, hydrated } = useAuthStore();
  const { geoserverUrl: configGeoUrl, fetchConfig } = useConfigStore();

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [counts, setCounts] = useState({
    ALL: 0,
    ERROR: 0,
    WARN: 0,
    INFO: 0,
    DEBUG: 0,
    TRACE: 0,
  });
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>('');

  // Controls & Filters
  const [selectedLevel, setSelectedLevel] = useState<string>('ALL');
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [lineCount, setLineCount] = useState<number>(1000);
  const [expandedTraces, setExpandedTraces] = useState<Record<string, boolean>>({});

  // Auto-Sync / Timer-based Syncing State (Server Database is the single source of truth)
  // Intervals: 0 (Off), 15 (15s), 30 (30s), 60 (1m), 120 (2m), 300 (5m), 600 (10m)
  const [autoSyncInterval, setAutoSyncIntervalState] = useState<number>(0);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  // GeoServer URL loaded directly from user profile or SQLite database config
  const geoserverBaseUrl =
    user?.geoserverUrl ||
    configGeoUrl ||
    process.env.NEXT_PUBLIC_GEOSERVER_URL ||
    'http://localhost:8080/geoserver';

  const nativeLogPageUrl = `${geoserverBaseUrl.replace(/\/+$/, '')}/web/wicket/bookmarkable/org.geoserver.web.admin.LogPage?filter=false`;

  // 1. Fetch live logs directly from GeoServer over HTTP
  // Supports silent background updates for auto-sync without spamming notification toasts
  const handleGetLogs = useCallback(
    async (customLines?: number, silent = false) => {
      if (!silent) {
        setLoading(true);
      } else {
        setIsSyncing(true);
      }
      setErrorMessage('');
      try {
        const headers: Record<string, string> = {
          'Accept': 'application/json',
        };
        if (user?.geoserverAuth) {
          headers['Authorization'] = user.geoserverAuth;
        }
        if (user?.geoserverUrl || configGeoUrl) {
          headers['x-geoserver-url'] = user?.geoserverUrl || configGeoUrl;
        }

        const lines = customLines !== undefined ? customLines : lineCount;
        const params = new URLSearchParams({
          lines: String(lines),
        });

        const res = await fetch(`/api/geoserver/logs?${params.toString()}`, { headers });
        const data = await res.json();

        if (!res.ok || !data.success) {
          setErrorMessage(data.message || 'Unable to retrieve GeoServer logs.');
          return;
        }

        setLogs(data.logs || []);
        setCounts(
          data.counts || {
            ALL: (data.logs || []).length,
            ERROR: 0,
            WARN: 0,
            INFO: 0,
            DEBUG: 0,
            TRACE: 0,
          }
        );
        setLastSyncTime(new Date());

        if (!silent) {
          notification.success({
            message: 'GeoServer Logs Fetched',
            description: `Retrieved and analyzed ${data.logs?.length || 0} log records (${lines} lines requested).`,
            placement: 'topRight',
          });
        }
      } catch (err: unknown) {
        console.error('Failed to get GeoServer logs:', err);
        const errorMsg = err instanceof Error ? err.message : 'Network error while contacting GeoServer logs endpoint.';
        setErrorMessage(errorMsg);
      } finally {
        setLoading(false);
        setIsSyncing(false);
      }
    },
    [user, configGeoUrl, lineCount]
  );

  const setAutoSyncInterval = useCallback(
    (val: number) => {
      setAutoSyncIntervalState(val);
      if (token) {
        fetch('/api/geoserver/logs/settings', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ autoSyncInterval: val, lineCount }),
        }).catch((err) => console.warn('Failed to save log settings to DB:', err));
      }
    },
    [token, lineCount]
  );

  const handleLineCountChange = (val: number) => {
    setLineCount(val);
    if (token) {
      fetch('/api/geoserver/logs/settings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ autoSyncInterval, lineCount: val }),
      }).catch((err) => console.warn('Failed to save lineCount to DB:', err));
    }
    handleGetLogs(val);
  };

  const formatIntervalLabel = useCallback((sec: number) => {
    if (sec === 0) return 'Off';
    if (sec < 60) return `${sec}s`;
    return `${Math.floor(sec / 60)}m`;
  }, []);

  const syncIntervalOptions = useMemo(
    () => [
      { value: 0, label: 'Off (Manual)' },
      { value: 15, label: 'Every 15 seconds' },
      { value: 30, label: 'Every 30 seconds' },
      { value: 60, label: 'Every 1 minute' },
      { value: 120, label: 'Every 2 minutes' },
      { value: 300, label: 'Every 5 minutes' },
      { value: 600, label: 'Every 10 minutes' },
    ],
    []
  );

  const syncMenuItems: MenuProps['items'] = useMemo(
    () =>
      syncIntervalOptions.map((opt) => ({
        key: String(opt.value),
        label: (
          <div className="flex items-center justify-between gap-4 py-1 text-xs">
            <span className={autoSyncInterval === opt.value ? 'font-bold text-indigo-600' : 'text-gray-700'}>
              {opt.label}
            </span>
            {autoSyncInterval === opt.value && <Check size={14} className="text-indigo-600" />}
          </div>
        ),
        onClick: () => setAutoSyncInterval(opt.value),
      })),
    [syncIntervalOptions, autoSyncInterval, setAutoSyncInterval]
  );

  // Initialize logs & settings directly from the backend database (Single Source of Truth)
  // Ensures consistent preferences across incognito sessions, devices, and re-logins
  useEffect(() => {
    if (!hydrated || !token) return;

    let isMounted = true;
    const initLogsAndSettings = async () => {
      let targetLines = 1000;
      try {
        const res = await fetch('/api/geoserver/logs/settings', {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });
        if (res.ok && isMounted) {
          const data = await res.json();
          if (data.success) {
            if (typeof data.autoSyncInterval === 'number') {
              setAutoSyncIntervalState(data.autoSyncInterval);
            }
            if (typeof data.lineCount === 'number') {
              setLineCount(data.lineCount);
              targetLines = data.lineCount;
            }
          }
        }
      } catch (err) {
        console.warn('Failed to load log settings from DB:', err);
      }

      if (isMounted) {
        handleGetLogs(targetLines);
      }
    };

    initLogsAndSettings();
    return () => {
      isMounted = false;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, token]);

  // Timer-based Auto-Sync: periodically fetches fresh logs according to user selection
  useEffect(() => {
    if (autoSyncInterval <= 0 || !hydrated || !token) return;

    const intervalId = setInterval(() => {
      handleGetLogs(lineCount, true);
    }, autoSyncInterval * 1000);

    return () => clearInterval(intervalId);
  }, [autoSyncInterval, hydrated, token, lineCount, handleGetLogs]);

  // 2. Toggle stack trace expansion
  const toggleTrace = (id: string) => {
    setExpandedTraces((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  // Filter & Sort logic for log console
  const filteredLogs = useMemo(() => {
    let result = logs;

    if (selectedLevel !== 'ALL') {
      result = result.filter((entry) => entry.level === selectedLevel);
    }

    return [...result].sort((a, b) => {
      const cmp = a.timestamp.localeCompare(b.timestamp);
      return sortOrder === 'desc' ? -cmp : cmp;
    });
  }, [logs, selectedLevel, sortOrder]);

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 pb-12">
        {/* Header Section */}
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center border border-indigo-100/60 shadow-xs shrink-0">
                <Terminal size={20} />
              </div>
              <Title level={2} className="!m-0 font-extrabold text-gray-800 tracking-tight text-xl sm:text-2xl">
                GeoServer Logs
              </Title>
            </div>
            <Text type="secondary" className="text-xs sm:text-sm text-gray-500 font-normal">
              Direct live diagnostic console for GeoServer logs and server events.
            </Text>
          </div>

          {/* Primary Action Buttons & Auto-Sync Controls */}
          <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
            {/* Beautiful, High-End Auto-Sync Dropdown Button */}
            <Dropdown
              menu={{ items: syncMenuItems }}
              trigger={['click']}
              placement="bottomRight"
            >
              <button
                type="button"
                className={`h-9 px-3.5 rounded-xl border text-xs font-semibold flex items-center gap-2 shadow-xs transition-all cursor-pointer whitespace-nowrap shrink-0 select-none ${
                  autoSyncInterval > 0
                    ? 'border-emerald-300 bg-emerald-50/80 hover:bg-emerald-100/70 text-emerald-900 ring-2 ring-emerald-500/10'
                    : 'border-gray-200/90 bg-white hover:bg-gray-50 text-gray-700 hover:border-gray-300'
                }`}
              >
                {autoSyncInterval > 0 ? (
                  <span className="relative flex h-2 w-2">
                    <span className={`animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 ${isSyncing ? 'opacity-90' : 'opacity-40'}`} />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                  </span>
                ) : (
                  <Clock size={14} className="text-gray-400" />
                )}

                {autoSyncInterval > 0 && (
                  <Clock size={14} className={`text-emerald-600 ${isSyncing ? 'animate-spin' : ''}`} />
                )}

                <span className="whitespace-nowrap">
                  Auto-Sync:{' '}
                  <span className={autoSyncInterval > 0 ? 'font-bold text-emerald-700' : 'text-gray-500 font-normal'}>
                    {formatIntervalLabel(autoSyncInterval)}
                  </span>
                </span>
                <ChevronDown size={12} className={autoSyncInterval > 0 ? 'text-emerald-600 ml-0.5' : 'text-gray-400 ml-0.5'} />
              </button>
            </Dropdown>

            <a
              href={nativeLogPageUrl}
              target="_blank"
              rel="noreferrer"
              className="ant-btn ant-btn-default rounded-xl flex items-center justify-center gap-1.5 shadow-sm text-xs font-semibold whitespace-nowrap shrink-0 py-2 h-9"
            >
              <ExternalLink size={14} />
              Open in GeoServer Web
            </a>

            <Button
              type="primary"
              icon={<RefreshCw size={14} className={loading || isSyncing ? 'animate-spin' : ''} />}
              onClick={() => handleGetLogs()}
              loading={loading}
              className="rounded-xl flex items-center justify-center gap-1.5 shadow-sm bg-indigo-600 hover:bg-indigo-500 font-semibold whitespace-nowrap shrink-0 py-2 h-9"
            >
              Get Logs
            </Button>
          </div>
        </div>

        {/* Responsive KPI Metrics Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
          {/* Card 1: Total Lines */}
          <Card variant="borderless" className="shadow-sm rounded-2xl bg-white border border-gray-100 p-3 sm:p-4">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400 block mb-1">Total Logs</span>
                <span className="text-xl sm:text-2xl font-extrabold text-gray-800">
                  {loading ? <Spin size="small" /> : counts.ALL}
                </span>
              </div>
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                <Terminal size={18} />
              </div>
            </div>
          </Card>

          {/* Card 2: Errors */}
          <Card variant="borderless" className={`shadow-sm rounded-2xl bg-white border p-3 sm:p-4 transition-all ${counts.ERROR > 0 ? 'border-red-200 bg-red-50/20' : 'border-gray-100'}`}>
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400 block mb-1">Errors</span>
                <span className={`text-xl sm:text-2xl font-extrabold ${counts.ERROR > 0 ? 'text-red-600' : 'text-gray-800'}`}>
                  {loading ? <Spin size="small" /> : counts.ERROR}
                </span>
              </div>
              <div className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center shrink-0 ${counts.ERROR > 0 ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-500'}`}>
                <AlertCircle size={18} />
              </div>
            </div>
          </Card>

          {/* Card 3: Warnings */}
          <Card variant="borderless" className={`shadow-sm rounded-2xl bg-white border p-3 sm:p-4 transition-all ${counts.WARN > 0 ? 'border-amber-200 bg-amber-50/20' : 'border-gray-100'}`}>
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400 block mb-1">Warnings</span>
                <span className={`text-xl sm:text-2xl font-extrabold ${counts.WARN > 0 ? 'text-amber-600' : 'text-gray-800'}`}>
                  {loading ? <Spin size="small" /> : counts.WARN}
                </span>
              </div>
              <div className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center shrink-0 ${counts.WARN > 0 ? 'bg-amber-100 text-amber-600' : 'bg-gray-100 text-gray-500'}`}>
                <AlertTriangle size={18} />
              </div>
            </div>
          </Card>

          {/* Card 4: Health */}
          <Card variant="borderless" className="shadow-sm rounded-2xl bg-white border border-gray-100 p-3 sm:p-4">
            <div className="flex items-center justify-between">
              <div>
                <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400 block mb-1">Status</span>
                <span className={`text-xs sm:text-sm font-extrabold flex items-center gap-1 mt-1 ${counts.ERROR > 0 ? 'text-red-600' : counts.ALL > 0 ? 'text-emerald-600' : 'text-gray-400'}`}>
                  {loading ? (
                    <Spin size="small" />
                  ) : counts.ERROR > 0 ? (
                    'Action Needed'
                  ) : counts.ALL > 0 ? (
                    'Normal'
                  ) : (
                    'Idle'
                  )}
                </span>
              </div>
              <div className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center shrink-0 ${counts.ERROR > 0 ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600'}`}>
                <Activity size={18} />
              </div>
            </div>
          </Card>
        </div>

        {/* Error Alert */}
        {errorMessage && (
          <Alert
            type="warning"
            showIcon
            icon={<AlertTriangle size={18} />}
            message="Connection Notice"
            description={
              <div className="space-y-1">
                <p className="m-0 text-xs">{errorMessage}</p>
                <p className="m-0 text-[11px] text-gray-500 break-all">
                  Ensure your GeoServer admin session is active. You can also view logs directly at:{' '}
                  <a
                    href={nativeLogPageUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="underline text-indigo-600 font-mono"
                  >
                    {nativeLogPageUrl}
                  </a>
                </p>
              </div>
            }
            closable
            onClose={() => setErrorMessage('')}
            className="rounded-2xl border-amber-200 bg-amber-50/50"
          />
        )}

        {/* Unified Controls Toolbar: Level Filters + Sort Order & Line Count */}
        <Card variant="borderless" className="shadow-sm rounded-3xl bg-white border border-gray-100 p-3.5 sm:p-4 mb-2">
          <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3.5">
            {/* Level Filter Buttons */}
            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
              <Button
                size="small"
                type={selectedLevel === 'ALL' ? 'primary' : 'default'}
                onClick={() => setSelectedLevel('ALL')}
                className="rounded-lg text-xs font-semibold whitespace-nowrap shrink-0"
              >
                ALL ({counts.ALL})
              </Button>

              <Button
                size="small"
                type={selectedLevel === 'ERROR' ? 'primary' : 'default'}
                danger={selectedLevel === 'ERROR'}
                onClick={() => setSelectedLevel('ERROR')}
                className={`rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 ${selectedLevel !== 'ERROR' ? 'hover:border-red-400 text-red-600' : ''}`}
              >
                ERROR ({counts.ERROR})
              </Button>

              <Button
                size="small"
                type={selectedLevel === 'WARN' ? 'primary' : 'default'}
                onClick={() => setSelectedLevel('WARN')}
                className={`rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 ${selectedLevel === 'WARN' ? 'bg-amber-500 hover:bg-amber-400 border-amber-500 text-white' : 'text-amber-600'}`}
              >
                WARN ({counts.WARN})
              </Button>

              <Button
                size="small"
                type={selectedLevel === 'INFO' ? 'primary' : 'default'}
                onClick={() => setSelectedLevel('INFO')}
                className={`rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 ${selectedLevel === 'INFO' ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'text-blue-600'}`}
              >
                INFO ({counts.INFO})
              </Button>

              <Button
                size="small"
                type={selectedLevel === 'DEBUG' ? 'primary' : 'default'}
                onClick={() => setSelectedLevel('DEBUG')}
                className="rounded-lg text-xs font-semibold text-gray-600 whitespace-nowrap shrink-0"
              >
                DEBUG ({counts.DEBUG})
              </Button>
            </div>

            {/* Global Sort Order and Line Count Controls */}
            <div className="flex flex-wrap items-center justify-between xl:justify-end gap-2.5 pt-2.5 xl:pt-0 border-t xl:border-t-0 border-gray-100">
              <span className="text-xs text-gray-500 font-mono hidden sm:inline whitespace-nowrap">
                Showing <strong className="text-indigo-600">{filteredLogs.length}</strong> of {logs.length}
              </span>

              <Button
                size="middle"
                icon={<ArrowUpDown size={14} />}
                onClick={() => setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc')}
                className="rounded-xl text-xs flex items-center gap-1.5 font-semibold text-gray-700 hover:text-indigo-600 whitespace-nowrap shrink-0"
              >
                {sortOrder === 'desc' ? 'Newest First' : 'Oldest First'}
              </Button>

              <div className="flex items-center gap-2 whitespace-nowrap shrink-0">
                <span className="text-xs text-gray-500 font-medium hidden sm:inline">Lines:</span>
                <Select
                  size="middle"
                  value={lineCount}
                  onChange={handleLineCountChange}
                  className="w-32 text-xs"
                  options={[
                    { value: 100, label: '100 lines' },
                    { value: 300, label: '300 lines' },
                    { value: 500, label: '500 lines' },
                    { value: 1000, label: '1000 lines' },
                  ]}
                />
              </div>
            </div>
          </div>
        </Card>

        {/* Terminal Log Console */}
        <div className="mt-6 sm:mt-8 bg-slate-950 rounded-3xl border border-slate-800 shadow-xl overflow-hidden">
          <div className="bg-slate-900/90 px-4 sm:px-5 py-3 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full bg-red-500/80" />
              <div className="w-3 h-3 rounded-full bg-amber-500/80" />
              <div className="w-3 h-3 rounded-full bg-emerald-500/80" />
              <span className="text-xs font-mono text-slate-400 ml-2">geoserver live console</span>
              {autoSyncInterval > 0 && (
                <span className="text-[11px] font-mono text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded-md border border-emerald-800/60 flex items-center gap-1.5 ml-2">
                  <span className={`w-1.5 h-1.5 rounded-full bg-emerald-400 ${isSyncing ? 'animate-ping' : 'animate-pulse'}`} />
                  Auto-sync ({formatIntervalLabel(autoSyncInterval)})
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 text-xs font-mono text-slate-400">
              {lastSyncTime && (
                <span className="text-slate-400 hidden sm:inline">
                  Synced: <span className="text-slate-300">{lastSyncTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                </span>
              )}
              <div>
                Total <span className="text-emerald-400 font-bold">{logs.length}</span> lines ({lineCount} requested)
              </div>
            </div>
          </div>

              <div className="p-3 sm:p-4 max-h-[520px] sm:max-h-[640px] lg:max-h-[720px] overflow-y-auto space-y-2 font-mono text-xs select-text">
                {loading ? (
                  <div className="py-20 text-center text-slate-400 space-y-3">
                    <Spin size="large" />
                    <p className="text-xs m-0">Connecting to GeoServer LogPage over HTTP...</p>
                  </div>
                ) : filteredLogs.length === 0 ? (
                  <div className="py-20 text-center text-slate-500 space-y-3">
                    <Terminal size={36} className="mx-auto opacity-30 text-slate-400" />
                    <p className="text-sm font-semibold m-0 text-slate-400">No log entries matching filter</p>
                    <p className="text-xs text-slate-500 max-w-md mx-auto m-0">
                      Try selecting <strong className="text-indigo-400">&quot;ALL&quot;</strong> or clicking <strong className="text-indigo-400">&quot;Get Logs&quot;</strong> above.
                    </p>
                  </div>
                ) : (
                  filteredLogs.map((entry) => {
                    const isError = entry.level === 'ERROR';
                    const isWarn = entry.level === 'WARN';
                    const isDebug = entry.level === 'DEBUG';
                    const isExpanded = !!expandedTraces[entry.id];

                    let tagColor = 'blue';
                    if (isError) tagColor = 'error';
                    else if (isWarn) tagColor = 'gold';
                    else if (isDebug) tagColor = 'default';

                    return (
                      <div
                        key={entry.id}
                        className={`p-2.5 sm:p-3 rounded-xl border transition-all ${
                          isError
                            ? 'bg-red-950/20 border-red-900/40 text-red-100 hover:bg-red-950/30'
                            : isWarn
                            ? 'bg-amber-950/15 border-amber-900/30 text-amber-100 hover:bg-amber-950/25'
                            : 'bg-slate-900/60 border-slate-800/80 text-slate-200 hover:bg-slate-900/90'
                        }`}
                      >
                        {/* Header Row */}
                        <div className="flex flex-col sm:flex-row sm:items-baseline gap-1.5 sm:gap-2 text-xs">
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-slate-400 font-medium whitespace-nowrap">{entry.timestamp}</span>
                            <Tag color={tagColor} className="font-bold text-[10px] m-0 px-1.5 py-0 leading-tight">
                              {entry.level}
                            </Tag>
                          </div>
                          <span className="text-indigo-400 font-semibold truncate max-w-[200px] sm:max-w-xs shrink-0">
                            [{entry.logger}]
                          </span>
                          <span className="font-medium text-slate-100 break-words flex-1 min-w-0">
                            {entry.message}
                          </span>
                        </div>

                        {/* Root Cause Banner if identified */}
                        {entry.rootCause && isError && (
                          <div className="mt-2 text-xs bg-red-950/40 border border-red-800/50 p-2 sm:p-2.5 rounded-lg text-red-200 break-words break-all">
                            <span className="font-bold text-red-400 block text-[11px] mb-0.5">Exact Cause:</span>
                            {entry.rootCause}
                          </div>
                        )}

                        {/* Indented Details */}
                        {entry.details && (
                          <pre className="mt-2 text-[11px] text-slate-400 bg-slate-950/60 p-2 sm:p-2.5 rounded-lg overflow-x-auto whitespace-pre-wrap break-all sm:break-words border border-slate-800/50">
                            {entry.details}
                          </pre>
                        )}

                        {/* Stack Trace Collapsible Block */}
                        {entry.stackTrace && (
                          <div className="mt-2.5 pt-2 border-t border-red-900/30">
                            <button
                              onClick={() => toggleTrace(entry.id)}
                              className="flex items-center gap-1 text-[11px] font-semibold text-red-400 hover:text-red-300 cursor-pointer transition-colors"
                            >
                              {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                              <span>{isExpanded ? 'Hide Stack Trace' : 'Show Exception Stack Trace'}</span>
                            </button>

                            {isExpanded && (
                              <pre className="mt-2 text-[11px] text-red-300 bg-red-950/40 p-2.5 sm:p-3 rounded-lg overflow-x-auto whitespace-pre-wrap break-all sm:break-words border border-red-900/50 font-mono">
                                {entry.stackTrace}
                              </pre>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
      </div>
    </DashboardLayout>
  );
}
