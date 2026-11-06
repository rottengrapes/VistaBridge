// ============================================================================
// Share Dashboard Modal Component (GeoServer Role-Based Sharing)
//
// Allows dashboard owners to configure access permissions using GeoServer roles:
// - Roles with access: Owner + specific GeoServer roles with VIEWER or EDITOR permissions
// - General access: Restricted (Only assigned roles) OR Anyone with the link (Public)
// ============================================================================

'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { Modal, Select, Button, Typography, App, Tag, Tooltip, Avatar } from 'antd';
import { Lock, Globe, Link as LinkIcon, Check, Copy, Trash2, Eye, Edit3, Shield, Share2, ShieldCheck } from 'lucide-react';
import { apiRequest } from '@/lib/api';
import { useAuthStore } from '@/store/useAuthStore';
import { normalizeAllowedRoles, AllowedRoleEntry, DashboardUserRole, isUserAdmin } from '@/lib/dashboardPermissions';

export interface ShareDashboardModalProps {
  open: boolean;
  onClose: () => void;
  dashboardId: string;
  dashboardTitle: string;
  dashboardDescription?: string;
  dashboardSlug?: string;
  createdBy?: string;
  initialShareType?: 'PRIVATE' | 'USERS' | 'ROLES' | 'PUBLIC';
  initialAllowedUsers?: any;
  initialAllowedRoles?: AllowedRoleEntry[] | string[] | any;
  initialTab?: 'details' | 'sharing';
  onShareUpdated?: (updated: {
    name?: string;
    description?: string;
    share_type: string;
    allowed_users?: any[];
    allowed_roles: AllowedRoleEntry[];
  }) => void;
}

const AVATAR_COLORS = [
  '#2563eb', '#7c3aed', '#db2777', '#ea580c', '#059669', '#0891b2', '#4f46e5'
];

function getAvatarColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const idx = Math.abs(hash) % AVATAR_COLORS.length;
  return AVATAR_COLORS[idx];
}

