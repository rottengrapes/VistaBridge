// ============================================================================
// System Overview Page (/overview)
//
// Administrative dashboard showing connected GIS services:
// - GeoServer connection status & health check
// - Metrics: total workspaces, layers, layer groups, and registered users
// - Quick status cards linking to map workspaces and datasets
// - Real-time GeoServer Request Monitoring (WMS, WFS, WCS calls, latency & logs)
// ============================================================================

'use client';

import { useEffect, useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/useAuthStore';
import { useGeoServerServicesStore } from '@/store/useGeoServerServicesStore';
import { Spin, Typography, Card, Table, Tag, Select, Button, Tooltip, Alert } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  User as UserIcon,
  Layers,
  Globe,
  Layers3,
  Server,
  CheckCircle2,
  XCircle,
  RefreshCw,
  Activity,
  Clock,
  AlertTriangle,
  Radio,
  FileText,
  Filter
} from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';

const { Title, Text } = Typography;

interface WorkspaceItem {
  name: string;
}

interface LayerItem {
  name: string;
  title: string;
}

interface UserItem {
  userName: string;
  enabled?: boolean;
}

interface GeoserverOverviewData {
  geoserverConnected: boolean;
  workspaces: WorkspaceItem[];
  layers: LayerItem[];
  layerGroups: unknown[];
  users: UserItem[];
}

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

