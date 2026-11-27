// ============================================================================
// StyleEditor Component (Layer Styling & Symbology)
//
// In GIS, "Symbology" defines how data looks visually on the map:
// - Vector Layers: Point markers, line colors & widths, polygon fills & opacity,
//   and feature labels.
// - Raster Layers: Multi-band satellite imagery or single-band color ramps.
//
// GeoServer Roundtrip Integration:
// - Fetches existing styles & active SLD from GeoServer via Next.js proxy.
// - Allows visual live editing with 60 FPS in-memory preview on OpenLayers.
// - Clean UI with dedicated "Save Changes" and "Save as New Style" modal flow.
// ============================================================================

/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState, useEffect, useMemo } from 'react';
import {
  Select,
  Input,
  Divider,
  Button,
  Tabs,
  Spin,
  message,
  ColorPicker,
  Segmented,
  Checkbox,
  Tooltip,
  Modal,
  Tag,
  Switch,
  Popconfirm,
  Slider,
} from 'antd';
import {
  Save,
  RefreshCw,
  Palette,
  Code,
  CheckCircle2,
  Plus,
  Copy,
  Layers,
  Square,
  Sliders,
  Type,
  MapPin,
  Spline,
  Eye,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { styleConfigToSld, sldToStyleConfig, StyleConfig } from '@/lib/gis/sldTransformer';

const GIS_COLOR_PRESETS = [
  {
    label: 'Standard GIS',
    colors: [
      '#ff4d4f', // Red
      '#1890ff', // Blue
      '#52c41a', // Green
      '#faad14', // Yellow / Amber
      '#fa8c16', // Orange
      '#722ed1', // Purple
      '#13c2c2', // Cyan
      '#eb2f96', // Magenta
      '#000000', // Black
      '#ffffff', // White
      '#8c8c8c', // Gray
      '#873800', // Brown
    ],
  },
];

/**
 * Strips workspace prefixes and repeated prefixes (e.g. "sf:sf_sf_roads" -> "roads")
 */
function cleanStyleName(rawName: string, workspace?: string): string {
  let name = (rawName || '').trim();
  if (name.includes(':')) {
    name = name.split(':').pop() || name;
  }
  if (workspace) {
    const wsEscaped = workspace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const wsPrefixRegex = new RegExp(`^(${wsEscaped}[_:-]?)+`, 'i');
    name = name.replace(wsPrefixRegex, '');
  }
  return name.trim();
}

export function normalizeLineDash(dash?: string | null): string {
  if (!dash) return '';
  const trimmed = String(dash).trim();
  if (trimmed === '' || trimmed === 'none' || trimmed === '0') return '';

  if (trimmed === '5 5') return '5 5';
  if (trimmed === '2 5') return '2 5';
  if (trimmed === '5 3 2 3') return '5 3 2 3';

  // Parse numbers
  const nums = trimmed.split(/[\s,]+/).map(Number).filter((n) => !isNaN(n));
  if (nums.length === 0) return '';
  if (nums.length >= 4) return '5 3 2 3'; // Dash-dot pattern
  if (nums.length === 2) {
    if (nums[0] <= 2) return '2 5'; // Dotted (e.g. 2 2, 1 2, 2 4)
    return '5 5'; // Dashed (e.g. 4 4, 5 5, 6 6, 8 4)
  }
  return '5 5';
}

interface StyleEditorProps {
  layer: {
    id: string;
    name: string;
    type: 'VECTOR' | 'RASTER';
    styles?: any[];
    activeStyle?: string;
  };
  schema: Record<string, string>;
  geometryType?: string | null;
  styleConfig: any;
  onChange: (newConfig: any) => void;
  onSaved?: (styleName: string) => void;
  onDeleted?: (deletedStyleName: string, newActiveStyle: string, remainingStyles: any[]) => void;
  onStylesLoaded?: (styles: Array<{ name: string; title?: string; workspace?: string }>, defaultStyle?: string) => void;
}

export default function StyleEditor({
  layer,
  schema = {},
  geometryType = null,
  styleConfig = {},
  onChange,
  onSaved,
  onDeleted,
  onStylesLoaded,
}: StyleEditorProps) {
  const [activeTab, setActiveTab] = useState<'visual' | 'sld'>('visual');
  const [selectedStyle, setSelectedStyle] = useState<string>(() => {
    const ws = (layer?.id && layer.id.includes(':')) ? layer.id.split(':')[0] : '';
    return cleanStyleName(layer?.activeStyle || '', ws);
  });
  const [availableStyles, setAvailableStyles] = useState<
    Array<{ name: string; title?: string; workspace?: string }>
  >(() => {
    const ws = (layer?.id && layer.id.includes(':')) ? layer.id.split(':')[0] : '';
    const map = new Map<string, { name: string; title?: string; workspace?: string }>();
    (layer?.styles || []).forEach((s: any) => {
      const raw = typeof s === 'string' ? s : s?.name || '';
      const clean = cleanStyleName(raw, ws);
      if (clean && !map.has(clean.toLowerCase())) {
        map.set(clean.toLowerCase(), {
          name: clean,
          title: (typeof s === 'object' && s?.title) || clean,
          workspace: (typeof s === 'object' && s?.workspace) || ws,
        });
      }
    });
    return Array.from(map.values());
  });
  const [isLoadingSld, setIsLoadingSld] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [activeGeoServerStyle, setActiveGeoServerStyle] = useState<string | null>(null);
  const [layerWorkspace, setLayerWorkspace] = useState<string>('');
  const [lastSavedTimestamp, setLastSavedTimestamp] = useState<number | null>(null);

  // Sync availableStyles whenever layer.styles prop updates from outside
  useEffect(() => {
    if (layer?.styles && layer.styles.length > 0) {
      const ws = layerWorkspace || (layer.id?.includes(':') ? layer.id.split(':')[0] : '');
      setAvailableStyles((prev) => {
        const map = new Map<string, { name: string; title?: string; workspace?: string }>();
        prev.forEach((s) => map.set(s.name.toLowerCase(), s));
        layer.styles?.forEach((s: any) => {
          const raw = typeof s === 'string' ? s : s?.name || '';
          const clean = cleanStyleName(raw, ws);
          if (clean && !map.has(clean.toLowerCase())) {
            map.set(clean.toLowerCase(), {
              name: clean,
              title: (typeof s === 'object' && s?.title) || clean,
              workspace: (typeof s === 'object' && s?.workspace) || ws,
            });
          }
        });
        return Array.from(map.values());
      });
    }
  }, [layer?.styles, layerWorkspace]);

  // "Save as New Style" modal state
  const [isNewStyleModalOpen, setIsNewStyleModalOpen] = useState<boolean>(false);
  const [newStyleInputName, setNewStyleInputName] = useState<string>('');
  const [setNewAsDefault, setSetNewAsDefault] = useState<boolean>(true);

  const discoveredBandKeys = Object.keys(schema).filter((k) => k.startsWith('band_'));
  const bandKeys = discoveredBandKeys.length > 0
    ? discoveredBandKeys
    : (layer?.type === 'RASTER' ? ['band_1', 'band_2', 'band_3', 'band_4'] : []);
  const isMultiBand = bandKeys.length > 1;

  // Extract initial workspace from layer id or name (e.g. "sf:roads" -> "sf")
  useEffect(() => {
    if (layer?.id && layer.id.includes(':')) {
      setLayerWorkspace(layer.id.split(':')[0]);
    }
  }, [layer?.id]);

  // Load existing styles & SLD from GeoServer
  const loadGeoServerStyle = async (requestedStyleName?: string) => {
    if (!layer?.id) return;
    setIsLoadingSld(true);
    try {
      const styleParam = requestedStyleName
        ? `&style=${encodeURIComponent(requestedStyleName)}`
        : '';
      const res = await fetch(
        `/api/geoserver/styles?layer=${encodeURIComponent(layer.id)}${styleParam}`
      );
      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          const ws = data.workspace || (layer.id.includes(':') ? layer.id.split(':')[0] : '');
          if (ws) setLayerWorkspace(ws);

          const defStyle = cleanStyleName(data.defaultStyle || '', ws);
          if (defStyle) setActiveGeoServerStyle(defStyle);

          const activeStyle = cleanStyleName(data.activeStyle || defStyle || '', ws);
          setSelectedStyle(activeStyle);

          // Build title mapping from layer.styles (from WMS GetCapabilities)
          const titlesMap = new Map<string, string>();
          (layer.styles || []).forEach((ls: any) => {
            const raw = typeof ls === 'string' ? ls : ls?.name || '';
            const clean = cleanStyleName(raw, ws);
            const title = typeof ls === 'object' && ls?.title ? ls.title : '';
            if (clean && title && title !== clean) {
              titlesMap.set(clean, title);
            }
          });

          // Build clean, deduplicated available styles map
          const stylesMap = new Map<string, { name: string; title?: string; workspace?: string }>();

          // 1. Seed with existing styles from layer.styles so no styles are ever lost
          (layer.styles || []).forEach((ls: any) => {
            const raw = typeof ls === 'string' ? ls : ls?.name || '';
            const clean = cleanStyleName(raw, ws);
            if (clean && !stylesMap.has(clean.toLowerCase())) {
              stylesMap.set(clean.toLowerCase(), {
                name: clean,
                title: (typeof ls === 'object' && ls?.title) || clean,
                workspace: (typeof ls === 'object' && ls?.workspace) || ws,
              });
            }
          });

          // 2. Also retain any styles already in component state
          availableStyles.forEach((s) => {
            if (!stylesMap.has(s.name.toLowerCase())) {
              stylesMap.set(s.name.toLowerCase(), s);
            }
          });

          // 3. Merge styles from GeoServer API
          const stylesList = Array.isArray(data.styles) ? data.styles : [];
          stylesList.forEach((s: any) => {
            const clean = cleanStyleName(s.name, ws);
            if (clean && !stylesMap.has(clean.toLowerCase())) {
              stylesMap.set(clean.toLowerCase(), {
                name: clean,
                title: s.title || titlesMap.get(clean) || clean,
                workspace: s.workspace || ws,
              });
            }
          });

          if (defStyle && !stylesMap.has(defStyle.toLowerCase())) {
            stylesMap.set(defStyle.toLowerCase(), {
              name: defStyle,
              title: titlesMap.get(defStyle) || defStyle,
              workspace: ws,
            });
          }
          if (activeStyle && !stylesMap.has(activeStyle.toLowerCase())) {
            stylesMap.set(activeStyle.toLowerCase(), {
              name: activeStyle,
              title: titlesMap.get(activeStyle) || activeStyle,
              workspace: ws,
            });
          }

          const cleanList = Array.from(stylesMap.values());
          if (cleanList.length > 0) {
            setAvailableStyles(cleanList);

            // Synchronize with parent layer state
            if (onStylesLoaded) {
              onStylesLoaded(cleanList, defStyle);
            }
          }

          if (data.sldXml) {
            const parsed = sldToStyleConfig(data.sldXml);
            if (Object.keys(parsed).length > 0) {
              const defaultRasterMode = (bandKeys.length > 1 && parsed.mode === 'multiband') ? 'multiband' : 'single_band';
              const resolvedMode = parsed.mode || (layer.type === 'RASTER' ? defaultRasterMode : 'single');

              onChange({
                mode: resolvedMode,
                strokeColor: parsed.strokeColor || '#ff4d4f',
                strokeWidth: parsed.strokeWidth ?? 1.5,
                strokeOpacity: parsed.strokeOpacity ?? 1,
                lineDash: parsed.lineDash ?? '',
                fillColor: parsed.fillColor || '#ff4d4f',
                fillOpacity: parsed.fillOpacity ?? (layer.type === 'RASTER' ? 1.0 : 0.2),
                pointIcon: parsed.pointIcon || 'circle',
                pointSize: parsed.pointSize ?? 8,
                labelField: parsed.labelField || '',
                labelSize: parsed.labelSize ?? 12,
                labelColor: parsed.labelColor || '#000000',
                labelOutlineColor: parsed.labelOutlineColor || '#ffffff',
                labelOutlineWidth: parsed.labelOutlineWidth ?? 2,
                labelRepeat: parsed.labelRepeat || 'once',
                categorizeField: parsed.categorizeField || '',
                categoryRules: parsed.categoryRules || [],
                graduatedField: parsed.graduatedField || '',
                graduatedMinVal: parsed.graduatedMinVal ?? 0,
                graduatedMaxVal: parsed.graduatedMaxVal ?? 100,
                graduatedColorStart: parsed.graduatedColorStart || '#e6f7ff',
                graduatedColorEnd: parsed.graduatedColorEnd || '#1890ff',
                graduatedClasses: parsed.graduatedClasses ?? 5,
                // Raster specific
                band: parsed.band || bandKeys[0] || 'band_1',
                colormapName: parsed.colormapName || 'gray',
                rescaleMin: parsed.rescaleMin ?? 0,
                rescaleMax: parsed.rescaleMax ?? 255,
                redBand: parsed.redBand || 'band_1',
                greenBand: parsed.greenBand || 'band_2',
                blueBand: parsed.blueBand || 'band_3',
                rasterOpacity: parsed.rasterOpacity ?? 1.0,
                ...parsed,
              });
            }
          }
        }
      }
    } catch (err) {
      console.warn('Could not load GeoServer SLD:', err);
    } finally {
      setIsLoadingSld(false);
    }
  };

  useEffect(() => {
    loadGeoServerStyle();
  }, [layer?.id]);

  useEffect(() => {
    if (layer?.activeStyle) {
      const clean = cleanStyleName(layer.activeStyle, layerWorkspace);
      if (clean && clean.toLowerCase() !== selectedStyle.toLowerCase()) {
        setSelectedStyle(clean);
        loadGeoServerStyle(clean);
      }
    }
  }, [layer?.activeStyle]);

  // Compute live SLD XML string
  const currentSldXml = useMemo(() => {
    return styleConfigToSld(
      styleConfig as StyleConfig,
      layer?.name || 'layer',
      layer?.type === 'RASTER' ? 'raster' : geometryType
    );
  }, [styleConfig, layer?.name, layer?.type, geometryType]);

  const handleUpdate = (updates: Partial<typeof styleConfig>) => {
    onChange({
      ...styleConfig,
      ...updates,
    });
  };

  // Switch to another style linked to this layer
  const handleSelectStyle = (value: string) => {
    setSelectedStyle(value);
    loadGeoServerStyle(value);
  };

  // 1. Update the existing active style
  const handleUpdateCurrentStyle = async () => {
    const targetName = cleanStyleName(selectedStyle || activeGeoServerStyle || 'style', layerWorkspace);
    if (!targetName) {
      message.error('Invalid style name.');
      return;
    }

    setIsSaving(true);
    try {
      const res = await fetch('/api/geoserver/styles', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          layerName: layer.id,
          workspace: layerWorkspace,
          styleName: targetName,
          sldXml: currentSldXml,
          setAsDefault: targetName.toLowerCase() === (activeGeoServerStyle || '').toLowerCase(),
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        const savedName = cleanStyleName(data.styleName || targetName, layerWorkspace);
        message.success(`Style "${savedName}" updated successfully in GeoServer!`);
        setLastSavedTimestamp(Date.now());

        // Immediately reload fresh styles metadata from GeoServer
        await loadGeoServerStyle(savedName);

        if (onSaved) {
          onSaved(savedName);
        }
      } else {
        message.error(data.error || 'Failed to update style in GeoServer.');
      }
    } catch (err: any) {
      console.error('Update style failed:', err);
      message.error(err?.message || 'Network error updating style.');
    } finally {
      setIsSaving(false);
    }
  };

  // 2. Open Modal to save as a new style
  const handleOpenNewStyleModal = () => {
    const baseName = cleanStyleName(selectedStyle || activeGeoServerStyle || 'style', layerWorkspace);
    setNewStyleInputName(`${baseName}_custom`);
    setSetNewAsDefault(true);
    setIsNewStyleModalOpen(true);
  };

  // 3. Confirm Save as New Style
  const handleConfirmSaveNewStyle = async () => {
    const cleanName = cleanStyleName(newStyleInputName, layerWorkspace);
    if (!cleanName) {
      message.error('Please enter a valid style name.');
      return;
    }

    setIsSaving(true);
    try {
      const res = await fetch('/api/geoserver/styles', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          layerName: layer.id,
          workspace: layerWorkspace,
          styleName: cleanName,
          sldXml: currentSldXml,
          setAsDefault: setNewAsDefault,
        }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        const savedName = cleanStyleName(data.styleName || cleanName, layerWorkspace);
        message.success(`New style "${savedName}" saved to GeoServer!`);
        setIsNewStyleModalOpen(false);

        // Immediately register in local availableStyles state
        setAvailableStyles((prev) => {
          const map = new Map<string, any>();
          prev.forEach((s) => map.set(s.name.toLowerCase(), s));
          map.set(savedName.toLowerCase(), {
            name: savedName,
            title: savedName,
            workspace: layerWorkspace,
          });
          return Array.from(map.values());
        });

        // Update state
        setSelectedStyle(savedName);
        if (setNewAsDefault) {
          setActiveGeoServerStyle(savedName);
        }

        setLastSavedTimestamp(Date.now());
        if (onSaved) {
          onSaved(savedName);
        }

        // Reload fresh styles list from GeoServer
        await loadGeoServerStyle(savedName);
      } else {
        message.error(data.error || 'Failed to create new style in GeoServer.');
      }
    } catch (err: any) {
      console.error('Save new style failed:', err);
      message.error(err?.message || 'Network error creating style.');
    } finally {
      setIsSaving(false);
    }
  };

  // 4. Delete the currently selected style
  const handleDeleteStyle = async () => {
    const targetName = cleanStyleName(selectedStyle || activeGeoServerStyle || '', layerWorkspace);
    if (!targetName) {
      message.error('No style selected to delete.');
      return;
    }

    if (availableStyles.length <= 1) {
      message.warning('Cannot delete the layer’s only style. At least one style is required.');
      return;
    }

    setIsDeleting(true);
    try {
      const res = await fetch(
        `/api/geoserver/styles?style=${encodeURIComponent(targetName)}&layer=${encodeURIComponent(
          layer.id
        )}&workspace=${encodeURIComponent(layerWorkspace)}`,
        {
          method: 'DELETE',
        }
      );

      const data = await res.json();
      if (res.ok && data.success) {
        message.success(`Style "${targetName}" deleted successfully!`);

        // Filter out deleted style
        const remaining = availableStyles.filter(
          (s) => s.name.toLowerCase() !== targetName.toLowerCase()
        );
        setAvailableStyles(remaining);

        // Determine new active style
        const nextStyle =
          data.newDefaultStyle ||
          (remaining.length > 0 ? remaining[0].name : '');

        if (data.newDefaultStyle) {
          setActiveGeoServerStyle(data.newDefaultStyle);
        }

        if (nextStyle) {
          setSelectedStyle(nextStyle);
        }

        // Notify parent IMMEDIATELY so page.tsx purges deleted style from addedLayers and selectedStyleLayer!
        if (onDeleted) {
          onDeleted(targetName, nextStyle, remaining);
        } else if (onStylesLoaded) {
          onStylesLoaded(remaining, data.newDefaultStyle || activeGeoServerStyle || undefined);
        }

        if (nextStyle) {
          await loadGeoServerStyle(nextStyle);
        }
      } else {
        message.error(data.error || 'Failed to delete style from GeoServer.');
      }
    } catch (err: any) {
      console.error('Delete style failed:', err);
      message.error(err?.message || 'Network error deleting style.');
    } finally {
      setIsDeleting(false);
    }
  };

  const getBandLabel = (bk: string) => {
    const val = schema[bk] as any;
    if (!val) return `Band ${bk.replace('band_', '')}`;
    if (typeof val === 'object') {
      const name = val.band_name || val.color_interp;
      if (name) {
        return `${name} (Band ${val.band_number ?? bk.replace('band_', '')})`;
      }
      return `Band ${val.band_number ?? bk.replace('band_', '')}`;
    }
    return String(val);
  };

  const geomName = (geometryType || '').toLowerCase();
  const isPoint = geomName.includes('point');
  const isLine = geomName.includes('line') || geomName.includes('string');

  return (
    <div className="flex flex-col gap-3.5 text-gray-700">
      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* 1. UNIFIED HEADER & STYLE SELECTOR CARD                           */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      <div className="bg-gradient-to-b from-gray-50 to-white border border-gray-200/80 rounded-2xl p-3.5 shadow-xs flex flex-col gap-3">
        {/* Layer Info & Badges */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
              {layer.type === 'RASTER' ? (
                <Palette size={15} />
              ) : isPoint ? (
                <MapPin size={15} />
              ) : isLine ? (
                <Spline size={15} />
              ) : (
                <Square size={15} />
              )}
            </div>
            <div className="flex flex-col min-w-0">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider leading-none mb-0.5">
                Target Layer
              </span>
              <span className="text-xs font-bold text-gray-800 truncate" title={layer.name}>
                {layer.name}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {layerWorkspace && (
              <span className="px-1.5 py-0.5 rounded-md text-[9px] font-mono font-bold bg-gray-100 text-gray-600 border border-gray-200">
                {layerWorkspace}
              </span>
            )}
            {isLoadingSld && (
              <span className="flex items-center gap-1 text-[10px] text-blue-600 font-medium">
                <Spin size="small" />
              </span>
            )}
          </div>
        </div>

        {/* Style Selector & Quick Action Bar */}
        <div className="flex flex-col gap-2 pt-2.5 border-t border-gray-100">
          <div className="flex items-center justify-between">
            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
              Active Style
            </label>
            {/* {activeGeoServerStyle && (
              <span className="text-[10px] text-emerald-600 font-semibold flex items-center gap-1 shrink-0">
                <CheckCircle2 size={11} /> Default: {activeGeoServerStyle}
              </span>
            )} */}
          </div>

          {/* Full-width Style Select Dropdown */}
          <div className="w-full">
            <Select
              value={selectedStyle || activeGeoServerStyle || undefined}
              onChange={handleSelectStyle}
              placeholder="Select layer style"
              className="w-full font-mono text-xs"
              size="middle"
              options={availableStyles.map((s) => ({
                value: s.name,
                label: (
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="font-mono text-xs text-gray-800 truncate">{s.name}</span>
                      {s.title && s.title !== s.name && (
                        <span className="text-[10px] text-gray-400 truncate">({s.title})</span>
                      )}
                    </div>
                    {s.name === activeGeoServerStyle && (
                      <span className="text-[9px] bg-emerald-50 text-emerald-700 px-1.5 py-0.2 rounded font-bold border border-emerald-200 shrink-0">
                        Default
                      </span>
                    )}
                  </div>
                ),
              }))}
            />
          </div>

          {/* Responsive Action Buttons: New Style & Delete Style */}
          <div className="flex items-center gap-2 w-full">
            <Tooltip title="Save as a new style in GeoServer without modifying this one">
              <Button
                type="default"
                icon={<Plus size={13} className="text-primary shrink-0" />}
                onClick={handleOpenNewStyleModal}
                className="flex-1 text-xs font-semibold hover:border-primary hover:text-primary h-8.5 rounded-xl flex items-center justify-center gap-1.5"
              >
                <span>New Style</span>
              </Button>
            </Tooltip>

            <Tooltip
              title={
                availableStyles.length <= 1
                  ? "Cannot delete the layer's only style"
                  : `Delete style "${selectedStyle || activeGeoServerStyle}"`
              }
            >
              <Popconfirm
                title="Delete Style from GeoServer"
                description={
                  <div className="max-w-[240px] text-xs flex flex-col gap-1 py-1">
                    <span>
                      Are you sure you want to delete style{' '}
                      <strong className="font-mono text-red-600">
                        "{selectedStyle || activeGeoServerStyle}"
                      </strong>
                      ?
                    </span>
                    {(selectedStyle || activeGeoServerStyle) === activeGeoServerStyle && (
                      <span className="text-[11px] text-amber-600 font-medium bg-amber-50 p-1.5 rounded border border-amber-200 mt-1">
                        Notice: This is the active default style. A remaining alternate style will be promoted to default.
                      </span>
                    )}
                  </div>
                }
                onConfirm={handleDeleteStyle}
                okText="Delete"
                cancelText="Cancel"
                okButtonProps={{ danger: true, loading: isDeleting }}
                disabled={availableStyles.length <= 1 || isDeleting || isSaving}
              >
                <Button
                  danger
                  type="default"
                  icon={
                    isDeleting ? (
                      <RefreshCw size={13} className="animate-spin shrink-0" />
                    ) : (
                      <Trash2 size={13} className="shrink-0" />
                    )
                  }
                  disabled={availableStyles.length <= 1 || isDeleting || isSaving}
                  className="shrink-0 text-xs font-semibold h-8.5 px-3 rounded-xl flex items-center justify-center gap-1 border-red-200 text-red-500 hover:bg-red-50 hover:border-red-300 disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  <span>Delete</span>
                </Button>
              </Popconfirm>
            </Tooltip>
          </div>
        </div>
      </div>

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* 2. TABS: VISUAL EDITOR vs RAW SLD XML                             */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      <Tabs
        activeKey={activeTab}
        onChange={(k) => setActiveTab(k as 'visual' | 'sld')}
        size="small"
        className="custom-style-tabs"
        items={[
          {
            key: 'visual',
            label: (
              <span className="flex items-center gap-1.5 text-xs font-semibold px-1 py-0.5">
                <Palette size={13} /> Visual Editor
              </span>
            ),
          },
          {
            key: 'sld',
            label: (
              <span className="flex items-center gap-1.5 text-xs font-semibold px-1 py-0.5">
                <Code size={13} /> SLD XML
              </span>
            ),
          },
        ]}
      />

      {activeTab === 'sld' ? (
        /* ───────────────────────────────────────────────────────────────── */
        /* RAW SLD XML VIEW                                                  */
        /* ───────────────────────────────────────────────────────────────── */
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
              OGC SLD 1.0.0 Document
            </span>
            <Button
              size="small"
              onClick={() => {
                navigator.clipboard.writeText(currentSldXml);
                message.success('SLD XML copied to clipboard!');
              }}
              className="text-[10px] h-6 px-2.5 rounded-lg"
            >
              Copy XML
            </Button>
          </div>
          <pre className="bg-gray-900 text-gray-100 p-3.5 rounded-2xl text-[10px] font-mono overflow-x-auto max-h-[420px] leading-relaxed border border-gray-800 shadow-inner">
            {currentSldXml}
          </pre>
        </div>
      ) : layer.type === 'RASTER' ? (
        /* ───────────────────────────────────────────────────────────────── */
        /* RASTER LAYER STYLING CONTROLS                                     */
        /* ───────────────────────────────────────────────────────────────── */
        <div className="flex flex-col gap-3.5">
          {/* Mode Selector: Single Band vs RGB Composite */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
              Raster Display Mode
            </span>
            <div className="grid grid-cols-2 gap-1.5 p-1 bg-gray-100/90 rounded-2xl border border-gray-200/60">
              <button
                type="button"
                onClick={() => handleUpdate({ mode: 'single_band' })}
                className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-xl transition-all cursor-pointer ${
                  (styleConfig.mode || 'single_band') !== 'multiband'
                    ? 'bg-white text-primary shadow-xs font-bold border border-primary/20'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-white/50 border border-transparent font-medium'
                }`}
              >
                <Palette size={14} className={(styleConfig.mode || 'single_band') !== 'multiband' ? 'text-primary' : 'text-gray-400'} />
                <span className="text-[11px] leading-none whitespace-nowrap">Single Band / Ramp</span>
              </button>

              <button
                type="button"
                onClick={() => handleUpdate({ mode: 'multiband' })}
                className={`flex items-center justify-center gap-1.5 py-2 px-2 rounded-xl transition-all cursor-pointer ${
                  styleConfig.mode === 'multiband'
                    ? 'bg-white text-primary shadow-xs font-bold border border-primary/20'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-white/50 border border-transparent font-medium'
                }`}
              >
                <Layers size={14} className={styleConfig.mode === 'multiband' ? 'text-primary' : 'text-gray-400'} />
                <span className="text-[11px] leading-none whitespace-nowrap">RGB Composite</span>
              </button>
            </div>
          </div>

          {styleConfig.mode === 'multiband' ? (
            <div className="bg-white border border-gray-200/80 rounded-2xl p-4 flex flex-col gap-3.5 shadow-2xs">
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                RGB Channel Mapping
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-bold text-gray-600">Red Channel (R)</label>
                <Select
                  value={styleConfig.redBand || 'band_1'}
                  onChange={(val) => handleUpdate({ mode: 'multiband', redBand: val })}
                  options={bandKeys.map((bk) => ({ value: bk, label: getBandLabel(bk) }))}
                  className="w-full text-xs"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-bold text-gray-600">Green Channel (G)</label>
                <Select
                  value={styleConfig.greenBand || 'band_2'}
                  onChange={(val) => handleUpdate({ mode: 'multiband', greenBand: val })}
                  options={bandKeys.map((bk) => ({ value: bk, label: getBandLabel(bk) }))}
                  className="w-full text-xs"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-bold text-gray-600">Blue Channel (B)</label>
                <Select
                  value={styleConfig.blueBand || 'band_3'}
                  onChange={(val) => handleUpdate({ mode: 'multiband', blueBand: val })}
                  options={bandKeys.map((bk) => ({ value: bk, label: getBandLabel(bk) }))}
                  className="w-full text-xs"
                />
              </div>
            </div>
          ) : (
            <div className="bg-white border border-gray-200/80 rounded-2xl p-4 flex flex-col gap-3.5 shadow-2xs">
              <div className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                Single Band Symbology
              </div>

              {bandKeys.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] font-bold text-gray-600">Select Band</label>
                  <Select
                    value={styleConfig.band || bandKeys[0] || 'band_1'}
                    onChange={(val) => handleUpdate({ mode: 'single_band', band: val })}
                    options={bandKeys.map((bk) => ({ value: bk, label: getBandLabel(bk) }))}
                    className="w-full text-xs"
                  />
                </div>
              )}

              <div className="flex flex-col gap-1.5">
                <label className="text-[11px] font-bold text-gray-600">Color Ramp</label>
                <Select
                  value={styleConfig.colormapName || 'gray'}
                  onChange={(val) => handleUpdate({ mode: 'single_band', colormapName: val })}
                  options={[
                    { value: 'gray', label: 'Grayscale' },
                    { value: 'terrain', label: 'Terrain (DEM / Elevation)' },
                    { value: 'viridis', label: 'Viridis' },
                    { value: 'rainbow', label: 'Rainbow' },
                    { value: 'plasma', label: 'Plasma' },
                    { value: 'magma', label: 'Magma' },
                    { value: 'inferno', label: 'Inferno' },
                    { value: 'cividis', label: 'Cividis' },
                  ]}
                  className="w-full text-xs"
                />
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-[11px] font-bold text-gray-600">Contrast Stretch (Data Range)</label>
                <div className="flex items-center gap-2">
                  <div className="flex-1 flex flex-col gap-1">
                    <span className="text-[10px] text-gray-400 font-bold">Min Value</span>
                    <input
                      type="number"
                      value={styleConfig.rescaleMin ?? 0}
                      onChange={(e) =>
                        handleUpdate({
                          mode: 'single_band',
                          rescaleMin: parseFloat(e.target.value) || 0,
                        })
                      }
                      className="w-full text-xs px-2.5 py-1.5 border border-gray-200 rounded-lg font-mono bg-white focus:outline-none focus:border-primary"
                    />
                  </div>
                  <div className="flex-1 flex flex-col gap-1">
                    <span className="text-[10px] text-gray-400 font-bold">Max Value</span>
                    <input
                      type="number"
                      value={styleConfig.rescaleMax ?? 255}
                      onChange={(e) =>
                        handleUpdate({
                          mode: 'single_band',
                          rescaleMax: parseFloat(e.target.value) || 0,
                        })
                      }
                      className="w-full text-xs px-2.5 py-1.5 border border-gray-200 rounded-lg font-mono bg-white focus:outline-none focus:border-primary"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Raster Opacity Slider */}
          <div className="bg-white border border-gray-200/80 rounded-2xl p-4 flex flex-col gap-2.5 shadow-2xs">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-bold text-gray-600">Raster Opacity</label>
              <span className="text-xs font-mono font-bold text-gray-800">
                {Math.round(((styleConfig.rasterOpacity ?? styleConfig.fillOpacity ?? 1.0) * 100))}%
              </span>
            </div>
            <Slider
              min={0}
              max={1}
              step={0.05}
              value={styleConfig.rasterOpacity ?? styleConfig.fillOpacity ?? 1.0}
              onChange={(val) => handleUpdate({ rasterOpacity: val, fillOpacity: val })}
              className="m-0"
            />
          </div>
        </div>
      ) : (
        /* ───────────────────────────────────────────────────────────────── */
        /* VECTOR LAYER STYLING CONTROLS                                     */
        /* ───────────────────────────────────────────────────────────────── */
        <div className="flex flex-col gap-3.5">
          {/* Symbolization Mode Selector (Full Text Visibility, No Ellipsis) */}
          <div className="flex flex-col gap-1.5">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
              Symbolization Mode
            </span>
            <div className="grid grid-cols-3 gap-1.5 p-1 bg-gray-100/90 rounded-2xl border border-gray-200/60">
              <button
                type="button"
                onClick={() => handleUpdate({ mode: 'single' })}
                className={`flex flex-col items-center justify-center gap-1 py-2 px-1 rounded-xl transition-all cursor-pointer ${
                  (styleConfig.mode || 'single') === 'single'
                    ? 'bg-white text-primary shadow-xs font-bold border border-primary/20'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-white/50 border border-transparent font-medium'
                }`}
              >
                <Square
                  size={15}
                  className={(styleConfig.mode || 'single') === 'single' ? 'text-primary' : 'text-gray-400'}
                />
                <span className="text-[11px] leading-none whitespace-nowrap">Single</span>
              </button>

              <button
                type="button"
                onClick={() => handleUpdate({ mode: 'categorized' })}
                className={`flex flex-col items-center justify-center gap-1 py-2 px-1 rounded-xl transition-all cursor-pointer ${
                  styleConfig.mode === 'categorized'
                    ? 'bg-white text-primary shadow-xs font-bold border border-primary/20'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-white/50 border border-transparent font-medium'
                }`}
              >
                <Layers
                  size={15}
                  className={styleConfig.mode === 'categorized' ? 'text-primary' : 'text-gray-400'}
                />
                <span className="text-[11px] leading-none whitespace-nowrap">Categorized</span>
              </button>

              <button
                type="button"
                onClick={() => handleUpdate({ mode: 'graduated' })}
                className={`flex flex-col items-center justify-center gap-1 py-2 px-1 rounded-xl transition-all cursor-pointer ${
                  styleConfig.mode === 'graduated'
                    ? 'bg-white text-primary shadow-xs font-bold border border-primary/20'
                    : 'text-gray-600 hover:text-gray-900 hover:bg-white/50 border border-transparent font-medium'
                }`}
              >
                <Sliders
                  size={15}
                  className={styleConfig.mode === 'graduated' ? 'text-primary' : 'text-gray-400'}
                />
                <span className="text-[11px] leading-none whitespace-nowrap">Graduated</span>
              </button>
            </div>
          </div>

          {/* Stroke / Line Outline Card */}
          <div className="bg-white border border-gray-200/80 rounded-2xl p-4 flex flex-col gap-3.5 shadow-2xs">
            <div className="flex items-center justify-between border-b border-gray-100 pb-2">
              <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider flex items-center gap-1.5">
                <Spline size={13} className="text-gray-400" /> Stroke & Outline
              </span>
              <span className="text-[10px] font-mono font-semibold text-gray-500">
                {(styleConfig.strokeWidth ?? 1.5).toFixed(1)}px
              </span>
            </div>

            {/* Line Color */}
            <div className="flex items-center justify-between gap-3">
              <label className="text-xs font-semibold text-gray-700">Line Color</label>
              <ColorPicker
                value={styleConfig.strokeColor || '#ff4d4f'}
                onChange={(color) => handleUpdate({ strokeColor: color.toHexString() })}
                showText
                presets={GIS_COLOR_PRESETS}
                placement="bottomLeft"
                className="w-36 flex items-center justify-between text-xs font-mono"
              />
            </div>

            {/* Line Width */}
            <div className="flex flex-col gap-1">
              <div className="flex justify-between items-center text-xs">
                <span className="font-semibold text-gray-700">Width</span>
                <span className="font-mono text-gray-500 text-[11px]">
                  {(styleConfig.strokeWidth ?? 1.5).toFixed(1)} px
                </span>
              </div>
              <input
                type="range"
                min="0.5"
                max="10"
                step="0.5"
                value={styleConfig.strokeWidth ?? 1.5}
                onChange={(e) => handleUpdate({ strokeWidth: parseFloat(e.target.value) })}
                className="w-full accent-primary h-1.5 rounded-lg bg-gray-200 cursor-pointer"
              />
            </div>

            {/* Line Dash */}
            <div className="flex items-center justify-between gap-3">
              <label className="text-xs font-semibold text-gray-700">Pattern</label>
              <Select
                size="small"
                value={normalizeLineDash(styleConfig.lineDash)}
                onChange={(val) => handleUpdate({ lineDash: val })}
                options={[
                  { value: '', label: 'Solid ────' },
                  { value: '5 5', label: 'Dashed ─ ─ ─' },
                  { value: '2 5', label: 'Dotted · · · ·' },
                  { value: '5 3 2 3', label: 'Dash-Dot ─ · ─ ·' },
                ]}
                className="w-36 text-xs"
              />
            </div>

            {/* Stroke Opacity */}
            <div className="flex flex-col gap-1 pt-1 border-t border-gray-100">
              <div className="flex justify-between items-center text-xs">
                <span className="font-semibold text-gray-700">Line Opacity</span>
                <span className="font-mono text-gray-500 text-[11px]">
                  {Math.round((styleConfig.strokeOpacity ?? 1) * 100)}%
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={styleConfig.strokeOpacity ?? 1}
                onChange={(e) => handleUpdate({ strokeOpacity: parseFloat(e.target.value) })}
                className="w-full accent-primary h-1.5 rounded-lg bg-gray-200 cursor-pointer"
              />
            </div>

            {/* Fill Opacity */}
            <div className="flex flex-col gap-1">
              <div className="flex justify-between items-center text-xs">
                <span className="font-semibold text-gray-700">Fill Opacity</span>
                <span className="font-mono text-gray-500 text-[11px]">
                  {Math.round((styleConfig.fillOpacity ?? 0.2) * 100)}%
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={styleConfig.fillOpacity ?? 0.2}
                onChange={(e) => handleUpdate({ fillOpacity: parseFloat(e.target.value) })}
                className="w-full accent-primary h-1.5 rounded-lg bg-gray-200 cursor-pointer"
              />
            </div>
          </div>

          {/* Point / Marker Settings (When point layer) */}
          {isPoint && (
            <div className="bg-white border border-gray-200/80 rounded-2xl p-4 flex flex-col gap-3.5 shadow-2xs">
              <div className="flex items-center justify-between border-b border-gray-100 pb-2">
                <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider flex items-center gap-1.5">
                  <MapPin size={13} className="text-gray-400" /> Point Marker
                </span>
                <span className="text-[10px] font-mono font-semibold text-gray-500">
                  {styleConfig.pointSize ?? 8}px
                </span>
              </div>

              <div className="flex items-center justify-between gap-3">
                <label className="text-xs font-semibold text-gray-700">Shape</label>
                <Select
                  value={styleConfig.pointIcon || 'circle'}
                  onChange={(val) => handleUpdate({ pointIcon: val })}
                  options={[
                    { value: 'circle', label: 'Circle' },
                    { value: 'marker', label: 'Triangle (Pin)' },
                    { value: 'star', label: 'Star' },
                    { value: 'square', label: 'Square' },
                    { value: 'flag', label: 'Cross' },
                  ]}
                  size="small"
                  className="w-36 text-xs"
                />
              </div>

              <div className="flex flex-col gap-1">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-semibold text-gray-700">Size</span>
                  <span className="font-mono text-gray-500 text-[11px]">
                    {styleConfig.pointSize ?? 8} px
                  </span>
                </div>
                <input
                  type="range"
                  min="4"
                  max="30"
                  step="1"
                  value={styleConfig.pointSize ?? 8}
                  onChange={(e) => handleUpdate({ pointSize: parseInt(e.target.value) })}
                  className="w-full accent-primary h-1.5 rounded-lg bg-gray-200 cursor-pointer"
                />
              </div>
            </div>
          )}

          {/* Single Symbol Fill Color */}
          {styleConfig.mode === 'single' && (
            <div className="bg-white border border-gray-200/80 rounded-2xl p-4 flex items-center justify-between gap-3 shadow-2xs">
              <div>
                <label className="text-xs font-semibold text-gray-700 block">Fill Color</label>
                <span className="text-[10px] text-gray-400">Polygon & marker interior</span>
              </div>
              <ColorPicker
                value={styleConfig.fillColor || '#ff4d4f'}
                onChange={(color) => handleUpdate({ fillColor: color.toHexString() })}
                showText
                presets={GIS_COLOR_PRESETS}
                placement="bottomLeft"
                className="w-36 flex items-center justify-between text-xs font-mono"
              />
            </div>
          )}

          {/* Categorized Mode */}
          {styleConfig.mode === 'categorized' && (
            <div className="bg-white border border-gray-200/80 rounded-2xl p-4 flex flex-col gap-3.5 shadow-2xs">
              <div className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">
                Categorized Classification
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-gray-700">Column (Attribute)</label>
                <Select
                  showSearch
                  filterOption={(input, option) =>
                    (option?.label ?? '').toString().toLowerCase().includes(input.toLowerCase())
                  }
                  value={styleConfig.categorizeField || Object.keys(schema)[0] || ''}
                  onChange={(val) => handleUpdate({ categorizeField: val })}
                  options={Object.keys(schema).map((field) => ({
                    value: field,
                    label: `${field} (${schema[field] || 'string'})`,
                  }))}
                  className="w-full text-xs"
                />
              </div>

              <div className="bg-blue-50/70 border border-blue-100 rounded-xl p-3 text-xs text-blue-800 leading-relaxed flex items-start gap-2">
                <Sparkles size={14} className="text-blue-600 shrink-0 mt-0.5" />
                <span>
                  Features are automatically assigned distinct, stable colors based on their unique attribute values.
                </span>
              </div>
            </div>
          )}

          {/* Graduated Mode */}
          {styleConfig.mode === 'graduated' && (
            <div className="bg-white border border-gray-200/80 rounded-2xl p-4 flex flex-col gap-3.5 shadow-2xs">
              <div className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">
                Numeric Range Classification
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-semibold text-gray-700">Numeric Column</label>
                <Select
                  showSearch
                  filterOption={(input, option) =>
                    (option?.label ?? '').toString().toLowerCase().includes(input.toLowerCase())
                  }
                  value={styleConfig.graduatedField || ''}
                  onChange={(val) => handleUpdate({ graduatedField: val })}
                  options={Object.keys(schema).map((field) => ({
                    value: field,
                    label: `${field} (${schema[field] || 'number'})`,
                  }))}
                  className="w-full text-xs"
                />
              </div>

              <div className="flex gap-2">
                <div className="flex-1 flex flex-col gap-1">
                  <span className="text-[10px] text-gray-400 font-bold">Min Value</span>
                  <Input
                    type="number"
                    size="small"
                    value={styleConfig.graduatedMinVal ?? 0}
                    onChange={(e) => handleUpdate({ graduatedMinVal: parseFloat(e.target.value) || 0 })}
                    className="font-mono text-xs"
                  />
                </div>
                <div className="flex-1 flex flex-col gap-1">
                  <span className="text-[10px] text-gray-400 font-bold">Max Value</span>
                  <Input
                    type="number"
                    size="small"
                    value={styleConfig.graduatedMaxVal ?? 100}
                    onChange={(e) => handleUpdate({ graduatedMaxVal: parseFloat(e.target.value) || 0 })}
                    className="font-mono text-xs"
                  />
                </div>
              </div>

              {/* Gradient Preview Bar */}
              <div
                className="w-full h-3 rounded-full border border-gray-200 shadow-2xs my-1"
                style={{
                  background: `linear-gradient(to right, ${styleConfig.graduatedColorStart || '#fee8c8'}, ${styleConfig.graduatedColorEnd || '#e34a33'})`,
                }}
              />

              <div className="flex items-center justify-between gap-3">
                <label className="text-xs font-semibold text-gray-700">Start Color</label>
                <ColorPicker
                  value={styleConfig.graduatedColorStart || '#fee8c8'}
                  onChange={(color) => handleUpdate({ graduatedColorStart: color.toHexString() })}
                  showText
                  presets={GIS_COLOR_PRESETS}
                  placement="bottomLeft"
                  className="w-36 flex items-center justify-between text-xs font-mono"
                />
              </div>

              <div className="flex items-center justify-between gap-3">
                <label className="text-xs font-semibold text-gray-700">End Color</label>
                <ColorPicker
                  value={styleConfig.graduatedColorEnd || '#e34a33'}
                  onChange={(color) => handleUpdate({ graduatedColorEnd: color.toHexString() })}
                  showText
                  presets={GIS_COLOR_PRESETS}
                  placement="bottomLeft"
                  className="w-36 flex items-center justify-between text-xs font-mono"
                />
              </div>
            </div>
          )}

          {/* Feature Labeling Card */}
          <div className="bg-white border border-gray-200/80 rounded-2xl p-4 flex flex-col gap-3.5 shadow-2xs">
            <div className="flex items-center justify-between border-b border-gray-100 pb-2">
              <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider flex items-center gap-1.5">
                <Type size={13} className="text-gray-400" /> Feature Labels
              </span>
              <Switch
                size="small"
                checked={Boolean(styleConfig.labelField)}
                onChange={(checked) => {
                  handleUpdate({
                    labelField: checked ? Object.keys(schema)[0] || 'name' : '',
                  });
                }}
              />
            </div>

            {styleConfig.labelField ? (
              <>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-gray-700">Label Column</label>
                  <Select
                    showSearch
                    placeholder="Select column"
                    value={styleConfig.labelField}
                    onChange={(val) => handleUpdate({ labelField: val })}
                    options={Object.keys(schema).map((col) => ({ value: col, label: col }))}
                    className="w-full text-xs"
                    size="small"
                  />
                </div>

                <div className="flex items-center justify-between gap-3">
                  <label className="text-xs font-semibold text-gray-700">Text Color</label>
                  <ColorPicker
                    value={styleConfig.labelColor || '#000000'}
                    onChange={(color) => handleUpdate({ labelColor: color.toHexString() })}
                    showText
                    presets={GIS_COLOR_PRESETS}
                    placement="bottomLeft"
                    className="w-36 flex items-center justify-between text-xs font-mono"
                  />
                </div>

                <div className="flex items-center justify-between gap-3">
                  <label className="text-xs font-semibold text-gray-700">Outline / Halo</label>
                  <ColorPicker
                    value={styleConfig.labelOutlineColor || '#ffffff'}
                    onChange={(color) => handleUpdate({ labelOutlineColor: color.toHexString() })}
                    showText
                    presets={GIS_COLOR_PRESETS}
                    placement="bottomLeft"
                    className="w-36 flex items-center justify-between text-xs font-mono"
                  />
                </div>

                <div className="flex flex-col gap-1">
                  <div className="flex justify-between items-center text-xs">
                    <span className="font-semibold text-gray-700">Font Size</span>
                    <span className="font-mono text-gray-500 text-[11px]">
                      {styleConfig.labelSize ?? 12} px
                    </span>
                  </div>
                  <input
                    type="range"
                    min="8"
                    max="24"
                    step="1"
                    value={styleConfig.labelSize ?? 12}
                    onChange={(e) => handleUpdate({ labelSize: parseInt(e.target.value) })}
                    className="w-full accent-primary h-1.5 rounded-lg bg-gray-200 cursor-pointer"
                  />
                </div>
              </>
            ) : (
              <div className="text-[11px] text-gray-400 italic">
                Toggle the switch to display feature attributes as map labels.
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* 3. STICKY SAVE ACTIONS BAR                                        */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      <div className="pt-2 flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Button
            type="primary"
            icon={isSaving ? <RefreshCw size={13} className="animate-spin" /> : <Save size={13} />}
            loading={isSaving}
            onClick={handleUpdateCurrentStyle}
            className="flex-1 text-xs font-semibold bg-primary hover:bg-primary-hover shadow-xs h-9 rounded-xl"
          >
            {isSaving ? 'Saving...' : `Save Changes`}
          </Button>

          <Button
            type="default"
            icon={<Copy size={13} />}
            onClick={handleOpenNewStyleModal}
            className="text-xs font-semibold h-9 rounded-xl px-3 hover:border-primary hover:text-primary"
          >
            Save As...
          </Button>
        </div>

        {lastSavedTimestamp && (
          <div className="text-[10px] text-emerald-600 text-center font-medium flex items-center justify-center gap-1">
            <CheckCircle2 size={11} /> Saved & Synced with GeoServer (
            {new Date(lastSavedTimestamp).toLocaleTimeString()})
          </div>
        )}
      </div>

      {/* ─────────────────────────────────────────────────────────────────── */}
      {/* 4. MODAL: SAVE AS NEW STYLE                                       */}
      {/* ─────────────────────────────────────────────────────────────────── */}
      <Modal
        title={
          <div className="flex items-center gap-2 text-sm font-bold text-gray-800">
            <Plus size={16} className="text-primary" />
            <span>Save as New GeoServer Style</span>
          </div>
        }
        open={isNewStyleModalOpen}
        onCancel={() => setIsNewStyleModalOpen(false)}
        onOk={handleConfirmSaveNewStyle}
        okText={isSaving ? 'Saving...' : 'Create & Apply Style'}
        confirmLoading={isSaving}
        cancelText="Cancel"
        centered
        className="rounded-2xl"
      >
        <div className="flex flex-col gap-3.5 py-2">
          <p className="text-xs text-gray-500 leading-relaxed">
            This will create an independent SLD style in GeoServer without modifying{' '}
            <strong className="text-gray-700 font-mono">
              {selectedStyle || activeGeoServerStyle}
            </strong>
            .
          </p>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-bold text-gray-700">New Style Name</label>
            <Input
              size="middle"
              addonBefore={layerWorkspace ? `${layerWorkspace} /` : undefined}
              value={newStyleInputName}
              onChange={(e) => setNewStyleInputName(cleanStyleName(e.target.value, layerWorkspace))}
              placeholder="e.g. roads_night_v2"
              className="font-mono text-xs"
              autoFocus
            />
            <span className="text-[10px] text-gray-400">
              Only letters, numbers, and underscores are used.
            </span>
          </div>

          <div className="bg-gray-50 border border-gray-200/70 rounded-xl p-3">
            <Checkbox
              checked={setNewAsDefault}
              onChange={(e) => setSetNewAsDefault(e.target.checked)}
              className="text-xs text-gray-700 font-medium"
            >
              Set as this layer's default style in GeoServer
            </Checkbox>
            <p className="text-[10px] text-gray-400 mt-1 pl-6">
              If unchecked, the style will be saved as an alternate style that you can switch to anytime.
            </p>
          </div>
        </div>
      </Modal>
    </div>
  );
}