export default function ShareDashboardModal({
  open,
  onClose,
  dashboardId,
  dashboardTitle,
  dashboardSlug,
  createdBy,
  initialShareType = 'PRIVATE',
  initialAllowedRoles = [],
  onShareUpdated,
}: ShareDashboardModalProps) {
  const { notification } = App.useApp();
  const { user: currentUser } = useAuthStore();

  const isCurrentOwner = Boolean(
    currentUser?.username && createdBy && currentUser.username.toLowerCase() === createdBy.toLowerCase()
  );
  const isSystemAdmin = isUserAdmin(currentUser);
  const canManagePermissions = Boolean(isCurrentOwner || isSystemAdmin);

  const [generalAccess, setGeneralAccess] = useState<'RESTRICTED' | 'PUBLIC'>('RESTRICTED');
  const [rolePermissions, setRolePermissions] = useState<AllowedRoleEntry[]>([]);

  const [selectedNewRole, setSelectedNewRole] = useState<string | null>(null);
  const [selectedNewPermission, setSelectedNewPermission] = useState<DashboardUserRole>('VIEWER');

  const [availableRoles, setAvailableRoles] = useState<string[]>([]);
  const [loadingRoles, setLoadingRoles] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  // Sync initial props when opened
  useEffect(() => {
    if (open) {
      const isPublic = initialShareType === 'PUBLIC';
      setGeneralAccess(isPublic ? 'PUBLIC' : 'RESTRICTED');

      const normalized = normalizeAllowedRoles(initialAllowedRoles);
      setRolePermissions(normalized);

      setSelectedNewRole(null);
      setSelectedNewPermission('VIEWER');
      setCopied(false);
    }
  }, [open, dashboardTitle, initialShareType, initialAllowedRoles, currentUser?.username, createdBy, canManagePermissions]);

  // Load available roles from /api/geoserver/roles
  useEffect(() => {
    if (open && availableRoles.length === 0) {
      setLoadingRoles(true);
      apiRequest('/geoserver/roles')
        .then((res) => (res.ok ? res.json() : { roles: [] }))
        .then((data) => {
          if (Array.isArray(data.roles)) {
            setAvailableRoles(data.roles);
          }
        })
        .catch(() => { })
        .finally(() => setLoadingRoles(false));
    }
  }, [open, availableRoles.length]);

  // Exclude already added roles from the dropdown (ADMIN is already permanently granted System Admin access)
  const unaddedRoles = useMemo(() => {
    const existing = new Set(rolePermissions.map((r) => r.role.toUpperCase()));
    existing.add('ADMIN');
    return availableRoles.filter((r) => !existing.has(r.toUpperCase()));
  }, [availableRoles, rolePermissions]);

  const targetSlug = dashboardSlug || dashboardId;
  const shareUrl = typeof window !== 'undefined'
    ? `${window.location.origin}/dashboard/${targetSlug}`
    : `/dashboard/${targetSlug}`;

  const handleCopyLink = () => {
    if (navigator?.clipboard) {
      navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      notification.success({
        message: 'Link Copied',
        description: 'Dashboard URL copied to clipboard.',
        placement: 'topRight',
      });
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const handleAddRole = () => {
    if (!selectedNewRole) return;
    setRolePermissions((prev) => [
      ...prev,
      { role: selectedNewRole, permission: selectedNewPermission },
    ]);
    setSelectedNewRole(null);
    setSelectedNewPermission('VIEWER');
  };

  const handlePermissionChange = (roleName: string, newPermission: DashboardUserRole) => {
    setRolePermissions((prev) =>
      prev.map((entry) => (entry.role === roleName ? { ...entry, permission: newPermission } : entry))
    );
  };

  const handleRemoveRole = (roleName: string) => {
    setRolePermissions((prev) => prev.filter((entry) => entry.role !== roleName));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const effectiveShareType = generalAccess === 'PUBLIC'
        ? 'PUBLIC'
        : rolePermissions.length > 0
          ? 'ROLES'
          : 'PRIVATE';

      const res = await apiRequest(`/dashboards/${dashboardId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          share_type: effectiveShareType,
          allowed_roles: rolePermissions,
          allowed_users: [],
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || `HTTP ${res.status}`);
      }

      notification.success({
        message: 'Settings Saved',
        description: `GeoServer role permissions and access settings updated.`,
        placement: 'topRight',
      });

      if (onShareUpdated) {
        onShareUpdated({
          name: dashboardTitle,
          share_type: effectiveShareType,
          allowed_roles: rolePermissions,
        });
      }

      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not save share settings.';
      notification.error({
        message: 'Save Failed',
        description: msg,
        placement: 'topRight',
      });
    } finally {
      setSaving(false);
    }
  };

  const ownerUsername = (createdBy || currentUser?.username || 'Owner').trim();

  return (
    <Modal
      title={
        <div className="flex items-center gap-2.5 pb-1">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
            <Share2 size={18} />
          </div>
          <div>
            <div className="text-sm font-bold text-gray-800">
              {canManagePermissions ? 'Workspace Access & Sharing' : `Share "${dashboardTitle}"`}
            </div>
            <div className="text-[11px] text-gray-400 font-normal">
              {canManagePermissions
                ? `Manage GeoServer role permissions and shareable link for "${dashboardTitle}"`
                : 'Copy link and view GeoServer role permissions'}
            </div>
          </div>
        </div>
      }
      open={open}
      onCancel={onClose}
      footer={null}
      destroyOnClose
      centered
      width={560}
      className="rounded-2xl overflow-hidden"
    >
      <div className="pt-3 pb-1 flex flex-col gap-4">

        {/* Section 1: Add GeoServer Role with Permission (Owner & Admin only) */}
        {canManagePermissions ? (
          <div className="bg-gray-50/80 border border-gray-200/90 rounded-2xl p-3">
            <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <ShieldCheck size={14} className="text-primary" />
              <span>Add GeoServer Role</span>
            </div>
            <div className="flex items-center gap-2">
              <Select
                showSearch
                placeholder="Select GeoServer role..."
                value={selectedNewRole}
                onChange={(val) => setSelectedNewRole(val)}
                loading={loadingRoles}
                className="flex-1 rounded-xl h-9"
                filterOption={(input, option) =>
                  ((option?.label as any) ?? '').toLowerCase().includes(input.toLowerCase())
                }
                options={unaddedRoles.map((role) => ({
                  label: role,
                  value: role,
                }))}
              />

              <Select
                value={selectedNewPermission}
                onChange={(perm) => setSelectedNewPermission(perm)}
                className="w-32 rounded-xl h-9"
                options={[
                  {
                    label: (
                      <span className="flex items-center gap-1.5 text-xs font-semibold">
                        <Eye size={12} className="text-blue-500" /> Viewer
                      </span>
                    ),
                    value: 'VIEWER',
                  },
                  {
                    label: (
                      <span className="flex items-center gap-1.5 text-xs font-semibold">
                        <Edit3 size={12} className="text-indigo-600" /> Editor
                      </span>
                    ),
                    value: 'EDITOR',
                  },
                ]}
              />

              <Button
                type="primary"
                disabled={!selectedNewRole}
                onClick={handleAddRole}
                className="rounded-xl font-bold h-9 px-4 shrink-0 shadow-xs"
              >
                Add Role
              </Button>
            </div>
          </div>
        ) : (
          <div className="bg-blue-50/70 border border-blue-100 rounded-2xl p-3 flex items-center gap-2.5 text-xs text-blue-800">
            <LinkIcon size={16} className="text-blue-600 shrink-0" />
            <span>
              You have access to this dashboard via your assigned GeoServer role. You can copy the shareable link below.
            </span>
          </div>
        )}

        {/* Section 2: Roles with Access */}
        <div>
          <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">
            Roles With Access
          </div>

          <div className="border border-gray-200 rounded-2xl overflow-hidden bg-white">
            {/* Owner Row (Always First) */}
            <div className="p-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <Avatar
                  style={{ backgroundColor: getAvatarColor(ownerUsername) }}
                  className="font-bold shrink-0 text-white"
                >
                  {ownerUsername.charAt(0).toUpperCase()}
                </Avatar>
                <div className="min-w-0">
                  <div className="text-xs font-bold text-gray-800 flex items-center gap-1.5">
                    <span className="truncate">{ownerUsername}</span>
                    {isCurrentOwner && <span className="text-[10px] text-gray-400 font-normal">(you)</span>}
                  </div>
                </div>
              </div>
              <Tag color="default" className="text-[11px] font-semibold rounded-lg px-2 py-0.5 border-gray-200 text-gray-600 shrink-0">
                Owner
              </Tag>
            </div>

            {/* GeoServer System Admin (Built-in full access) */}
            <div className="p-3 flex items-center justify-between gap-3 hover:bg-gray-50/60 transition-colors border-t border-gray-100">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-xl bg-purple-50 border border-purple-100 flex items-center justify-center text-purple-600 shrink-0">
                  <ShieldCheck size={16} />
                </div>
                <div className="min-w-0 flex items-center gap-2">
                  <span className="text-xs font-bold text-gray-800 font-mono truncate">
                    ADMIN
                  </span>
                </div>
              </div>
              <Tooltip title="GeoServer Administrators have system-wide full access to all workspaces">
                <Tag color="purple" className="rounded-lg text-[10px] font-bold px-2 py-0.5 border-none shrink-0 cursor-help">
                  System Admin
                </Tag>
              </Tooltip>
            </div>

            {/* Added Roles List */}
            {rolePermissions.filter((entry) => entry.role.toUpperCase() !== 'ADMIN').map((entry) => (
              <div key={entry.role} className="p-3 flex items-center justify-between gap-3 hover:bg-gray-50/60 transition-colors border-t border-gray-100">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-xl bg-indigo-50 border border-indigo-100 flex items-center justify-center text-indigo-600 shrink-0">
                    <Shield size={16} />
                  </div>
                  <div className="min-w-0 flex items-center gap-2">
                    <span className="text-xs font-bold text-gray-800 font-mono truncate">
                      {entry.role}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {canManagePermissions ? (
                    <>
                      <Select
                        value={entry.permission}
                        onChange={(newPerm) => handlePermissionChange(entry.role, newPerm)}
                        variant="borderless"
                        className="w-28 text-xs font-semibold"
                        options={[
                          {
                            label: (
                              <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-700">
                                <Eye size={12} className="text-blue-500" /> Viewer
                              </span>
                            ),
                            value: 'VIEWER',
                          },
                          {
                            label: (
                              <span className="flex items-center gap-1.5 text-xs font-semibold text-gray-700">
                                <Edit3 size={12} className="text-indigo-600" /> Editor
                              </span>
                            ),
                            value: 'EDITOR',
                          },
                        ]}
                      />

                      <Tooltip title="Remove role access">
                        <Button
                          type="text"
                          size="small"
                          danger
                          icon={<Trash2 size={14} />}
                          onClick={() => handleRemoveRole(entry.role)}
                          className="flex items-center justify-center rounded-lg"
                          style={{ width: 28, height: 28 }}
                        />
                      </Tooltip>
                    </>
                  ) : (
                    <Tag
                      color={entry.permission === 'EDITOR' ? 'purple' : 'default'}
                      className="rounded-lg text-[11px] font-semibold px-2 py-0.5 border-none"
                    >
                      {entry.permission === 'EDITOR' ? 'Editor' : 'Viewer'}
                    </Tag>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Section 3: General Access */}
        <div>
          <div className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">
            General Access
          </div>

          <div className="border border-gray-200 rounded-2xl p-3 bg-white flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                generalAccess === 'PUBLIC' ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-500'
              }`}>
                {generalAccess === 'PUBLIC' ? <Globe size={18} /> : <Lock size={18} />}
              </div>
              <div className="min-w-0">
                {canManagePermissions ? (
                  <Select
                    value={generalAccess}
                    onChange={(val) => setGeneralAccess(val)}
                    variant="borderless"
                    className="font-bold text-xs p-0 -ml-2 text-gray-800"
                    popupMatchSelectWidth={false}
                    options={[
                      {
                        label: (
                          <div className="flex flex-col py-1">
                            <span className="font-bold text-xs text-gray-800">Restricted</span>
                            <span className="text-[11px] text-gray-400">Only assigned GeoServer roles can open</span>
                          </div>
                        ),
                        value: 'RESTRICTED',
                      },
                      {
                        label: (
                          <div className="flex flex-col py-1">
                            <span className="font-bold text-xs text-gray-800">Anyone with the link (Public)</span>
                            <span className="text-[11px] text-gray-400">Anyone on the internet with the link can view</span>
                          </div>
                        ),
                        value: 'PUBLIC',
                      },
                    ]}
                  />
                ) : (
                  <div className="font-bold text-xs text-gray-800 py-1">
                    {generalAccess === 'PUBLIC' ? 'Anyone with the link (Public)' : 'Restricted'}
                  </div>
                )}
                <div className="text-[11px] text-gray-400">
                  {generalAccess === 'PUBLIC'
                    ? 'Anyone on the internet with the link can view without signing in.'
                    : rolePermissions.length > 0
                      ? 'Only users with the assigned GeoServer roles can access this dashboard.'
                      : 'Only the owner can access this dashboard.'}
                </div>
              </div>
            </div>

            {generalAccess === 'PUBLIC' && (
              <Tag color="green" className="text-[11px] font-semibold rounded-lg px-2 py-0.5 border-none shrink-0">
                Public (Viewer)
              </Tag>
            )}
          </div>
        </div>

        {/* Footer: Copy Link & Action Buttons */}
        <div className="flex items-center justify-between pt-3 border-t border-gray-100 mt-1">
          <Button
            type="primary"
            icon={copied ? <Check size={14} className="text-white" /> : <Copy size={14} />}
            onClick={handleCopyLink}
            className="rounded-xl text-xs font-semibold h-10 px-4 flex items-center gap-1.5 shadow-sm"
          >
            {copied ? 'Copied Link' : 'Copy Link'}
          </Button>

          <div className="flex items-center gap-2">
            <Button
              className="rounded-xl font-semibold h-10 px-5"
              onClick={onClose}
            >
              {canManagePermissions ? 'Cancel' : 'Close'}
            </Button>
            {canManagePermissions && (
              <Button
                type="primary"
                loading={saving}
                onClick={handleSave}
                className="rounded-xl font-bold h-10 px-6 shadow-sm"
              >
                Save Changes
              </Button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
