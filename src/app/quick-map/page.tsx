// ============================================================================
// Quick Map Page Route (/quick-map)
//
// Immediate guest-accessible 2D GIS map workspace:
// - Offers the full interactive 2D map UI (layers, measurement, query, tools)
// - Available directly from the login page without signing in
// - Workspace persistence / saving to database is permanently disabled
// ============================================================================

'use client';

import React from 'react';
import Map2DPage from '@/app/map/2d/page';

export default function QuickMapPage() {
  return <Map2DPage isQuickMap={true} />;
}

