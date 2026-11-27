// ============================================================================
// GeoServer Styles API Route (/api/geoserver/styles)
//
// Provides secure server-side REST integration with GeoServer for styles & SLD:
// 1. GET: Fetch layer styles, default style, and active SLD XML.
// 2. POST / PUT: Create or update an SLD style and assign it as the layer's default
//    or as an alternate style alongside existing styles.
// ============================================================================

import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { resolveInternalGeoServerUrl } from '@/lib/geoserver';

/**
 * Strips workspace prefix from a style name (e.g. "sf:roads" -> "roads")
 * and cleans up any repeated workspace prefixes (e.g. "sf_sf_simple_road" -> "simple_road").
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

async function getGeoServerContext(req: NextRequest) {
  const cookieStore = await cookies();
  const geoserverAuth =
    cookieStore.get('geoserver_auth')?.value ||
    req.headers.get('authorization') ||
    process.env.GEOSERVER_AUTH ||
    `Basic ${Buffer.from(
      `${process.env.GEOSERVER_USERNAME || 'admin'}:${process.env.GEOSERVER_PASSWORD || 'geoserver'}`
    ).toString('base64')}`;

  const geoserverUrlCookie = cookieStore.get('geoserver_url')?.value;
  const configuredBase = (
    process.env.NEXT_PUBLIC_GEOSERVER_URL ||
    process.env.GEOSERVER_URL ||
    ''
  ).replace(/\/+$/, '');
  const rawGeoserverBase =
    configuredBase ||
    (geoserverUrlCookie || '').replace(/\/+$/, '') ||
    'http://localhost:8080/geoserver';
  const geoserverBase = resolveInternalGeoServerUrl(rawGeoserverBase);

  return { geoserverBase, geoserverAuth };
}

// ----------------------------------------------------------------------------
// GET /api/geoserver/styles
// Query parameters:
// - layer: workspace:layer_name or layer_name
// - style: style_name (optional; if omitted, returns default style)
// - workspace: workspace_name (optional)
// ----------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  try {
    const { geoserverBase, geoserverAuth } = await getGeoServerContext(req);
    const { searchParams } = new URL(req.url);
    const layer = searchParams.get('layer');
    const requestedStyle = searchParams.get('style');
    const workspaceParam = searchParams.get('workspace');

    const authHeaders: Record<string, string> = {
      Accept: 'application/json',
      Authorization: geoserverAuth,
    };

    // 1. If layer parameter is supplied, query layer metadata & active SLD
    if (layer) {
      let ws = workspaceParam || '';
      let shortLayerName = layer;
      if (layer.includes(':')) {
        const parts = layer.split(':');
        ws = parts[0];
        shortLayerName = parts[1];
      }

      let layerData: any = null;

      // Try fetching layer info
      const tryLayerUrls = [
        `${geoserverBase}/rest/layers/${layer}.json`,
        `${geoserverBase}/rest/layers/${shortLayerName}.json`,
        `${geoserverBase}/rest/layers/${encodeURIComponent(layer)}.json`,
        `${geoserverBase}/rest/layers/${encodeURIComponent(shortLayerName)}.json`,
      ];

      for (const url of tryLayerUrls) {
        try {
          const res = await fetch(url, { headers: authHeaders });
          if (res.ok) {
            const data = await res.json();
            layerData = data?.layer;
            if (layerData) break;
          }
        } catch {
          // continue
        }
      }

      const defaultStyleObj = layerData?.defaultStyle;
      const rawDefaultName =
        defaultStyleObj?.name || (typeof defaultStyleObj === 'string' ? defaultStyleObj : shortLayerName);
      const defaultStyleName = cleanStyleName(rawDefaultName, ws);
      const styleWs = defaultStyleObj?.workspace || ws || '';

      const rawAlt = layerData?.styles?.style;
      const alternateStylesList: any[] = [];
      if (Array.isArray(rawAlt)) {
        alternateStylesList.push(...rawAlt);
      } else if (rawAlt && typeof rawAlt === 'object') {
        alternateStylesList.push(rawAlt);
      }

      const cleanedAlternateStyles = alternateStylesList
        .map((s) => {
          const raw = typeof s === 'string' ? s : s?.name || '';
          const sWs = typeof s === 'object' ? s?.workspace || ws : ws;
          const cleaned = cleanStyleName(raw, sWs);
          return {
            name: cleaned,
            rawName: raw,
            title: typeof s === 'object' && s?.title ? s.title : cleaned,
            workspace: sWs,
          };
        })
        .filter((s) => s.name);

      // Ensure defaultStyle is included in styles list
      if (
        defaultStyleName &&
        !cleanedAlternateStyles.some((s) => s.name.toLowerCase() === defaultStyleName.toLowerCase())
      ) {
        cleanedAlternateStyles.unshift({
          name: defaultStyleName,
          rawName: rawDefaultName,
          title: defaultStyleName,
          workspace: styleWs,
        });
      }

      // Determine which style to fetch SLD for (requestedStyle or default)
      const targetStyleName = requestedStyle
        ? cleanStyleName(requestedStyle, ws)
        : defaultStyleName;

      let targetStyleWs = styleWs;
      if (requestedStyle) {
        const found = cleanedAlternateStyles.find((s) => s.name === targetStyleName);
        if (found?.workspace) targetStyleWs = found.workspace;
      }

      let sldXml = '';

      // Try fetching SLD for target style via REST API
      const trySldUrls: string[] = [];
      if (targetStyleWs && targetStyleName) {
        trySldUrls.push(
          `${geoserverBase}/rest/workspaces/${encodeURIComponent(targetStyleWs)}/styles/${encodeURIComponent(targetStyleName)}.sld`
        );
      }
      if (targetStyleName) {
        trySldUrls.push(`${geoserverBase}/rest/styles/${encodeURIComponent(targetStyleName)}.sld`);
      }

      for (const sldUrl of trySldUrls) {
        try {
          const sldRes = await fetch(sldUrl, {
            headers: {
              Accept: 'application/vnd.ogc.sld+xml, application/xml, text/xml, */*',
              Authorization: geoserverAuth,
            },
          });
          if (sldRes.ok) {
            sldXml = await sldRes.text();
            if (sldXml && sldXml.includes('StyledLayerDescriptor')) {
              break;
            }
          }
        } catch {
          // continue
        }
      }

      // If REST failed to return SLD, fallback to standard WMS GetStyles
      if (!sldXml) {
        try {
          const styleParam = targetStyleName ? `&styles=${encodeURIComponent(targetStyleName)}` : '';
          const wmsGetStylesUrl = `${geoserverBase}/ows?service=WMS&version=1.1.1&request=GetStyles&layers=${encodeURIComponent(layer)}${styleParam}`;
          const wmsRes = await fetch(wmsGetStylesUrl, {
            headers: {
              Accept: 'application/vnd.ogc.sld+xml, application/xml, text/xml, */*',
              Authorization: geoserverAuth,
            },
          });
          if (wmsRes.ok) {
            const wmsText = await wmsRes.text();
            if (wmsText.includes('StyledLayerDescriptor')) {
              sldXml = wmsText;
            }
          }
        } catch {
          // fallback failed
        }
      }

      return NextResponse.json({
        success: true,
        layerName: layer,
        workspace: ws,
        defaultStyle: defaultStyleName,
        activeStyle: targetStyleName,
        styles: cleanedAlternateStyles,
        sldXml: sldXml || null,
      });
    }

    // 2. If style parameter is supplied without layer, query that style's SLD
    if (requestedStyle) {
      const cleanRequested = cleanStyleName(requestedStyle, workspaceParam || undefined);
      let sldXml = '';
      const styleUrls = [];
      if (workspaceParam) {
        styleUrls.push(
          `${geoserverBase}/rest/workspaces/${encodeURIComponent(workspaceParam)}/styles/${encodeURIComponent(cleanRequested)}.sld`
        );
      }
      styleUrls.push(`${geoserverBase}/rest/styles/${encodeURIComponent(cleanRequested)}.sld`);

      for (const url of styleUrls) {
        try {
          const res = await fetch(url, {
            headers: {
              Accept: 'application/vnd.ogc.sld+xml, application/xml, text/xml, */*',
              Authorization: geoserverAuth,
            },
          });
          if (res.ok) {
            sldXml = await res.text();
            if (sldXml) break;
          }
        } catch {
          // continue
        }
      }

      return NextResponse.json({
        success: Boolean(sldXml),
        styleName: cleanRequested,
        workspace: workspaceParam || null,
        sldXml: sldXml || null,
      });
    }

    // 3. Otherwise, list all available styles
    const listUrl = workspaceParam
      ? `${geoserverBase}/rest/workspaces/${encodeURIComponent(workspaceParam)}/styles.json`
      : `${geoserverBase}/rest/styles.json`;

    const listRes = await fetch(listUrl, { headers: authHeaders });
    if (!listRes.ok) {
      return NextResponse.json({ success: false, styles: [] });
    }
    const listData = await listRes.json();
    const rawStyles = listData?.styles?.style || [];
    const styles = Array.isArray(rawStyles) ? rawStyles : [rawStyles];

    return NextResponse.json({
      success: true,
      styles: styles.map((s) => (typeof s === 'string' ? { name: cleanStyleName(s) } : { ...s, name: cleanStyleName(s.name) })),
    });
  } catch (err: any) {
    console.error('GeoServer Styles GET Error:', err);
    return NextResponse.json(
      { success: false, error: err?.message || 'Failed to fetch style from GeoServer' },
      { status: 500 }
    );
  }
}

