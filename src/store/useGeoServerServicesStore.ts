// ============================================================================
// GeoServer Services & Capabilities Store (useGeoServerServicesStore)
//
// Manages the user's selected GeoServer services and capabilities preferences:
// - WMS (Web Map Service): enabled flag & version (1.3.0 / 1.1.1)
// - WFS (Web Feature Service): enabled flag & version (2.0.0 / 1.1.0 / 1.0.0)
// - WMTS (Web Map Tile Service): enabled flag & version (1.0.0)
// - WCS (Web Coverage Service): enabled flag & version (2.0.1 / 1.1.1)
// - WPS (Web Processing Service): enabled flag & version (1.0.0)
// - capabilitiesMode: 'WMS' | 'WFS' | 'WMTS' | 'ALL'
// - defaultLayerService: 'WMS' | 'WMTS'
//
// Automatically persisted in browser localStorage across sessions.
// ============================================================================

import { create } from 'zustand';

export interface ServiceConfigItem {
  enabled: boolean;
  version: string;
}

export interface GeoServerServicesConfig {
  wms: ServiceConfigItem;
  wfs: ServiceConfigItem;
  wmts: ServiceConfigItem;
  wcs: ServiceConfigItem;
  wps: ServiceConfigItem;
  capabilitiesMode: 'WMS' | 'WFS' | 'WMTS' | 'WCS' | 'ALL';
  defaultLayerService: 'WMS' | 'WMTS' | 'WCS';
  activeDiscoveryService: 'WMS' | 'WFS' | 'WMTS' | 'WCS' | 'HYBRID' | null;
}

export const DEFAULT_SERVICES_CONFIG: GeoServerServicesConfig = {
  wms: { enabled: true, version: '1.3.0' },
  wfs: { enabled: true, version: '1.1.0' },
  wmts: { enabled: false, version: '1.0.0' },
  wcs: { enabled: false, version: '2.0.1' },
  wps: { enabled: false, version: '1.0.0' },
  capabilitiesMode: 'WMS',
  defaultLayerService: 'WMS',
  activeDiscoveryService: null,
};

const STORAGE_KEY = 'geoserver_services_config';

function loadInitialConfig(): GeoServerServicesConfig {
  if (typeof window === 'undefined') return DEFAULT_SERVICES_CONFIG;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SERVICES_CONFIG;
    const parsed = JSON.parse(raw);
    return {
      wms: { ...DEFAULT_SERVICES_CONFIG.wms, ...(parsed.wms || {}) },
      wfs: { ...DEFAULT_SERVICES_CONFIG.wfs, ...(parsed.wfs || {}) },
      wmts: { ...DEFAULT_SERVICES_CONFIG.wmts, ...(parsed.wmts || {}) },
      wcs: { ...DEFAULT_SERVICES_CONFIG.wcs, ...(parsed.wcs || {}) },
      wps: { ...DEFAULT_SERVICES_CONFIG.wps, ...(parsed.wps || {}) },
      capabilitiesMode: parsed.capabilitiesMode || 'WMS',
      defaultLayerService: parsed.defaultLayerService || 'WMS',
      activeDiscoveryService: parsed.activeDiscoveryService || null,
    };
  } catch {
    return DEFAULT_SERVICES_CONFIG;
  }
}

function saveConfig(config: GeoServerServicesConfig) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch (err) {
    console.warn('Failed to save geoserver_services_config:', err);
  }
}

export interface GeoServerServicesStore extends GeoServerServicesConfig {
  setService: (key: 'wms' | 'wfs' | 'wmts' | 'wcs' | 'wps', item: Partial<ServiceConfigItem>) => void;
  setCapabilitiesMode: (mode: 'WMS' | 'WFS' | 'WMTS' | 'WCS' | 'ALL') => void;
  setDefaultLayerService: (service: 'WMS' | 'WMTS' | 'WCS') => void;
  setActiveDiscoveryService: (service: 'WMS' | 'WFS' | 'WMTS' | 'WCS' | 'HYBRID') => void;
  setConfig: (config: Partial<GeoServerServicesConfig>) => void;
  resetConfig: () => void;
}

export const useGeoServerServicesStore = create<GeoServerServicesStore>((set, get) => {
  const initial = loadInitialConfig();

  return {
    ...initial,

    setService: (key, item) => {
      const current = get();
      const updated = {
        ...current,
        [key]: {
          ...current[key],
          ...item,
        },
      };
      saveConfig(updated);
      set({ [key]: updated[key] });
    },

    setCapabilitiesMode: (mode) => {
      const current = get();
      const updated = { ...current, capabilitiesMode: mode };
      saveConfig(updated);
      set({ capabilitiesMode: mode });
    },

    setDefaultLayerService: (service) => {
      const current = get();
      const updated = { ...current, defaultLayerService: service };
      saveConfig(updated);
      set({ defaultLayerService: service });
    },

    setActiveDiscoveryService: (service) => {
      const current = get();
      const updated = { ...current, activeDiscoveryService: service };
      saveConfig(updated);
      set({ activeDiscoveryService: service });
    },

    setConfig: (patch) => {
      const current = get();
      const updated = {
        ...current,
        ...patch,
      };
      saveConfig(updated);
      set(patch);
    },

    resetConfig: () => {
      saveConfig(DEFAULT_SERVICES_CONFIG);
      set(DEFAULT_SERVICES_CONFIG);
    },
  };
});

/** Helper to get latest config synchronously anywhere (e.g. inside api.ts) */
export function getActiveServicesConfig(): GeoServerServicesConfig {
  if (typeof window !== 'undefined') {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        return {
          wms: { ...DEFAULT_SERVICES_CONFIG.wms, ...(parsed.wms || {}) },
          wfs: { ...DEFAULT_SERVICES_CONFIG.wfs, ...(parsed.wfs || {}) },
          wmts: { ...DEFAULT_SERVICES_CONFIG.wmts, ...(parsed.wmts || {}) },
          wcs: { ...DEFAULT_SERVICES_CONFIG.wcs, ...(parsed.wcs || {}) },
          wps: { ...DEFAULT_SERVICES_CONFIG.wps, ...(parsed.wps || {}) },
          capabilitiesMode: parsed.capabilitiesMode || 'WMS',
          defaultLayerService: parsed.defaultLayerService || 'WMS',
          activeDiscoveryService: parsed.activeDiscoveryService || null,
        };
      }
    } catch {
      // fallback
    }
  }
  return useGeoServerServicesStore.getState();
}
