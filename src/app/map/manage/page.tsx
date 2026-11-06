// ============================================================================
// Map Workspaces Manager Page (/map/manage)
//
// Lists all saved GIS map workspaces stored in SQLite:
// - Grid and Table view modes
// - Search filter by map title and description
// - Shows sharing status (PUBLIC or PRIVATE) and creator info
// - Quick actions: Open in 2D Map Viewer, Edit metadata, Rename, and Delete
// ============================================================================

'use client';

import Link from 'next/link';
import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  Table,
  Tag,
  Space,
  Typography,
  Input,
  Card,
  Button,
  Tooltip,
  App,
  Select,
  DatePicker,
  Empty,
  Spin,
  Segmented,
  Modal,
  Radio,
} from 'antd';
import {
  Search,
  Filter,
  RefreshCw,
  Map as MapIcon,
  Trash2,
  Lock,
  Globe,
  Eye,
  X,
  Edit3,
  Copy,
  Plus,
  Share2,
  Check,
  Link as LinkIcon,
} from 'lucide-react';
import DashboardLayout from '@/components/layout/DashboardLayout';
import { useAuthStore } from '@/store/useAuthStore';
import { useUIStore } from '@/store/useUIStore';
import { apiRequest } from '@/lib/api';
import { siteConfig } from '@/config/site-config';
import { slugify } from '@/lib/slug';
import { formatRelativeTime, formatFullDate, compareDates, parseDate, dayjs } from '@/lib/dateUtils';

const { Title, Text } = Typography;

interface MapWorkspace {
  id: string;
  slug?: string;
  name: string;
  description: string;
  share: 'PRIVATE' | 'INTERNAL' | 'PUBLIC';
  type: '2D' | '3D' | 'POINTCLOUD';
  created_at: string;
  updated_at: string;
  center_lon?: number;
  center_lat?: number;
  zoom?: number;
  basemap_id?: string;
  layers?: unknown[];
}