// ----------------------------------------------------------------------------
// POST & PUT /api/geoserver/styles
// Body payload:
// {
//   layerName?: string;
//   workspace?: string;
//   styleName: string;
//   sldXml: string;
//   setAsDefault?: boolean;
// }
// ----------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  return handleSaveStyle(req);
}

export async function PUT(req: NextRequest) {
  return handleSaveStyle(req);
}

async function handleSaveStyle(req: NextRequest) {
  try {
    const { geoserverBase, geoserverAuth } = await getGeoServerContext(req);
    const body = await req.json();
    const { layerName, sldXml, setAsDefault = true } = body;

    let { styleName, workspace } = body;

    if (!sldXml || typeof sldXml !== 'string') {
      return NextResponse.json({ error: 'Missing or invalid sldXml' }, { status: 400 });
    }

    // Parse workspace from layerName if present (e.g. "sf:roads")
    let shortLayerName = layerName || '';
    if (layerName && layerName.includes(':')) {
      const parts = layerName.split(':');
      if (!workspace) workspace = parts[0];
      shortLayerName = parts[1];
    }

    // Clean styleName: strip any workspace prefix and repeated prefixes
    styleName = cleanStyleName(styleName, workspace);

    // Default styleName if omitted or emptied
    if (!styleName) {
      styleName = shortLayerName ? `${shortLayerName}_style` : 'custom_style';
    }

    // Sanitize styleName to alphanumeric and underscore
    styleName = styleName.replace(/[^a-zA-Z0-9_-]/g, '_').toLowerCase();

    const authHeaders = {
      Accept: 'application/json',
      Authorization: geoserverAuth,
    };

    // Step 1: Check if style already exists
    const checkUrls = [];
    if (workspace) {
      checkUrls.push(
        `${geoserverBase}/rest/workspaces/${encodeURIComponent(workspace)}/styles/${encodeURIComponent(styleName)}.json`
      );
    }
    checkUrls.push(`${geoserverBase}/rest/styles/${encodeURIComponent(styleName)}.json`);

    let existingStyleUrl: string | null = null;
    let targetWorkspaceForStyle: string | null = workspace || null;

    for (const url of checkUrls) {
      try {
        const checkRes = await fetch(url, {
          method: 'GET',
          headers: authHeaders,
        });
        if (checkRes.ok) {
          existingStyleUrl = url.replace(/\.json$/, '');
          targetWorkspaceForStyle = url.includes('/workspaces/') ? workspace : null;
          break;
        }
      } catch {
        // continue
      }
    }

    // Step 2: Upload or Update SLD XML
    if (existingStyleUrl) {
      // Update existing style via PUT
      const putRes = await fetch(existingStyleUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/vnd.ogc.sld+xml',
          Authorization: geoserverAuth,
        },
        body: sldXml,
      });

      if (!putRes.ok && putRes.status !== 200 && putRes.status !== 201) {
        const errText = await putRes.text();
        return NextResponse.json(
          { error: `GeoServer rejected style update: ${errText || putRes.statusText}` },
          { status: putRes.status }
        );
      }
    } else {
      // Create new style
      const createStyleUrl = targetWorkspaceForStyle
        ? `${geoserverBase}/rest/workspaces/${encodeURIComponent(targetWorkspaceForStyle)}/styles?name=${encodeURIComponent(styleName)}`
        : `${geoserverBase}/rest/styles?name=${encodeURIComponent(styleName)}`;

      let createRes = await fetch(createStyleUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/vnd.ogc.sld+xml',
          Authorization: geoserverAuth,
        },
        body: sldXml,
      });

      // If direct XML POST is rejected (older GeoServer requires JSON registration first):
      if (!createRes.ok) {
        const regUrl = targetWorkspaceForStyle
          ? `${geoserverBase}/rest/workspaces/${encodeURIComponent(targetWorkspaceForStyle)}/styles`
          : `${geoserverBase}/rest/styles`;

        const regRes = await fetch(regUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: geoserverAuth,
          },
          body: JSON.stringify({
            style: {
              name: styleName,
              filename: `${styleName}.sld`,
            },
          }),
        });

        if (regRes.ok || regRes.status === 201) {
          const putUrl = targetWorkspaceForStyle
            ? `${geoserverBase}/rest/workspaces/${encodeURIComponent(targetWorkspaceForStyle)}/styles/${encodeURIComponent(styleName)}`
            : `${geoserverBase}/rest/styles/${encodeURIComponent(styleName)}`;

          createRes = await fetch(putUrl, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/vnd.ogc.sld+xml',
              Authorization: geoserverAuth,
            },
            body: sldXml,
          });
        }
      }

      if (!createRes.ok && createRes.status !== 200 && createRes.status !== 201) {
        const errText = await createRes.text();
        return NextResponse.json(
          { error: `GeoServer rejected style creation: ${errText || createRes.statusText}` },
          { status: createRes.status }
        );
      }
    }

    // Step 3: Link style to the layer (as defaultStyle or as alternate style)
    let layerAssigned = false;
    if (shortLayerName) {
      const fetchLayerUrls = [
        `${geoserverBase}/rest/layers/${layerName}.json`,
        `${geoserverBase}/rest/layers/${shortLayerName}.json`,
        `${geoserverBase}/rest/layers/${encodeURIComponent(layerName)}.json`,
        `${geoserverBase}/rest/layers/${encodeURIComponent(shortLayerName)}.json`,
      ];

      let existingLayerData: any = null;
      let matchedLayerUrl: string | null = null;
      for (const lUrl of fetchLayerUrls) {
        try {
          const lRes = await fetch(lUrl, { headers: authHeaders });
          if (lRes.ok) {
            const lJson = await lRes.json();
            existingLayerData = lJson?.layer;
            matchedLayerUrl = lUrl;
            break;
          }
        } catch {
          // continue
        }
      }

      if (matchedLayerUrl) {
        const currentDefaultObj = existingLayerData?.defaultStyle;
        const currentDefaultName = cleanStyleName(currentDefaultObj?.name || '', workspace);
        const currentDefaultWs = currentDefaultObj?.workspace || targetWorkspaceForStyle || null;

        const rawExistingAlt = existingLayerData?.styles?.style || [];
        const existingAltArray: any[] = Array.isArray(rawExistingAlt) ? rawExistingAlt : [rawExistingAlt].filter(Boolean);

        // Build new style list (alternate styles)
        const newAltStylesMap = new Map<string, any>();
        existingAltArray.forEach((s) => {
          const rawName = typeof s === 'string' ? s : s?.name;
          const sWs = typeof s === 'object' && s?.workspace ? s.workspace : (targetWorkspaceForStyle || undefined);
          const clean = cleanStyleName(rawName, workspace);
          if (clean) {
            newAltStylesMap.set(clean.toLowerCase(), {
              name: clean,
              ...(sWs ? { workspace: sWs } : {}),
            });
          }
        });

        let targetDefaultPayload: any;

        if (setAsDefault) {
          // Setting this style as default:
          targetDefaultPayload = {
            name: styleName,
            ...(targetWorkspaceForStyle ? { workspace: targetWorkspaceForStyle } : {}),
          };
          // Preserve old default style in alternate styles list so it is NOT lost
          if (currentDefaultName && currentDefaultName.toLowerCase() !== styleName.toLowerCase()) {
            newAltStylesMap.set(currentDefaultName.toLowerCase(), {
              name: currentDefaultName,
              ...(currentDefaultWs ? { workspace: currentDefaultWs } : {}),
            });
          }
          // Remove the new default style from alternate styles list
          newAltStylesMap.delete(styleName.toLowerCase());
        } else {
          // Not default: preserve current default (cleaned of read-only href) and register this as alternate!
          targetDefaultPayload = {
            name: currentDefaultName,
            ...(currentDefaultWs ? { workspace: currentDefaultWs } : {}),
          };
          newAltStylesMap.set(styleName.toLowerCase(), {
            name: styleName,
            ...(targetWorkspaceForStyle ? { workspace: targetWorkspaceForStyle } : {}),
          });
        }

        const altStylesList = Array.from(newAltStylesMap.values());

        const layerPayload: any = {
          layer: {
            defaultStyle: targetDefaultPayload,
            styles: { style: altStylesList },
          },
        };

        const putLayerUrl = matchedLayerUrl.replace(/\.json$/, '');
        try {
          const assignRes = await fetch(putLayerUrl, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
              Authorization: geoserverAuth,
            },
            body: JSON.stringify(layerPayload),
          });
          if (assignRes.ok || assignRes.status === 200 || assignRes.status === 201) {
            layerAssigned = true;
          } else {
            const errText = await assignRes.text();
            console.warn(`Layer style binding response (${assignRes.status}):`, errText);
          }
        } catch (assignErr) {
          console.warn('Error binding style to layer:', assignErr);
        }
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Style successfully saved to GeoServer',
      styleName,
      workspace: targetWorkspaceForStyle,
      setAsDefault,
      layerAssigned,
    });
  } catch (err: any) {
    console.error('GeoServer Save Style Error:', err);
    return NextResponse.json(
      { error: err?.message || 'Failed to save style to GeoServer' },
      { status: 500 }
    );
  }
}

