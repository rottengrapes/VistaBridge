// ============================================================================
// App Configuration Store (Zustand)
//
// Fetches system URLs from /api/config/public (stored in SQLite)
// so the frontend knows where GeoServer and the TileServer are running.
// ============================================================================


import { create } from 'zustand';

function getDefaultGeoserverUrl(): string {
  if (typeof window !== 'undefined' && window.location.origin && !window.location.origin.includes('localhost')) {
    return `${window.location.origin}/geoserver`;
  }
  return 'http://localhost:8080/geoserver';
}

interface ConfigState {
  geoserverUrl: string;
  tileservUrl: string;
  apiUrl: string;
  isLoaded: boolean;
  fetchConfig: () => Promise<void>;
  getConfig: () => { geoserverUrl: string; tileservUrl: string };
}

let activeFetchPromise: Promise<void> | null = null;

export const useConfigStore = create<ConfigState>((set, get) => ({
  geoserverUrl: getDefaultGeoserverUrl(),
  tileservUrl: 'http://localhost:7800',
  apiUrl: '/api',
  isLoaded: false,

  fetchConfig: async () => {
    if (get().isLoaded) return;
    if (activeFetchPromise) return activeFetchPromise;

    activeFetchPromise = (async () => {
      try {
        const res = await fetch('/api/config/public', { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          set({
            geoserverUrl: data.geoserverUrl || getDefaultGeoserverUrl(),
            tileservUrl: data.tileservUrl || 'http://localhost:7800',
            apiUrl: data.apiUrl || '/api',
            isLoaded: true,
          });
        }
      } catch (err) {
        console.warn('[useConfigStore] Failed to load config from SQLite API:', err);
      } finally {
        activeFetchPromise = null;
      }
    })();

    return activeFetchPromise;
  },
  getConfig: () => {
    const state = get();
    return {
      geoserverUrl: state.geoserverUrl,
      tileservUrl: state.tileservUrl,
    };
  },
}));