export default function ManageMapsPage() {
  const router = useRouter();
  const { notification, modal } = App.useApp();
  const { token, hydrated } = useAuthStore();
  const { setCreateMapModalOpen, globalSearch, setGlobalSearch } = useUIStore();
  const [loading, setLoading] = useState(true);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 768);
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  const [maps, setMaps] = useState<MapWorkspace[]>([]);

  // Compute summary stats for the top workspace cards
  const stats = useMemo(() => {
    const total = maps.length;
    const publicCount = maps.filter((m) => m.share === 'PUBLIC').length;
    const privateCount = maps.filter((m) => m.share === 'PRIVATE').length;
    return {
      total,
      public: publicCount,
      private: privateCount,
    };
  }, [maps]);
  const [showFilters, setShowFilters] = useState(false);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [pageSize, setPageSize] = useState(8);
  const [currentPage, setCurrentPage] = useState(1);

  // Filter States
  const [activeShare, setActiveShare] = useState<string>('ALL');
  const [shareFilter, setShareFilter] = useState<string | null>(null);
  const [beforeDate, setBeforeDate] = useState<dayjs.Dayjs | null>(null);
  const [afterDate, setAfterDate] = useState<dayjs.Dayjs | null>(null);
  const [localSearch, setLocalSearch] = useState('');

  // Edit Details Modal States
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingMap, setEditingMap] = useState<MapWorkspace | null>(null);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [savingDetails, setSavingDetails] = useState(false);

  // Share Modal States
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [sharingMap, setSharingMap] = useState<MapWorkspace | null>(null);
  const [shareVisibility, setShareVisibility] = useState<'PUBLIC' | 'PRIVATE'>('PRIVATE');
  const [savingSharing, setSavingSharing] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  const fetchMaps = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const response = await apiRequest('/maps/');
      if (!response.ok) throw new Error('Failed to fetch map workspaces');
      const data = await response.json();
      setMaps(data);
    } catch (error: unknown) {
      if (!silent) {
        notification.error({
          message: 'Error',
          description: (error as Error).message || 'Could not load map workspaces.',
          placement: 'topRight',
        });
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, [notification]);

  useEffect(() => {
    if (token) {
      queueMicrotask(() => {
        fetchMaps();
      });
    }
  }, [token, fetchMaps]);

  // Redirect guest users trying to access manage maps page
  useEffect(() => {
    if (hydrated && !token) {
      router.replace('/login');
    }
  }, [hydrated, token, router]);

  const filteredMaps = useMemo(() => {
    let filtered = [...maps];

    // 1. Filter by Segmented Tab (ALL, PUBLIC, PRIVATE)
    if (activeShare === 'PUBLIC') {
      filtered = filtered.filter(m => m.share === 'PUBLIC');
    } else if (activeShare === 'PRIVATE') {
      filtered = filtered.filter(m => m.share === 'PRIVATE');
    }

    // 2. Filter by global/navbar search text
    if (globalSearch) {
      const lowerSearch = globalSearch.trim().toLowerCase();
      if (lowerSearch) {
        filtered = filtered.filter(m =>
          m.name.toLowerCase().includes(lowerSearch) ||
          m.id.toLowerCase().includes(lowerSearch) ||
          (m.description && m.description.toLowerCase().includes(lowerSearch))
        );
      }
    }

    // 3. Filter by local search text
    if (localSearch) {
      const lowerSearch = localSearch.trim().toLowerCase();
      if (lowerSearch) {
        filtered = filtered.filter(m =>
          m.name.toLowerCase().includes(lowerSearch) ||
          m.id.toLowerCase().includes(lowerSearch) ||
          (m.description && m.description.toLowerCase().includes(lowerSearch))
        );
      }
    }

    // 4. Filter by Visibility (Share)
    if (shareFilter) {
      filtered = filtered.filter(m => m.share === shareFilter);
    }

    // 5. Filter by Created After
    if (afterDate) {
      filtered = filtered.filter(m => {
        const d = parseDate(m.created_at || m.updated_at);
        return d ? (d.isAfter(afterDate, 'day') || d.isSame(afterDate, 'day')) : false;
      });
    }

    // 6. Filter by Created Before
    if (beforeDate) {
      filtered = filtered.filter(m => {
        const d = parseDate(m.created_at || m.updated_at);
        return d ? (d.isBefore(beforeDate, 'day') || d.isSame(beforeDate, 'day')) : false;
      });
    }

    return filtered;
  }, [globalSearch, localSearch, activeShare, maps, shareFilter, beforeDate, afterDate]);

  const resetFilters = () => {
    setActiveShare('ALL');
    setShareFilter(null);
    setBeforeDate(null);
    setAfterDate(null);
    setGlobalSearch('');
    setLocalSearch('');
    setCurrentPage(1);
  };

  const deleteWorkspace = (id: string, name: string) => {
    modal.confirm({
      title: 'Delete Map Workspace',
      content: `Are you sure you want to delete the map workspace "${name}"? This action cannot be undone.`,
      okText: 'Delete Workspace',
      okType: 'danger',
      cancelText: 'Cancel',
      async onOk() {
        try {
          const response = await apiRequest(`/maps/${id}/`, {
            method: 'DELETE',
          });
          if (!response.ok) throw new Error('Failed to delete map');
          notification.success({
            message: 'Workspace Deleted',
            description: `Successfully removed map workspace "${name}"`,
            placement: 'topRight',
          });
          setSelectedRowKeys(prev => prev.filter(k => k !== id));
          fetchMaps(true);
        } catch (err: unknown) {
          notification.error({
            message: 'Error',
            description: (err as Error).message || 'Could not delete the workspace.',
            placement: 'topRight',
          });
        }
      }
    });
  };

  const deleteSelectedWorkspaces = () => {
    modal.confirm({
      title: 'Bulk Delete Workspaces',
      content: `Are you sure you want to delete ${selectedRowKeys.length} selected map workspaces? This action cannot be undone.`,
      okText: 'Delete All',
      okType: 'danger',
      cancelText: 'Cancel',
      async onOk() {
        try {
          // Sequentially delete selected maps
          for (const key of selectedRowKeys) {
            await apiRequest(`/maps/${String(key)}/`, {
              method: 'DELETE',
            });
          }
          notification.success({
            message: 'Workspaces Deleted',
            description: `Successfully removed ${selectedRowKeys.length} workspaces.`,
            placement: 'topRight',
          });
          setSelectedRowKeys([]);
          fetchMaps(true);
        } catch (err: unknown) {
          notification.error({
            message: 'Error',
            description: (err as Error).message || 'An error occurred during deletion.',
            placement: 'topRight',
          });
        }
      }
    });
  };

  const handleClone = async (map: MapWorkspace) => {
    try {
      const baseSlug = map.slug ? `${map.slug}_copy` : slugify(`${map.name}_copy`);
      const payload = {
        name: `${map.name} (Copy)`.slice(0, 32),
        slug: baseSlug,
        description: map.description || '',
        share: map.share || 'PRIVATE',
        type: map.type || '2D',
        center_lon: map.center_lon,
        center_lat: map.center_lat,
        zoom: map.zoom,
        basemap_id: map.basemap_id,
        layers: map.layers || [],
      };
      const res = await apiRequest('/maps', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const cloned = await res.json();
      if (!res.ok) throw new Error(cloned.detail || `HTTP ${res.status}`);
      notification.success({
        message: 'Map Cloned',
        description: `Created clone "${cloned.name}"`,
        placement: 'topRight',
      });
      fetchMaps(true);
    } catch (err: unknown) {
      notification.error({
        message: 'Error',
        description: (err as Error).message || 'Failed to clone map workspace.',
        placement: 'topRight',
      });
    }
  };

  const openEditModal = (map: MapWorkspace) => {
    setEditingMap(map);
    setEditName(map.name);
    setEditDescription(map.description || '');
    setEditModalOpen(true);
  };

  const handleSaveDetails = async () => {
    if (!editingMap) return;
    const trimmedName = editName.trim();
    if (!trimmedName || trimmedName.length < 2) {
      notification.warning({
        message: 'Invalid Name',
        description: 'Map name must be at least 2 characters long.',
        placement: 'topRight',
      });
      return;
    }
    if (trimmedName.length > 32) {
      notification.warning({
        message: 'Invalid Name',
        description: 'Map name cannot exceed 32 characters.',
        placement: 'topRight',
      });
      return;
    }
    if (/[<>]/.test(trimmedName)) {
      notification.warning({
        message: 'Invalid Name',
        description: 'Map name cannot contain < or > characters.',
        placement: 'topRight',
      });
      return;
    }

    setSavingDetails(true);
    try {
      const response = await apiRequest(`/maps/${editingMap.id}/`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: trimmedName,
          description: editDescription.trim(),
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || 'Failed to update map details');
      }

      const updatedData = await response.json().catch(() => ({}));
      setMaps((prev) =>
        prev.map((m) =>
          m.id === editingMap.id
            ? { ...m, name: trimmedName, description: editDescription.trim(), slug: updatedData.slug || m.slug }
            : m
        )
      );
      notification.success({
        message: 'Details Saved',
        description: `Map workspace "${trimmedName}" updated successfully.`,
        placement: 'topRight',
      });
      setEditModalOpen(false);
      fetchMaps(true);
    } catch (err: unknown) {
      notification.error({
        message: 'Update Failed',
        description: (err as Error).message || 'Could not update map details.',
        placement: 'topRight',
      });
    } finally {
      setSavingDetails(false);
    }
  };

  const openShareModal = (map: MapWorkspace) => {
    setSharingMap(map);
    setShareVisibility(map.share === 'PUBLIC' ? 'PUBLIC' : 'PRIVATE');
    setCopiedLink(false);
    setShareModalOpen(true);
  };

  const handleSaveSharing = async () => {
    if (!sharingMap) return;
    setSavingSharing(true);
    try {
      const response = await apiRequest(`/maps/${sharingMap.id}/`, {
        method: 'PATCH',
        body: JSON.stringify({
          share: shareVisibility,
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.detail || 'Failed to update map sharing');
      }

      setMaps((prev) =>
        prev.map((m) =>
          m.id === sharingMap.id
            ? { ...m, share: shareVisibility }
            : m
        )
      );
      notification.success({
        message: 'Sharing Updated',
        description: `Map visibility updated to ${shareVisibility === 'PUBLIC' ? 'Public' : 'Private'}.`,
        placement: 'topRight',
      });
      setShareModalOpen(false);
      fetchMaps(true);
    } catch (err: unknown) {
      notification.error({
        message: 'Update Failed',
        description: (err as Error).message || 'Could not update map sharing.',
        placement: 'topRight',
      });
    } finally {
      setSavingSharing(false);
    }
  };

  const handleCopyLink = () => {
    if (!sharingMap) return;
    const origin = typeof window !== 'undefined' ? window.location.origin : '';
    const shareUrl = `${origin}/map/${sharingMap.slug || sharingMap.id}`;
    navigator.clipboard.writeText(shareUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
    notification.success({
      message: 'Link Copied',
      description: 'Shareable map link copied to clipboard.',
      placement: 'topRight',
    });
  };

  const columns = [
    {
      title: 'Map Workspace',
      dataIndex: 'name',
      key: 'name',
      render: (text: string, record: MapWorkspace) => {
        // Build correct route using unique slug
        const targetSlug = record.slug || record.id;
        const route = record.type === '2D' ? `/map/${targetSlug}` : '#';
        const isClickable = record.type === '2D';

        return (
          <div className="max-w-[320px] whitespace-nowrap">
            {isClickable ? (
              <Link
                href={route}
                className="block text-[14px] font-bold text-gray-800 hover:text-primary transition-colors truncate"
              >
                {text}
              </Link>
            ) : (
              <Text className="block text-[14px] font-bold text-gray-400 truncate">{text}</Text>
            )}
          </div>
        );
      },
      sorter: (a: MapWorkspace, b: MapWorkspace) => a.name.localeCompare(b.name),
    },
    {
      title: 'Description',
      dataIndex: 'description',
      key: 'description',
      render: (desc: string) => (
        <Text type="secondary" className="text-[13px] block max-w-[250px] truncate text-gray-500">
          {desc || <span className="italic text-gray-300">No description provided</span>}
        </Text>
      ),
    },
    {
      title: 'Type',
      dataIndex: 'type',
      key: 'type',
      render: (type: string) => {
        let color = 'default';
        let label = type;
        if (type === '2D') { color = 'blue'; label = '2D Map'; }
        else if (type === '3D') { color = 'purple'; label = '3D Map'; }
        else if (type === 'POINTCLOUD') { color = 'magenta'; label = 'Point Cloud'; }
        return (
          <Tag color={color} className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded border-none whitespace-nowrap">
            {label}
          </Tag>
        );
      },
    },
    {
      title: 'Layers',
      key: 'layers',
      render: (_: unknown, record: MapWorkspace) => {
        const count = Array.isArray(record.layers)
          ? record.layers.length
          : typeof record.layers === 'string'
          ? (() => { try { return JSON.parse(record.layers).length; } catch { return 0; } })()
          : 0;
        return (
          <Tag color={count > 0 ? 'cyan' : 'default'} className="text-[10px] font-bold rounded border-none whitespace-nowrap">
            {count} {count === 1 ? 'Layer' : 'Layers'}
          </Tag>
        );
      },
      sorter: (a: MapWorkspace, b: MapWorkspace) => {
        const countA = Array.isArray(a.layers) ? a.layers.length : (typeof a.layers === 'string' ? (() => { try { return JSON.parse(a.layers).length; } catch { return 0; } })() : 0);
        const countB = Array.isArray(b.layers) ? b.layers.length : (typeof b.layers === 'string' ? (() => { try { return JSON.parse(b.layers).length; } catch { return 0; } })() : 0);
        return countA - countB;
      },
    },
    {
      title: 'Access & Sharing',
      key: 'share',
      render: (_: unknown, record: MapWorkspace) => {
        if (record.share === 'PUBLIC') {
          return (
            <Tag icon={<Globe size={11} className="inline mr-1" />} color="green" className="rounded-lg text-[11px] font-semibold py-0.5">
              Public
            </Tag>
          );
        }
        return (
          <Tag icon={<Lock size={11} className="inline mr-1" />} color="orange" className="rounded-lg text-[11px] font-semibold py-0.5">
            Private
          </Tag>
        );
      },
    },
    {
      title: 'Updated',
      key: 'updated',
      render: (_: unknown, record: MapWorkspace) => {
        const date = record.updated_at || record.created_at;
        return (
          <Tooltip title={formatFullDate(date)}>
            <Text className="text-[12px] text-gray-400 font-medium whitespace-nowrap">
              {formatRelativeTime(date)}
            </Text>
          </Tooltip>
        );
      },
      sorter: (a: MapWorkspace, b: MapWorkspace) => {
        return compareDates(a.updated_at || a.created_at, b.updated_at || b.created_at);
      },
    },
    {
      title: '',
      key: 'actions',
      render: (_: unknown, record: MapWorkspace) => (
        <Space size="middle" className="whitespace-nowrap">
          {record.type === '2D' ? (
            <Tooltip title="Open Map">
              <Link href={`/map/${record.slug || record.id}`}>
                <Button type="text" size="small" icon={<Eye size={16} className="text-gray-400 hover:text-primary" />} />
              </Link>
            </Tooltip>
          ) : (
            <Tooltip title="Preview not available">
              <Button type="text" size="small" disabled icon={<Eye size={16} className="text-gray-300" />} />
            </Tooltip>
          )}

          <Tooltip title="Edit Map Details">
            <Button
              type="text"
              size="small"
              icon={<Edit3 size={16} className="text-gray-400 hover:text-primary transition-colors" />}
              onClick={() => openEditModal(record)}
            />
          </Tooltip>

          <Tooltip title="Share Map">
            <Button
              type="text"
              size="small"
              icon={<Share2 size={16} className="text-gray-400 hover:text-primary transition-colors" />}
              onClick={() => openShareModal(record)}
            />
          </Tooltip>

          <Tooltip title="Clone">
            <Button
              type="text"
              size="small"
              icon={<Copy size={15} className="text-gray-400 hover:text-primary" />}
              onClick={() => handleClone(record)}
            />
          </Tooltip>

          <Tooltip title="Delete Map">
            <Button
              type="text"
              size="small"
              danger
              icon={<Trash2 size={16} className="text-red-500 hover:text-red-600 transition-colors" />}
              onClick={() => deleteWorkspace(record.id, record.name)}
            />
          </Tooltip>
        </Space>
      ),
      width: 170,
    },
  ];

  const onSelectChange = (newSelectedRowKeys: React.Key[]) => {
    setSelectedRowKeys(newSelectedRowKeys);
  };

  const rowSelection = {
    selectedRowKeys,
    onChange: onSelectChange,
  };

  if (!hydrated || !token) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <Spin size="large" description="Establishing secure session..." />
      </div>
    );
  }

  return (
    <DashboardLayout>
      <div className="space-y-[1.5rem] animate-in fade-in slide-in-from-bottom-[1rem] duration-700 pb-[5rem]">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-[1rem]">
          <div>
            <div className="flex items-center gap-[0.75rem] mb-[0.25rem]">
              <Title level={2} className="!m-0 !text-[1.125rem] sm:!text-[1.375rem] md:!text-[1.625rem]">Map Workspaces</Title>
            </div>
            <Text type="secondary" className="text-[0.75rem] sm:text-[0.875rem]">Manage and preview all institutional geospatial mapping workspaces.</Text>
          </div>
          <div className="flex items-center gap-[0.5rem]">
            <Button
              type="primary"
              icon={<Plus size={16} />}
              onClick={() => setCreateMapModalOpen(true)}
              className="rounded-[0.75rem] h-[2.5rem] px-[1.5rem] font-bold shadow-md hover:shadow-lg transition-all text-[0.75rem] sm:text-[0.875rem] flex items-center gap-1.5"
            >
              Create Map
            </Button>
            <Button
              icon={<RefreshCw size={16} className={loading ? 'animate-spin' : ''} />}
              onClick={() => fetchMaps()}
              className="rounded-[0.75rem] h-[2.5rem] px-[1rem] font-medium bg-white border-gray-200 shadow-sm hover:shadow-md transition-all text-[0.75rem] sm:text-[0.875rem]"
            >
              Refresh
            </Button>
          </div>
        </div>

        {/* Workspace Stats Bar */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-[0.75rem] sm:gap-[1rem]">
          {[
            {
              label: 'Total Map Workspaces',
              value: stats.total,
              icon: <MapIcon size={isMobile ? 16 : 20} />,
              color: 'bg-primary',
              filterKey: 'ALL',
            },
            {
              label: 'Private Workspaces',
              value: stats.private,
              icon: <Lock size={isMobile ? 16 : 20} />,
              color: 'bg-orange-500',
              filterKey: 'PRIVATE',
            },
            {
              label: 'Public Workspaces',
              value: stats.public,
              icon: <Globe size={isMobile ? 16 : 20} />,
              color: 'bg-green-500',
              filterKey: 'PUBLIC',
            },
          ].map((stat, i) => (
            <Card
              key={i}
              variant="borderless"
              onClick={() => setActiveShare(stat.filterKey)}
              className={`shadow-sm border rounded-[1rem] overflow-hidden group hover:shadow-md transition-all cursor-pointer ${
                activeShare === stat.filterKey
                  ? 'border-primary/40 ring-1 ring-primary/20 bg-primary/5'
                  : 'border-gray-100 bg-white hover:border-gray-200'
              }`}
              styles={{ body: { padding: isMobile ? '0.625rem 0.875rem' : '1.25rem 1.5rem' } }}
            >
              <div className="flex items-center gap-[0.75rem] sm:gap-[1rem]">
                <div className={`${stat.color} p-[0.5rem] sm:p-[0.75rem] rounded-[0.75rem] text-white shadow-sm group-hover:scale-110 transition-transform mb-auto mt-[0.125rem] flex shrink-0`}>
                  {stat.icon}
                </div>
                <div>
                  <Text className="text-[0.5625rem] xs:text-[0.625rem] sm:text-[0.75rem] font-bold uppercase tracking-widest text-gray-400 block leading-none mb-[0.25rem]">
                    {stat.label}
                  </Text>
                  <Title level={3} className="!m-0 !text-[1rem] sm:!text-[1.25rem] md:!text-[1.5rem] font-black">
                    {stat.value}
                  </Title>
                </div>
              </div>
            </Card>
          ))}
        </div>

        <Card variant="borderless" className="shadow-sm rounded-[1.5rem] border border-gray-100 overflow-hidden bg-white" styles={{ body: { padding: isMobile ? '0.75rem' : '1.5rem' } }}>
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-[1rem] mb-[1rem] px-[0.5rem] pt-[0.5rem]">
            <Segmented
              size="large"
              options={[
                {
                  label: (
                    <div className="flex items-center gap-[0.5rem] px-[0.25rem]">
                      <MapIcon size={16} />
                      <span className="hidden sm:inline">All</span>
                      <Tag className="ml-1 text-[10px] py-0 px-1 border-none bg-gray-200/60 font-semibold">{stats.total}</Tag>
                    </div>
                  ),
                  value: 'ALL'
                },
                {
                  label: (
                    <div className="flex items-center gap-[0.5rem] px-[0.25rem] text-orange-500">
                      <Lock size={15} />
                      <span className="hidden sm:inline">Private</span>
                      <span className="sm:hidden">Private</span>
                      <Tag className="ml-1 text-[10px] py-0 px-1 border-none bg-orange-100 text-orange-700 font-semibold">{stats.private}</Tag>
                    </div>
                  ),
                  value: 'PRIVATE'
                },
                {
                  label: (
                    <div className="flex items-center gap-[0.5rem] px-[0.25rem] text-green-600">
                      <Globe size={15} />
                      <span className="hidden sm:inline">Public</span>
                      <span className="sm:hidden">Public</span>
                      <Tag className="ml-1 text-[10px] py-0 px-1 border-none bg-green-100 text-green-700 font-semibold">{stats.public}</Tag>
                    </div>
                  ),
                  value: 'PUBLIC'
                },
              ]}
              value={activeShare}
              onChange={(value) => setActiveShare(value as string)}
              className="vismap-segmented p-[0.25rem] rounded-[1rem] bg-gray-50 shrink-0"
            />

            <div className="flex items-center gap-[0.5rem] w-full md:w-auto">
              <Input
                placeholder="Search by name, ID or description..."
                prefix={<Search size={18} className="text-gray-400" />}
                className="vismap-input flex-1 md:w-[18rem] rounded-[0.75rem] border-gray-200 h-[2.5rem] text-[0.75rem] sm:text-[0.875rem]"
                value={localSearch}
                onChange={e => setLocalSearch(e.target.value.replace(/^\s+/, ''))}
                onBlur={() => {
                  if (localSearch) {
                    setLocalSearch(localSearch.trim());
                  }
                }}
                onPressEnter={() => {
                  if (localSearch) {
                    setLocalSearch(localSearch.trim());
                  }
                }}
                allowClear
              />
              <Button
                icon={<Filter size={18} />}
                onClick={() => setShowFilters(!showFilters)}
                className={`rounded-[0.75rem] flex items-center justify-center border-gray-200 h-[2.5rem] transition-all text-[0.75rem] sm:text-[0.875rem] ${showFilters ? 'bg-primary text-white border-primary shadow-md' : (shareFilter || beforeDate || afterDate ? 'bg-primary/5 text-primary border-primary/20' : '')}`}
              >
                <span className="hidden xs:inline">{showFilters ? 'Hide' : 'Filter'}</span>
                {(shareFilter || beforeDate || afterDate) && !showFilters && <span className="ml-[0.5rem] w-[0.5rem] h-[0.5rem] bg-primary rounded-full animate-pulse" />}
              </Button>
            </div>
          </div>

          {/* Inline Filter Panel */}
          {showFilters && (
            <div className="mx-[0.5rem] bg-gray-50/50 rounded-[1rem] p-[1.25rem] mb-[1.5rem] border border-gray-100 animate-in fade-in slide-in-from-top-[0.5rem] duration-300">
              <div className="flex items-center justify-between mb-[1rem]">
                <Text strong className="text-gray-700 flex items-center gap-[0.5rem]">
                  <Filter size={14} /> Advanced Filters
                </Text>
                <Button type="link" size="small" onClick={resetFilters} className="text-primary font-bold p-0">Clear All Filters</Button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-[1rem]">
                <div>
                  <Text className="text-[0.6875rem] font-bold uppercase tracking-widest text-gray-400 mb-[0.375rem] block">Visibility</Text>
                  <Select
                    className="w-full h-[2.5rem]"
                    placeholder="Any Visibility"
                    allowClear
                    value={shareFilter}
                    onChange={setShareFilter}
                    options={[
                      { label: 'Private', value: 'PRIVATE' },
                      { label: 'Public', value: 'PUBLIC' }
                    ]}
                  />
                </div>

                <div>
                  <Text className="text-[0.6875rem] font-bold uppercase tracking-widest text-gray-400 mb-[0.375rem] block">Created After</Text>
                  <DatePicker
                    className="w-full h-[2.5rem]"
                    placeholder="Start Date"
                    value={afterDate}
                    allowClear={!isMobile}
                    onChange={(date) => {
                      setAfterDate(date);
                      if (date && beforeDate && date.isAfter(beforeDate, 'day')) {
                        setBeforeDate(null);
                      }
                    }}
                    disabledDate={(current) => {
                      if (!beforeDate || !current) return false;
                      return current.isAfter(beforeDate, 'day');
                    }}
                  />
                </div>

                <div>
                  <Text className="text-[0.6875rem] font-bold uppercase tracking-widest text-gray-400 mb-[0.375rem] block">Created Before</Text>
                  <DatePicker
                    className="w-full h-[2.5rem]"
                    placeholder="End Date"
                    value={beforeDate}
                    allowClear={!isMobile}
                    onChange={(date) => {
                      setBeforeDate(date);
                      if (date && afterDate && date.isBefore(afterDate, 'day')) {
                        setAfterDate(null);
                      }
                    }}
                    disabledDate={(current) => {
                      if (!afterDate || !current) return false;
                      return current.isBefore(afterDate, 'day');
                    }}
                  />
                </div>
              </div>
            </div>
          )}

          <Table
            rowSelection={rowSelection}
            columns={columns}
            dataSource={filteredMaps}
            loading={loading}
            rowKey="id"
            className="vismap-table"
            scroll={{ x: 800 }}
            locale={{
              emptyText: (
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description={
                    <div className="flex flex-col items-center gap-[0.5rem]">
                      <Text type="secondary" className="font-medium">No map workspaces found matching your criteria</Text>
                      {activeShare !== 'ALL' || shareFilter || beforeDate || afterDate || globalSearch !== '' || localSearch !== '' ? (
                        <Button type="link" onClick={resetFilters}>Clear all filters</Button>
                      ) : (
                        <Button
                          type="link"
                          className="font-bold"
                          onClick={() => setCreateMapModalOpen(true)}
                        >
                          Create your first map
                        </Button>
                      )}
                    </div>
                  }
                />
              )
            }}
            pagination={{
              current: currentPage,
              pageSize: pageSize,
              showSizeChanger: true,
              pageSizeOptions: ['5', '8', '10', '15'],
              onChange: (page, size) => {
                setCurrentPage(page);
                setPageSize(size);
              },
              className: 'mt-[1.5rem] px-[1rem] pb-[1rem]',
            }}
          />
        </Card>

        {/* Edit Details Modal */}
        <Modal
          title={
            <div className="flex items-center gap-2.5 border-b border-gray-100 pb-3">
              <div className="p-1.5 rounded-lg bg-blue-50 text-primary">
                <Edit3 size={18} />
              </div>
              <div>
                <span className="font-bold text-gray-800 text-base block">Edit Map Details</span>
                <span className="text-gray-400 text-xs font-medium block truncate max-w-[340px]">
                  {editingMap?.name}
                </span>
              </div>
            </div>
          }
          open={editModalOpen}
          onCancel={() => !savingDetails && setEditModalOpen(false)}
          footer={[
            <Button
              key="cancel"
              onClick={() => setEditModalOpen(false)}
              disabled={savingDetails}
              className="rounded-xl font-medium"
            >
              Cancel
            </Button>,
            <Button
              key="save"
              type="primary"
              loading={savingDetails}
              onClick={handleSaveDetails}
              className="bg-primary hover:bg-primary/90 border-none rounded-xl font-bold px-5"
            >
              Save Changes
            </Button>
          ]}
          width={500}
          centered
          className="rounded-2xl"
        >
          {editingMap && (
            <div className="py-3 flex flex-col gap-4 animate-in fade-in duration-200">
              <div>
                <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                  Map Name
                </div>
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="Enter map workspace name"
                  maxLength={32}
                  className="rounded-xl h-10 bg-gray-50/80 border-gray-200 font-medium text-sm focus:bg-white"
                />
              </div>

              <div>
                <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                  Description
                </div>
                <Input.TextArea
                  value={editDescription}
                  onChange={(e) => setEditDescription(e.target.value)}
                  placeholder="Describe this map workspace..."
                  rows={3}
                  className="rounded-xl bg-gray-50/80 border-gray-200 font-medium text-sm focus:bg-white"
                />
              </div>
            </div>
          )}
        </Modal>

        {/* Share Modal */}
        <Modal
          title={
            <div className="flex items-center gap-2.5 border-b border-gray-100 pb-3">
              <div className="p-1.5 rounded-lg bg-green-50 text-green-600">
                <Share2 size={18} />
              </div>
              <div>
                <span className="font-bold text-gray-800 text-base block">Share Map Workspace</span>
                <span className="text-gray-400 text-xs font-medium block truncate max-w-[340px]">
                  {sharingMap?.name}
                </span>
              </div>
            </div>
          }
          open={shareModalOpen}
          onCancel={() => !savingSharing && setShareModalOpen(false)}
          footer={[
            <Button
              key="cancel"
              onClick={() => setShareModalOpen(false)}
              disabled={savingSharing}
              className="rounded-xl font-medium"
            >
              Cancel
            </Button>,
            <Button
              key="save"
              type="primary"
              loading={savingSharing}
              onClick={handleSaveSharing}
              className="bg-primary hover:bg-primary/90 border-none rounded-xl font-bold px-5"
            >
              Save Visibility
            </Button>
          ]}
          width={500}
          centered
          className="rounded-2xl"
        >
          {sharingMap && (
            <div className="py-3 flex flex-col gap-4 animate-in fade-in duration-200">
              {/* Shareable Link Box */}
              <div>
                <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                  Shareable Link
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 flex items-center gap-2 px-3 h-10 rounded-xl bg-gray-50 border border-gray-200 text-xs text-gray-600 truncate">
                    <LinkIcon size={14} className="text-gray-400 shrink-0" />
                    <span className="truncate select-all">
                      {typeof window !== 'undefined'
                        ? `${window.location.origin}/map/${sharingMap.slug || sharingMap.id}`
                        : `/map/${sharingMap.slug || sharingMap.id}`}
                    </span>
                  </div>
                  <Button
                    onClick={handleCopyLink}
                    icon={copiedLink ? <Check size={16} className="text-green-600" /> : <Copy size={16} />}
                    className={`h-10 rounded-xl font-bold flex items-center gap-1.5 shrink-0 ${
                      copiedLink ? 'border-green-500 text-green-600 bg-green-50/50' : 'text-primary'
                    }`}
                  >
                    {copiedLink ? 'Copied' : 'Copy Link'}
                  </Button>
                </div>
              </div>

              {/* General Access / Visibility Selection */}
              <div>
                <div className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2.5">
                  General Access
                </div>
                <Radio.Group
                  value={shareVisibility}
                  onChange={(e) => setShareVisibility(e.target.value)}
                  className="w-full flex flex-col gap-2.5"
                >
                  <div
                    onClick={() => setShareVisibility('PRIVATE')}
                    className={`p-3.5 rounded-xl border cursor-pointer transition-all flex items-start gap-3 ${
                      shareVisibility === 'PRIVATE'
                        ? 'border-orange-400 bg-orange-50/40 shadow-xs'
                        : 'border-gray-200 hover:border-gray-300 bg-white'
                    }`}
                  >
                    <Radio value="PRIVATE" className="mt-0.5" />
                    <div className="flex-1">
                      <div className="flex items-center gap-1.5 font-bold text-sm text-gray-800">
                        <Lock size={14} className="text-orange-500" />
                        <span>Private</span>
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5 leading-relaxed">
                        Only you can view and access this map workspace (requires logging in).
                      </div>
                    </div>
                  </div>

                  <div
                    onClick={() => setShareVisibility('PUBLIC')}
                    className={`p-3.5 rounded-xl border cursor-pointer transition-all flex items-start gap-3 ${
                      shareVisibility === 'PUBLIC'
                        ? 'border-green-400 bg-green-50/40 shadow-xs'
                        : 'border-gray-200 hover:border-gray-300 bg-white'
                    }`}
                  >
                    <Radio value="PUBLIC" className="mt-0.5" />
                    <div className="flex-1">
                      <div className="flex items-center gap-1.5 font-bold text-sm text-gray-800">
                        <Globe size={14} className="text-green-500" />
                        <span>Public</span>
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5 leading-relaxed">
                        Anyone with the shareable link can view this map workspace without logging in.
                      </div>
                    </div>
                  </div>
                </Radio.Group>
              </div>
            </div>
          )}
        </Modal>

        {/* Bulk Action Bar (Floating) */}
        {selectedRowKeys.length > 0 && (
          <div
            className="fixed bottom-[1.5rem] left-1/2 -translate-x-1/2 z-[100] text-white px-[1.5rem] py-[0.75rem] rounded-[1rem] shadow-2xl flex items-center gap-[1.5rem] animate-in fade-in slide-in-from-bottom-[1rem] duration-500 border border-white/10"
            style={{ backgroundColor: siteConfig.colors.secondary }}
          >
            <div className="flex items-center gap-[0.75rem] pr-[1.5rem] border-r border-white/10">
              <div className="bg-primary p-[0.375rem] rounded-[0.5rem] text-white flex shrink-0">
                <MapIcon size={16} />
              </div>
              <span className="text-white font-bold whitespace-nowrap">{selectedRowKeys.length} Selected</span>
            </div>

            <div className="flex items-center gap-[1rem]">
              <Button
                danger
                type="primary"
                icon={<Trash2 size={16} />}
                onClick={deleteSelectedWorkspaces}
                className="rounded-[0.75rem] font-bold px-[1.5rem] h-[2.25rem] flex items-center shadow-lg"
              >
                Delete Workspaces
              </Button>
            </div>

            <Button
              type="text"
              icon={<X size={16} className="text-white" />}
              onClick={() => setSelectedRowKeys([])}
              className="!text-white hover:!bg-white/10 ml-[0.5rem] p-[0.25rem] h-auto flex items-center"
            />
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