// ----------------------------------------------------------------------------
// DELETE /api/geoserver/styles
// Query parameters or body:
// - style: style_name to delete
// - layer: layer_name (e.g. "sf:roads")
// - workspace: workspace_name (optional)
// ----------------------------------------------------------------------------
export async function DELETE(req: NextRequest) {
  try {
    const { geoserverBase, geoserverAuth } = await getGeoServerContext(req);
    const { searchParams } = new URL(req.url);

    let styleParam = searchParams.get('style');
    let layerParam = searchParams.get('layer');
    let workspaceParam = searchParams.get('workspace');

    // Also support JSON body if passed via body
    if (!styleParam && req.headers.get('content-type')?.includes('application/json')) {
      try {
        const body = await req.json();
        styleParam = body.style || body.styleName;
        layerParam = body.layer || body.layerName;
        workspaceParam = body.workspace;
      } catch {
        // continue with searchParams
      }
    }

    if (!styleParam) {
      return NextResponse.json({ error: 'Missing required parameter: style' }, { status: 400 });
    }

    let ws = workspaceParam || '';
    let shortLayerName = layerParam || '';
    if (layerParam && layerParam.includes(':')) {
      const parts = layerParam.split(':');
      if (!ws) ws = parts[0];
      shortLayerName = parts[1];
    }

    const targetStyleName = cleanStyleName(styleParam, ws);
    if (!targetStyleName) {
      return NextResponse.json({ error: 'Invalid style name' }, { status: 400 });
    }

    const authHeaders = {
      Accept: 'application/json',
      Authorization: geoserverAuth,
    };

    let newDefaultStyleName: string | null = null;

    // Step 1: If layer is specified, check layer's styles and unlink before deletion
    if (shortLayerName) {
      const tryLayerUrls = [
        `${geoserverBase}/rest/layers/${encodeURIComponent(shortLayerName)}.json`,
        `${geoserverBase}/rest/layers/${encodeURIComponent(`${ws}:${shortLayerName}`)}.json`,
      ];
      if (layerParam && layerParam.includes(':')) {
        tryLayerUrls.unshift(`${geoserverBase}/rest/layers/${encodeURIComponent(layerParam)}.json`);
      }

      let layerData: any = null;
      let matchedLayerUrl: string | null = null;

      for (const url of tryLayerUrls) {
        try {
          const res = await fetch(url, { headers: authHeaders });
          if (res.ok) {
            const data = await res.json();
            layerData = data?.layer;
            matchedLayerUrl = url;
            break;
          }
        } catch {
          // continue
        }
      }

      if (layerData && matchedLayerUrl) {
        const defObj = layerData.defaultStyle;
        const currentDefName = cleanStyleName(defObj?.name || '', ws);
        const isDefault = currentDefName.toLowerCase() === targetStyleName.toLowerCase();

        const rawAlt = layerData.styles?.style || [];
        const altArray: any[] = Array.isArray(rawAlt) ? rawAlt : [rawAlt].filter(Boolean);

        // Filter out targetStyleName from alternate styles list
        const remainingAltList: any[] = [];
        for (const s of altArray) {
          const rawName = typeof s === 'string' ? s : s?.name || '';
          const clean = cleanStyleName(rawName, ws);
          if (clean && clean.toLowerCase() !== targetStyleName.toLowerCase()) {
            const sWs = typeof s === 'object' && s?.workspace ? s.workspace : ws || undefined;
            remainingAltList.push({
              name: clean,
              ...(sWs ? { workspace: sWs } : {}),
            });
          }
        }

        // If target style is the layer's defaultStyle:
        let newDefaultPayload = defObj;
        if (isDefault) {
          // If there are alternate styles, promote the first remaining alternate style to default!
          if (remainingAltList.length > 0) {
            const promoted = remainingAltList.shift();
            newDefaultPayload = promoted;
            newDefaultStyleName = promoted.name;
          } else {
            // No other styles exist for this layer!
            return NextResponse.json(
              {
                error: `Cannot delete "${targetStyleName}" because it is the only style assigned to layer "${layerParam || shortLayerName}". GeoServer requires at least one style per layer.`,
              },
              { status: 400 }
            );
          }
        } else {
          // Style was not default, so keep existing default cleaned of href
          newDefaultPayload = {
            name: currentDefName,
            ...(defObj?.workspace ? { workspace: defObj.workspace } : ws ? { workspace: ws } : {}),
          };
          newDefaultStyleName = currentDefName;
        }

        // Update the layer in GeoServer to remove the style reference
        const updateLayerPayload: any = {
          layer: {
            defaultStyle: newDefaultPayload,
            styles: remainingAltList.length > 0 ? { style: remainingAltList } : '',
          },
        };

        const putLayerUrl = matchedLayerUrl.replace(/\.json$/, '');
        try {
          const unlinkRes = await fetch(putLayerUrl, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
              Authorization: geoserverAuth,
            },
            body: JSON.stringify(updateLayerPayload),
          });

          if (!unlinkRes.ok) {
            const errText = await unlinkRes.text();
            console.warn('Failed to unlink style from layer before deletion:', errText);
            return NextResponse.json(
              { error: `Could not unlink style from layer in GeoServer: ${errText || unlinkRes.statusText}` },
              { status: unlinkRes.status }
            );
          }
        } catch (unlinkErr: any) {
          console.warn('Error unlinking style from layer:', unlinkErr);
          return NextResponse.json(
            { error: `Network error unlinking style from layer: ${unlinkErr?.message}` },
            { status: 500 }
          );
        }
      }
    }

    // Step 2: Delete style from GeoServer catalog
    // Try workspace-specific style first, then global style
    const deleteUrls: string[] = [];
    if (ws) {
      deleteUrls.push(
        `${geoserverBase}/rest/workspaces/${encodeURIComponent(ws)}/styles/${encodeURIComponent(targetStyleName)}?recurse=true`
      );
    }
    deleteUrls.push(`${geoserverBase}/rest/styles/${encodeURIComponent(targetStyleName)}?recurse=true`);

    let deleteSuccess = false;
    let lastError = '';

    for (const dUrl of deleteUrls) {
      try {
        const delRes = await fetch(dUrl, {
          method: 'DELETE',
          headers: {
            Authorization: geoserverAuth,
          },
        });

        if (delRes.ok || delRes.status === 200 || delRes.status === 204) {
          deleteSuccess = true;
          break;
        } else if (delRes.status === 404) {
          // Style not found in this specific workspace endpoint, continue to next
          continue;
        } else {
          lastError = await delRes.text();
        }
      } catch (err: any) {
        lastError = err?.message || 'Network error';
      }
    }

    if (!deleteSuccess && lastError) {
      return NextResponse.json(
        {
          error: `GeoServer could not delete style "${targetStyleName}": ${lastError}`,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Style "${targetStyleName}" successfully deleted from GeoServer`,
      deletedStyle: targetStyleName,
      newDefaultStyle: newDefaultStyleName,
    });
  } catch (err: any) {
    console.error('GeoServer Delete Style Error:', err);
    return NextResponse.json(
      { error: err?.message || 'Failed to delete style from GeoServer' },
      { status: 500 }
    );
  }
}