export default function OverviewPage() {
  const router = useRouter();
  const { user, token, hydrated } = useAuthStore();
  const services = useGeoServerServicesStore();
  const [geoserverData, setGeoserverData] = useState<GeoserverOverviewData | null>(null);
  const [geoserverLoading, setGeoserverLoading] = useState(true);

  // GeoServer Monitor Extension State
  const [monitorData, setMonitorData] = useState<MonitorApiResponse | null>(null);
  const [monitorLoading, setMonitorLoading] = useState(false);
  const [serviceFilter, setServiceFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  // 1. Guard check: redirect guests to login
  useEffect(() => {
    if (hydrated && !token) {
      router.replace('/login');
    }
  }, [hydrated, token, router]);

  // 2. Fetch GeoServer Monitor metrics
  const fetchMonitorMetrics = async () => {
    setMonitorLoading(true);
    try {
      const headers: Record<string, string> = {
        'Accept': 'application/json',
      };
      if (user?.geoserverAuth) {
        headers['Authorization'] = user.geoserverAuth;
      }
      if (user?.geoserverUrl) {
        headers['x-geoserver-url'] = user.geoserverUrl;
      }

      const res = await fetch('/api/geoserver/monitor', { headers });
      const data: MonitorApiResponse = await res.json();
      setMonitorData(data);
    } catch (err) {
      console.warn('Failed to fetch GeoServer monitor metrics:', err);
    } finally {
      setMonitorLoading(false);
    }
  };

  // 3. Probe and synchronize active GeoServer service capabilities (WMS, WFS, WMTS, WCS, WPS)
  const fetchServiceCapabilities = async () => {
    try {
      const headers: Record<string, string> = {
        'Accept': 'application/json',
      };
      if (user?.geoserverAuth) {
        headers['Authorization'] = user.geoserverAuth;
      }
      if (user?.geoserverUrl) {
        headers['x-geoserver-url'] = user.geoserverUrl;
      }

      const checkRes = await fetch('/api/geoserver/services/check', { headers });
      if (checkRes.ok) {
        const checkData = await checkRes.json();
        const s = checkData.services || {};
        const isWmsAvailable = !!s.wms?.available;
        const isWfsAvailable = !!s.wfs?.available;
        const isWmtsAvailable = !!s.wmts?.available;
        const isWcsAvailable = !!s.wcs?.available;
        const isWpsAvailable = !!s.wps?.available;

        let autoCapabilitiesMode: 'WMS' | 'WFS' | 'WMTS' | 'ALL' = 'WMS';
        if (!isWmsAvailable && isWfsAvailable) {
          autoCapabilitiesMode = 'WFS';
        } else if (!isWmsAvailable && !isWfsAvailable && isWmtsAvailable) {
          autoCapabilitiesMode = 'WMTS';
        }

        services.setConfig({
          wms: { enabled: isWmsAvailable, version: s.wms?.version || '1.3.0' },
          wfs: { enabled: isWfsAvailable, version: s.wfs?.version || '1.1.0' },
          wmts: { enabled: isWmtsAvailable, version: s.wmts?.version || '1.0.0' },
          wcs: { enabled: isWcsAvailable, version: s.wcs?.version || '2.0.1' },
          wps: { enabled: isWpsAvailable, version: s.wps?.version || '1.0.0' },
          capabilitiesMode: autoCapabilitiesMode,
          defaultLayerService: isWmsAvailable ? 'WMS' : (isWmtsAvailable ? 'WMTS' : 'WMS'),
        });
      }
    } catch (servicesErr) {
      console.warn('Overview services check:', servicesErr);
    }
  };

  // 4. Fetch GeoServer overview data, services, & monitor data on mount
  useEffect(() => {
    if (!hydrated || !token || !user) return;

    fetchServiceCapabilities();
    fetchMonitorMetrics();

    const fetchGeoServerOverview = async () => {
      setGeoserverLoading(true);
      try {
        const geoserverUrl = user.geoserverUrl || (process.env.NEXT_PUBLIC_GEOSERVER_URL || 'http://localhost:8080/geoserver').replace(/\/$/, '');
        const headers: Record<string, string> = {
          'Accept': 'application/json',
        };
        if (user.geoserverAuth) {
          headers['Authorization'] = user.geoserverAuth;
        }

        const isAdmin = user.role === 'ADMIN' || user.username === 'admin';

        let workspacesList: WorkspaceItem[] = [];
        let layersList: LayerItem[] = [];
        let layerGroupsList: unknown[] = [];
        let usersList: UserItem[] = [];
        let geoserverConnected = false;

        if (isAdmin) {
          try {
            const overviewRes = await fetch('/api/geoserver/overview');
            if (overviewRes.ok) {
              const overviewData = await overviewRes.json();
              if (overviewData.geoserverConnected) {
                geoserverConnected = true;
                workspacesList = overviewData.workspaces || [];
                layersList = overviewData.layers || [];
                layerGroupsList = overviewData.layerGroups || [];
                usersList = overviewData.users || [];
              }
            }
          } catch (restErr) {
            console.error('Failed to fetch overview data from /api/geoserver/overview:', restErr);
          }
        }

        if (!geoserverConnected) {
          try {
            const capUrl = `${geoserverUrl}/ows?service=WMS&version=1.3.0&request=GetCapabilities`;
            const capRes = await fetch(capUrl, { headers });
            if (capRes.ok) {
              geoserverConnected = true;
              const xmlText = await capRes.text();
              const parser = new DOMParser();
              const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
              const layerElements = xmlDoc.getElementsByTagName('Layer');

              const workspacesSet = new Set<string>();
              const layers: LayerItem[] = [];

              for (let i = 0; i < layerElements.length; i++) {
                const nameEl = Array.from(layerElements[i].children).find(el => el.tagName === 'Name');
                const titleEl = Array.from(layerElements[i].children).find(el => el.tagName === 'Title');

                if (nameEl && nameEl.textContent) {
                  const fullName = nameEl.textContent.trim();
                  if (fullName.includes(':')) {
                    const [workspaceName, layerName] = fullName.split(':');
                    workspacesSet.add(workspaceName);
                    layers.push({
                      name: fullName,
                      title: titleEl && titleEl.textContent ? titleEl.textContent.trim() : layerName,
                    });
                  }
                }
              }

              workspacesList = Array.from(workspacesSet).map(name => ({ name }));
              layersList = layers;
              layerGroupsList = [];

              if (!isAdmin && user.username) {
                usersList = [{ userName: user.username, enabled: true }];
              } else if (usersList.length === 0) {
                usersList = [{ userName: user.username || 'admin', enabled: true }];
              }
            }
          } catch (capErr) {
            console.error('Failed to parse GetCapabilities XML:', capErr);
          }
        }

        setGeoserverData({
          geoserverConnected,
          workspaces: workspacesList,
          layers: layersList,
          layerGroups: layerGroupsList,
          users: workspacesList.length > 0 ? usersList : [],
        });
      } catch (error) {
        console.error('Failed to fetch GeoServer overview:', error);
      } finally {
        setGeoserverLoading(false);
      }
    };

    fetchGeoServerOverview();
    fetchMonitorMetrics();
  }, [hydrated, token, user]);

  // Filtered requests for the table
  const filteredRequests = useMemo(() => {
    if (!monitorData?.requests) return [];
    return monitorData.requests.filter(item => {
      if (serviceFilter !== 'ALL' && item.service.toUpperCase() !== serviceFilter) {
        return false;
      }
      if (statusFilter === 'SUCCESS') {
        const isErr = (item.responseStatus && item.responseStatus >= 400) || item.status === 'FAILED' || !!item.errorMessage;
        return !isErr;
      }
      if (statusFilter === 'ERROR') {
        const isErr = (item.responseStatus && item.responseStatus >= 400) || item.status === 'FAILED' || !!item.errorMessage;
        return isErr;
      }
      return true;
    });
  }, [monitorData, serviceFilter, statusFilter]);

  // Request Log Table Columns
  const columns: ColumnsType<MonitorRequestItem> = [
    {
      title: 'Time',
      dataIndex: 'startTime',
      key: 'startTime',
      width: 130,
      render: (val: string) => {
        try {
          const d = new Date(val);
          return (
            <span className="text-xs font-mono text-gray-600">
              {d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
          );
        } catch {
          return <span className="text-xs font-mono text-gray-500">{val}</span>;
        }
      },
    },
    {
      title: 'Service',
      dataIndex: 'service',
      key: 'service',
      width: 130,
      render: (svc: string) => {
        const upper = (svc || '').toUpperCase();
        let color = 'default';
        if (upper === 'WMS') color = 'blue';
        else if (upper === 'WFS') color = 'green';
        else if (upper === 'WCS') color = 'gold';
        else if (upper === 'WMTS') color = 'purple';
        else if (upper.includes('REST')) color = 'geekblue';
        return (
          <div className="pr-3 inline-block">
            <Tag color={color} className="font-semibold text-[11px] m-0">
              {upper || 'OTHER'}
            </Tag>
          </div>
        );
      },
    },
    {
      title: 'Operation',
      dataIndex: 'operation',
      key: 'operation',
      width: 150,
      render: (op: string) => (
        <span className="font-medium text-xs text-gray-800 pl-1">{op}</span>
      ),
    },
    {
      title: 'Target Layer / Path',
      dataIndex: 'resources',
      key: 'resources',
      ellipsis: true,
      render: (resources: string, record) => {
        const display = resources || record.path || '-';
        return (
          <Tooltip title={display}>
            <span className="text-xs text-gray-600 font-mono truncate max-w-xs block">
              {display}
            </span>
          </Tooltip>
        );
      },
    },
    {
      title: 'Duration',
      dataIndex: 'totalTime',
      key: 'totalTime',
      width: 100,
      render: (ms: number) => {
        let colorClass = 'text-emerald-600';
        if (ms > 500) colorClass = 'text-red-600';
        else if (ms > 150) colorClass = 'text-amber-600';
        return <span className={`font-mono text-xs font-semibold ${colorClass}`}>{ms} ms</span>;
      },
    },
    {
      title: 'Status',
      key: 'status',
      width: 110,
      render: (_, record) => {
        const isError = (record.responseStatus && record.responseStatus >= 400) || record.status === 'FAILED' || !!record.errorMessage;
        const label = record.responseStatus ? `${record.responseStatus}` : record.status;
        return (
          <Tag color={isError ? 'error' : 'success'} className="text-[11px] m-0">
            {label}
          </Tag>
        );
      },
    },
  ];

  if (!hydrated || !token) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <Spin size="large" description="Establishing secure session..." />
      </div>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
        {/* Header Section */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex flex-col gap-1">
            <Title level={2} className="m-0">Overview</Title>
            <Text type="secondary" className="text-base text-gray-500 font-normal">
              Welcome to your spatial data infrastructure workspace.
            </Text>
          </div>
          <Button
            icon={<RefreshCw size={14} className={monitorLoading || geoserverLoading ? 'animate-spin' : ''} />}
            onClick={() => {
              fetchMonitorMetrics();
            }}
            loading={monitorLoading}
            className="rounded-xl flex items-center gap-1.5 shadow-sm self-start sm:self-auto"
          >
            Refresh Metrics
          </Button>
        </div>

        {/* Stats Grid Cards: Exactly three columns in one line on medium screens and up */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Card 1: Layers */}
          <Card variant="borderless" className="shadow-sm rounded-3xl hover:shadow-md transition-all group bg-white border border-gray-100/55 p-5">
            <div className="flex items-start justify-between">
              <div>
                <Text type="secondary" className="text-xs uppercase font-bold tracking-widest block mb-4 text-gray-400">GeoServer Layers</Text>
                <Title level={1} className="m-0 font-extrabold text-gray-800 leading-none">
                  {geoserverLoading ? <Spin size="small" /> : (geoserverData?.layers?.length || 0)}
                </Title>
              </div>
              <div className="w-12 h-12 bg-blue-50 text-blue-600 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform shadow-sm">
                <Layers size={24} />
              </div>
            </div>
          </Card>

          {/* Card 2: Workspaces */}
          <Card variant="borderless" className="shadow-sm rounded-3xl hover:shadow-md transition-all group bg-white border border-gray-100/55 p-5">
            <div className="flex items-start justify-between">
              <div>
                <Text type="secondary" className="text-xs uppercase font-bold tracking-widest block mb-4 text-gray-400">GeoServer Workspaces</Text>
                <Title level={1} className="m-0 font-extrabold text-gray-800 leading-none">
                  {geoserverLoading ? <Spin size="small" /> : (geoserverData?.workspaces?.length || 0)}
                </Title>
              </div>
              <div className="w-12 h-12 bg-purple-50 text-purple-600 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform shadow-sm">
                <Globe size={24} />
              </div>
            </div>
          </Card>

          {/* Card 3: Security Users */}
          <Card variant="borderless" className="shadow-sm rounded-3xl hover:shadow-md transition-all group bg-white border border-gray-100/55 p-5">
            <div className="flex items-start justify-between">
              <div>
                <Text type="secondary" className="text-xs uppercase font-bold tracking-widest block mb-4 text-gray-400">Security Users</Text>
                <Title level={1} className="m-0 font-extrabold text-gray-800 leading-none">
                  {geoserverLoading ? <Spin size="small" /> : (geoserverData?.users?.length || 0)}
                </Title>
              </div>
              <div className="w-12 h-12 bg-orange-50 text-orange-600 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform shadow-sm">
                <UserIcon size={24} />
              </div>
            </div>
          </Card>
        </div>

        {/* Second Row: Layer Groups Card and GeoServer Services & Capabilities Card */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Card 4: Layer Groups */}
          <Card variant="borderless" className="shadow-sm rounded-3xl hover:shadow-md transition-all group bg-white border border-gray-100/55 p-5">
            <div className="flex items-start justify-between">
              <div>
                <Text type="secondary" className="text-xs uppercase font-bold tracking-widest block mb-4 text-gray-400">Layer Groups</Text>
                <Title level={1} className="m-0 font-extrabold text-gray-800 leading-none">
                  {geoserverLoading ? <Spin size="small" /> : (geoserverData?.layerGroups?.length || 0)}
                </Title>
              </div>
              <div className="w-12 h-12 bg-teal-50 text-teal-600 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform shadow-sm">
                <Layers3 size={24} />
              </div>
            </div>
          </Card>

          {/* Card 5: GeoServer Services & Capabilities Overview (Spans 2 columns) */}
          <Card variant="borderless" className="shadow-sm rounded-3xl hover:shadow-md transition-all bg-white border border-gray-100/55 p-5 md:col-span-2">
            <div className="flex flex-col h-full justify-between gap-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 bg-blue-50 text-blue-600 rounded-xl flex items-center justify-center">
                    <Server size={18} />
                  </div>
                  <div>
                    <span className="text-xs uppercase font-bold tracking-widest block text-gray-400">Active GeoServer Services</span>
                  </div>
                </div>
              </div>

              {/* Service Badges Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 pt-2 border-t border-gray-100">
                <div className={`p-2.5 rounded-xl border flex flex-col gap-1 ${services.wms.enabled ? 'bg-emerald-50/50 border-emerald-200' : 'bg-gray-50 border-gray-200 opacity-60'}`}>
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-gray-800">WMS</span>
                    {services.wms.enabled ? <CheckCircle2 size={13} className="text-emerald-600" /> : <XCircle size={13} className="text-gray-400" />}
                  </div>
                  <span className="text-[10px] text-gray-500 font-medium">
                    {services.wms.enabled ? `v${services.wms.version} Active` : 'Disabled'}
                  </span>
                </div>

                <div className={`p-2.5 rounded-xl border flex flex-col gap-1 ${services.wfs.enabled ? 'bg-emerald-50/50 border-emerald-200' : 'bg-gray-50 border-gray-200 opacity-60'}`}>
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-gray-800">WFS</span>
                    {services.wfs.enabled ? <CheckCircle2 size={13} className="text-emerald-600" /> : <XCircle size={13} className="text-gray-400" />}
                  </div>
                  <span className="text-[10px] text-gray-500 font-medium">
                    {services.wfs.enabled ? `v${services.wfs.version} Active` : 'Disabled'}
                  </span>
                </div>

                <div className={`p-2.5 rounded-xl border flex flex-col gap-1 ${services.wmts.enabled ? 'bg-emerald-50/50 border-emerald-200' : 'bg-gray-50 border-gray-200 opacity-60'}`}>
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-gray-800">WMTS</span>
                    {services.wmts.enabled ? <CheckCircle2 size={13} className="text-emerald-600" /> : <XCircle size={13} className="text-gray-400" />}
                  </div>
                  <span className="text-[10px] text-gray-500 font-medium">
                    {services.wmts.enabled ? `v${services.wmts.version} Active` : 'Disabled'}
                  </span>
                </div>

                <div className={`p-2.5 rounded-xl border flex flex-col gap-1 ${services.wcs.enabled ? 'bg-emerald-50/50 border-emerald-200' : 'bg-gray-50 border-gray-200 opacity-60'}`}>
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-gray-800">WCS</span>
                    {services.wcs.enabled ? <CheckCircle2 size={13} className="text-emerald-600" /> : <XCircle size={13} className="text-gray-400" />}
                  </div>
                  <span className="text-[10px] text-gray-500 font-medium">
                    {services.wcs.enabled ? `v${services.wcs.version} Active` : 'Disabled'}
                  </span>
                </div>

                <div className={`p-2.5 rounded-xl border flex flex-col gap-1 ${services.wps.enabled ? 'bg-emerald-50/50 border-emerald-200' : 'bg-gray-50 border-gray-200 opacity-60'}`}>
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-xs text-gray-800">WPS</span>
                    {services.wps.enabled ? <CheckCircle2 size={13} className="text-emerald-600" /> : <XCircle size={13} className="text-gray-400" />}
                  </div>
                  <span className="text-[10px] text-gray-500 font-medium">
                    {services.wps.enabled ? `v${services.wps.version} Active` : 'Disabled'}
                  </span>
                </div>
              </div>
            </div>
          </Card>
        </div>

        {/* Third Section: Service Activity & Request Monitor */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                <Activity size={18} />
              </div>
              <div>
                <h3 className="m-0 font-bold text-gray-800 text-lg">Service Activity & Request Monitor</h3>
                <p className="m-0 text-xs text-gray-500">Live request audit and performance metrics from GeoServer Monitor</p>
              </div>
            </div>
          </div>

          {/* If the monitor extension is not detected / inactive */}
          {monitorData && !monitorData.available ? (
            <Alert
              type="warning"
              showIcon
              icon={<AlertTriangle size={20} />}
              message={<span className="font-semibold text-gray-800">GeoServer Monitor Extension Not Detected</span>}
              description={
                <div className="space-y-2 mt-1">
                  <p className="text-xs text-gray-600 m-0">
                    {monitorData.message || 'GeoServer Monitor extension is not currently active.'}
                  </p>
                  <div className="text-xs text-gray-500 bg-amber-50/60 p-2.5 rounded-lg border border-amber-200/60">
                    <span className="font-semibold block text-amber-900 mb-1">To enable live request logs:</span>
                    <ol className="list-decimal pl-4 space-y-0.5 m-0">
                      <li>Verify the <code className="font-mono bg-amber-100/80 px-1 rounded">gs-monitor-*.jar</code> is placed in your GeoServer's <code className="font-mono bg-amber-100/80 px-1 rounded">webapps/geoserver/WEB-INF/lib</code> folder.</li>
                      <li>Restart GeoServer (Tomcat or standalone service).</li>
                    </ol>
                  </div>
                  <Button
                    size="small"
                    type="primary"
                    onClick={fetchMonitorMetrics}
                    loading={monitorLoading}
                    className="mt-1"
                  >
                    Retry Connection
                  </Button>
                </div>
              }
              className="rounded-2xl border-amber-200 bg-amber-50/30 p-4"
            />
          ) : (
            <>
              {/* Monitor KPI Cards */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {/* Metric 1: Total Calls */}
                <Card variant="borderless" className="shadow-sm rounded-2xl bg-white border border-gray-100 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400 block mb-1">Total Requests</span>
                      <span className="text-2xl font-extrabold text-gray-800">
                        {monitorLoading ? <Spin size="small" /> : (monitorData?.totalRequests ?? 0)}
                      </span>
                    </div>
                    <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                      <Radio size={20} />
                    </div>
                  </div>
                </Card>

                {/* Metric 2: WMS Calls */}
                <Card variant="borderless" className="shadow-sm rounded-2xl bg-white border border-gray-100 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400 block mb-1">WMS (Map) Calls</span>
                      <span className="text-2xl font-extrabold text-blue-600">
                        {monitorLoading ? <Spin size="small" /> : (monitorData?.wmsCount ?? 0)}
                      </span>
                    </div>
                    <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-xs">
                      WMS
                    </div>
                  </div>
                </Card>

                {/* Metric 3: WFS & WCS Calls */}
                <Card variant="borderless" className="shadow-sm rounded-2xl bg-white border border-gray-100 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400 block mb-1">WFS & WCS Calls</span>
                      <span className="text-2xl font-extrabold text-emerald-600">
                        {monitorLoading ? <Spin size="small" /> : ((monitorData?.wfsCount ?? 0) + (monitorData?.wcsCount ?? 0))}
                      </span>
                    </div>
                    <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold text-xs">
                      DATA
                    </div>
                  </div>
                </Card>

                {/* Metric 4: Avg Latency & Errors */}
                <Card variant="borderless" className="shadow-sm rounded-2xl bg-white border border-gray-100 p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-[11px] font-bold uppercase tracking-wider text-gray-400 block mb-1">Avg Latency</span>
                      <div className="flex items-baseline gap-2">
                        <span className="text-2xl font-extrabold text-gray-800">
                          {monitorLoading ? <Spin size="small" /> : `${monitorData?.avgLatencyMs ?? 0} ms`}
                        </span>
                      </div>
                    </div>
                    <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
                      <Clock size={20} />
                    </div>
                  </div>
                </Card>
              </div>

              {/* Request Audit Log Table Card */}
              <Card variant="borderless" className="shadow-sm rounded-3xl bg-white border border-gray-100/55 p-5">
                <div className="space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-gray-100">
                    <div className="flex items-center gap-2">
                      <FileText size={16} className="text-gray-400" />
                      <span className="font-bold text-gray-700 text-sm">Recent Request Audit Log</span>
                      <span className="text-xs text-gray-400 font-normal">
                        ({filteredRequests.length} {filteredRequests.length === 1 ? 'record' : 'records'})
                      </span>
                    </div>

                    {/* Filters */}
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex items-center gap-1.5">
                        <Filter size={13} className="text-gray-400" />
                        <span className="text-xs text-gray-500 font-medium">Service:</span>
                        <Select
                          size="small"
                          value={serviceFilter}
                          onChange={setServiceFilter}
                          className="w-24 text-xs"
                          options={[
                            { value: 'ALL', label: 'All' },
                            { value: 'WMS', label: 'WMS' },
                            { value: 'WFS', label: 'WFS' },
                            { value: 'WCS', label: 'WCS' },
                            { value: 'WMTS', label: 'WMTS' },
                            { value: 'OTHER', label: 'Other' },
                          ]}
                        />
                      </div>

                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-gray-500 font-medium">Status:</span>
                        <Select
                          size="small"
                          value={statusFilter}
                          onChange={setStatusFilter}
                          className="w-28 text-xs"
                          options={[
                            { value: 'ALL', label: 'All Status' },
                            { value: 'SUCCESS', label: 'Success (2xx)' },
                            { value: 'ERROR', label: 'Errors (>=400)' },
                          ]}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Logs Table */}
                  <Table
                    columns={columns}
                    dataSource={filteredRequests}
                    rowKey="id"
                    loading={monitorLoading}
                    pagination={{ pageSize: 8, showSizeChanger: false, size: 'small' }}
                    size="small"
                    className="overflow-x-auto text-xs"
                    locale={{
                      emptyText: (
                        <div className="py-8 text-center text-gray-400">
                          <Activity size={28} className="mx-auto mb-2 opacity-40" />
                          <p className="text-xs m-0">No service requests recorded yet.</p>
                          <p className="text-[11px] text-gray-400 m-0">Incoming WMS, WFS, or WCS calls to GeoServer will appear here in real-time.</p>
                        </div>
                      ),
                    }}
                  />
                </div>
              </Card>
            </>
          )}
        </div>

      </div>
    </DashboardLayout>
  );
}
