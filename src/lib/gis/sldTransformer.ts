// ============================================================================
// OGC SLD 1.0.0 / 1.1.0 Bidirectional Transformer
//
// Converts between VistaBridge's visual JSON StyleConfig and standard OGC SLD
// XML format compatible with GeoServer WMS, REST API, and QGIS.
// ============================================================================

export interface StyleConfig {
  mode?: 'single' | 'categorized' | 'graduated' | 'single_band' | 'multiband';
  strokeColor?: string;
  strokeWidth?: number;
  strokeOpacity?: number;
  lineDash?: string;
  fillColor?: string;
  fillOpacity?: number;
  pointIcon?: 'circle' | 'square' | 'star' | 'marker' | 'flag' | string;
  pointSize?: number;
  // Categorized
  categorizeField?: string;
  categoryRules?: Array<{ value: string; color: string; label?: string }>;
  // Graduated
  graduatedField?: string;
  graduatedMinVal?: number;
  graduatedMaxVal?: number;
  graduatedColorStart?: string;
  graduatedColorEnd?: string;
  graduatedClasses?: number;
  // Labeling
  labelField?: string;
  labelSize?: number;
  labelColor?: string;
  labelOutlineColor?: string;
  labelOutlineWidth?: number;
  labelRepeat?: 'once' | 'repeat';
  labelRepeatSpacing?: number;
  labelOffsetX?: number;
  labelOffsetY?: number;
  labelAlign?: 'left' | 'center' | 'right';
  labelBaseline?: 'top' | 'middle' | 'bottom';
  // Raster
  band?: string;
  colormapName?: string;
  rescaleMin?: number;
  rescaleMax?: number;
  redBand?: string;
  greenBand?: string;
  blueBand?: string;
  rasterOpacity?: number;
}

/**
 * Converts a hex color and fraction to RGBA string or hex with opacity
 */
function escapeXml(unsafe: string): string {
  return (unsafe || '').replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '&':
        return '&amp;';
      case '\'':
        return '&apos;';
      case '"':
        return '&quot;';
      default:
        return c;
    }
  });
}

function interpolateColor(color1: string, color2: string, factor: number): string {
  const hex = (c: string) => parseInt(c, 16);
  const c1 = color1.replace('#', '');
  const c2 = color2.replace('#', '');
  const r1 = hex(c1.substring(0, 2)),
    g1 = hex(c1.substring(2, 4)),
    b1 = hex(c1.substring(4, 6));
  const r2 = hex(c2.substring(0, 2)),
    g2 = hex(c2.substring(2, 4)),
    b2 = hex(c2.substring(4, 6));

  const r = Math.round(r1 + factor * (r2 - r1));
  const g = Math.round(g1 + factor * (g2 - g1));
  const b = Math.round(b1 + factor * (b2 - b1));

  return (
    '#' +
    [r, g, b]
      .map((x) => {
        const h = Math.max(0, Math.min(255, x)).toString(16);
        return h.length === 1 ? '0' + h : h;
      })
      .join('')
  );
}

/**
 * Builds standard XML for TextSymbolizer (labels)
 */
function buildTextSymbolizer(config: StyleConfig, isLine = false): string {
  if (!config.labelField) return '';

  const labelField = escapeXml(config.labelField);
  const fontSize = config.labelSize || 12;
  const fontColor = config.labelColor || '#000000';
  const haloColor = config.labelOutlineColor || '#ffffff';
  const haloRadius = config.labelOutlineWidth ?? 2;

  let placementXml = '';
  if (isLine) {
    const repeatParam =
      config.labelRepeat === 'repeat'
        ? `<VendorOption name="repeat">${config.labelRepeatSpacing || 300}</VendorOption>`
        : '';
    placementXml = `
      <LinePlacement>
        <PerpendicularOffset>${config.labelOffsetY || 0}</PerpendicularOffset>
      </LinePlacement>
      <VendorOption name="followLine">true</VendorOption>
      ${repeatParam}
    `;
  } else {
    // Point or Polygon placement
    const alignX = config.labelAlign === 'left' ? 0 : config.labelAlign === 'right' ? 1 : 0.5;
    const alignY = config.labelBaseline === 'bottom' ? 0 : config.labelBaseline === 'top' ? 1 : 0.5;
    placementXml = `
      <PointPlacement>
        <AnchorPoint>
          <AnchorPointX>${alignX}</AnchorPointX>
          <AnchorPointY>${alignY}</AnchorPointY>
        </AnchorPoint>
        <Displacement>
          <DisplacementX>${config.labelOffsetX || 0}</DisplacementX>
          <DisplacementY>${config.labelOffsetY || 0}</DisplacementY>
        </Displacement>
      </PointPlacement>
    `;
  }

  return `
    <TextSymbolizer>
      <Label>
        <ogc:PropertyName>${labelField}</ogc:PropertyName>
      </Label>
      <Font>
        <CssParameter name="font-family">SansSerif</CssParameter>
        <CssParameter name="font-size">${fontSize}</CssParameter>
        <CssParameter name="font-style">normal</CssParameter>
        <CssParameter name="font-weight">normal</CssParameter>
      </Font>
      <LabelPlacement>
        ${placementXml}
      </LabelPlacement>
      <Halo>
        <Radius>${haloRadius}</Radius>
        <Fill>
          <CssParameter name="fill">${haloColor}</CssParameter>
        </Fill>
      </Halo>
      <Fill>
        <CssParameter name="fill">${fontColor}</CssParameter>
      </Fill>
      <VendorOption name="autoWrap">60</VendorOption>
      <VendorOption name="maxDisplacement">50</VendorOption>
    </TextSymbolizer>
  `;
}

/**
 * Builds PointSymbolizer XML
 */
function buildPointSymbolizer(config: StyleConfig, fillColorOverride?: string): string {
  const wellKnownMap: Record<string, string> = {
    circle: 'circle',
    square: 'square',
    star: 'star',
    marker: 'triangle',
    flag: 'cross',
  };
  const markName = wellKnownMap[config.pointIcon || 'circle'] || 'circle';
  const size = config.pointSize || 8;
  const fillColor = fillColorOverride || config.fillColor || '#ff4d4f';
  const fillOpacity = config.fillOpacity ?? 0.8;
  const strokeColor = config.strokeColor || '#333333';
  const strokeWidth = config.strokeWidth ?? 1;
  const strokeOpacity = config.strokeOpacity ?? 1;

  return `
    <PointSymbolizer>
      <Graphic>
        <Mark>
          <WellKnownName>${markName}</WellKnownName>
          <Fill>
            <CssParameter name="fill">${fillColor}</CssParameter>
            <CssParameter name="fill-opacity">${fillOpacity}</CssParameter>
          </Fill>
          <Stroke>
            <CssParameter name="stroke">${strokeColor}</CssParameter>
            <CssParameter name="stroke-width">${strokeWidth}</CssParameter>
            <CssParameter name="stroke-opacity">${strokeOpacity}</CssParameter>
          </Stroke>
        </Mark>
        <Size>${size}</Size>
      </Graphic>
    </PointSymbolizer>
  `;
}

/**
 * Builds LineSymbolizer XML
 */
function buildLineSymbolizer(config: StyleConfig, strokeColorOverride?: string): string {
  const strokeColor = strokeColorOverride || config.strokeColor || '#ff4d4f';
  const strokeWidth = config.strokeWidth ?? 1.5;
  const strokeOpacity = config.strokeOpacity ?? 1;
  const dashArray = config.lineDash
    ? `<CssParameter name="stroke-dasharray">${config.lineDash}</CssParameter>`
    : '';

  return `
    <LineSymbolizer>
      <Stroke>
        <CssParameter name="stroke">${strokeColor}</CssParameter>
        <CssParameter name="stroke-width">${strokeWidth}</CssParameter>
        <CssParameter name="stroke-opacity">${strokeOpacity}</CssParameter>
        ${dashArray}
      </Stroke>
    </LineSymbolizer>
  `;
}

/**
 * Builds PolygonSymbolizer XML
 */
function buildPolygonSymbolizer(config: StyleConfig, fillColorOverride?: string): string {
  const fillColor = fillColorOverride || config.fillColor || '#ff4d4f';
  const fillOpacity = config.fillOpacity ?? 0.2;
  const strokeColor = config.strokeColor || '#ff4d4f';
  const strokeWidth = config.strokeWidth ?? 1.5;
  const strokeOpacity = config.strokeOpacity ?? 1;
  const dashArray = config.lineDash
    ? `<CssParameter name="stroke-dasharray">${config.lineDash}</CssParameter>`
    : '';

  return `
    <PolygonSymbolizer>
      <Fill>
        <CssParameter name="fill">${fillColor}</CssParameter>
        <CssParameter name="fill-opacity">${fillOpacity}</CssParameter>
      </Fill>
      <Stroke>
        <CssParameter name="stroke">${strokeColor}</CssParameter>
        <CssParameter name="stroke-width">${strokeWidth}</CssParameter>
        <CssParameter name="stroke-opacity">${strokeOpacity}</CssParameter>
        ${dashArray}
      </Stroke>
    </PolygonSymbolizer>
  `;
}

/**
 * Serializes StyleConfig into OGC SLD 1.0.0 XML
 */
export function styleConfigToSld(
  config: StyleConfig,
  layerName: string,
  geometryType?: string | null
): string {
  const safeLayerName = escapeXml(layerName || 'layer');
  const geom = (geometryType || '').toLowerCase();
  const isPoint = geom.includes('point');
  const isLine = geom.includes('line') || geom.includes('string');
  const isRaster = config.mode === 'single_band' || config.mode === 'multiband' || geom === 'raster';

  let rulesXml = '';

  if (isRaster) {
    const opacityVal = config.rasterOpacity ?? config.fillOpacity ?? 1.0;
    const opacityXml = `<Opacity>${Number(opacityVal).toFixed(2)}</Opacity>`;

    if (config.mode === 'multiband') {
      const red = (config.redBand || '1').replace(/^band_/, '');
      const green = (config.greenBand || '2').replace(/^band_/, '');
      const blue = (config.blueBand || '3').replace(/^band_/, '');

      rulesXml = `
        <Rule>
          <Name>RGB Composite</Name>
          <Title>Multi-band RGB Composite</Title>
          <RasterSymbolizer>
            ${opacityXml}
            <ChannelSelection>
              <RedChannel>
                <SourceChannelName>${escapeXml(red)}</SourceChannelName>
              </RedChannel>
              <GreenChannel>
                <SourceChannelName>${escapeXml(green)}</SourceChannelName>
              </GreenChannel>
              <BlueChannel>
                <SourceChannelName>${escapeXml(blue)}</SourceChannelName>
              </BlueChannel>
            </ChannelSelection>
          </RasterSymbolizer>
        </Rule>
      `;
    } else {
      // Single band (DEM / Elevation / Grayscale / Color Ramp)
      const bandName = config.band ? config.band.replace(/^band_/, '') : '';
      const channelXml = bandName ? `
            <ChannelSelection>
              <GrayChannel>
                <SourceChannelName>${escapeXml(bandName)}</SourceChannelName>
              </GrayChannel>
            </ChannelSelection>` : '';

      const minVal = config.rescaleMin ?? 0;
      const maxVal = config.rescaleMax ?? 255;
      const diff = maxVal - minVal || 1;

      let colormapEntries = '';
      if (config.colormapName === 'terrain') {
        colormapEntries = `
              <ColorMapEntry color="#0000ff" quantity="${minVal}" opacity="0" label="Water" />
              <ColorMapEntry color="#00ff00" quantity="${(minVal + diff * 0.25).toFixed(2)}" label="Lowland" />
              <ColorMapEntry color="#ffff00" quantity="${(minVal + diff * 0.5).toFixed(2)}" label="Midland" />
              <ColorMapEntry color="#ff7f00" quantity="${(minVal + diff * 0.75).toFixed(2)}" label="Upland" />
              <ColorMapEntry color="#ffffff" quantity="${maxVal}" label="Peak" />
        `;
      } else if (config.colormapName === 'viridis') {
        colormapEntries = `
              <ColorMapEntry color="#440154" quantity="${minVal}" label="${minVal}" />
              <ColorMapEntry color="#3b528b" quantity="${(minVal + diff * 0.25).toFixed(2)}" />
              <ColorMapEntry color="#21918c" quantity="${(minVal + diff * 0.5).toFixed(2)}" />
              <ColorMapEntry color="#5ec962" quantity="${(minVal + diff * 0.75).toFixed(2)}" />
              <ColorMapEntry color="#fde725" quantity="${maxVal}" label="${maxVal}" />
        `;
      } else if (config.colormapName === 'rainbow') {
        colormapEntries = `
              <ColorMapEntry color="#0000ff" quantity="${minVal}" label="${minVal}" />
              <ColorMapEntry color="#00ffff" quantity="${(minVal + diff * 0.25).toFixed(2)}" />
              <ColorMapEntry color="#00ff00" quantity="${(minVal + diff * 0.5).toFixed(2)}" />
              <ColorMapEntry color="#ffff00" quantity="${(minVal + diff * 0.75).toFixed(2)}" />
              <ColorMapEntry color="#ff0000" quantity="${maxVal}" label="${maxVal}" />
        `;
      } else if (config.colormapName === 'plasma') {
        colormapEntries = `
              <ColorMapEntry color="#0d0887" quantity="${minVal}" label="${minVal}" />
              <ColorMapEntry color="#6a00a8" quantity="${(minVal + diff * 0.2).toFixed(2)}" />
              <ColorMapEntry color="#b12a90" quantity="${(minVal + diff * 0.4).toFixed(2)}" />
              <ColorMapEntry color="#e16462" quantity="${(minVal + diff * 0.6).toFixed(2)}" />
              <ColorMapEntry color="#fca636" quantity="${(minVal + diff * 0.8).toFixed(2)}" />
              <ColorMapEntry color="#f0f921" quantity="${maxVal}" label="${maxVal}" />
        `;
      } else if (config.colormapName === 'magma') {
        colormapEntries = `
              <ColorMapEntry color="#000004" quantity="${minVal}" label="${minVal}" />
              <ColorMapEntry color="#3b0f70" quantity="${(minVal + diff * 0.25).toFixed(2)}" />
              <ColorMapEntry color="#8c2981" quantity="${(minVal + diff * 0.5).toFixed(2)}" />
              <ColorMapEntry color="#de4968" quantity="${(minVal + diff * 0.75).toFixed(2)}" />
              <ColorMapEntry color="#fcfdbf" quantity="${maxVal}" label="${maxVal}" />
        `;
      } else if (config.colormapName === 'inferno') {
        colormapEntries = `
              <ColorMapEntry color="#000004" quantity="${minVal}" label="${minVal}" />
              <ColorMapEntry color="#420a68" quantity="${(minVal + diff * 0.25).toFixed(2)}" />
              <ColorMapEntry color="#932667" quantity="${(minVal + diff * 0.5).toFixed(2)}" />
              <ColorMapEntry color="#dd513a" quantity="${(minVal + diff * 0.75).toFixed(2)}" />
              <ColorMapEntry color="#fcffa4" quantity="${maxVal}" label="${maxVal}" />
        `;
      } else if (config.colormapName === 'cividis') {
        colormapEntries = `
              <ColorMapEntry color="#00204d" quantity="${minVal}" label="${minVal}" />
              <ColorMapEntry color="#414d6b" quantity="${(minVal + diff * 0.25).toFixed(2)}" />
              <ColorMapEntry color="#7c7b78" quantity="${(minVal + diff * 0.5).toFixed(2)}" />
              <ColorMapEntry color="#bcab6f" quantity="${(minVal + diff * 0.75).toFixed(2)}" />
              <ColorMapEntry color="#ffea46" quantity="${maxVal}" label="${maxVal}" />
        `;
      } else {
        // Grayscale default
        colormapEntries = `
              <ColorMapEntry color="#000000" quantity="${minVal}" label="${minVal}" />
              <ColorMapEntry color="#ffffff" quantity="${maxVal}" label="${maxVal}" />
        `;
      }

      rulesXml = `
        <Rule>
          <Name>Raster Style</Name>
          <Title>Raster Classification</Title>
          <RasterSymbolizer>
            ${opacityXml}${channelXml}
            <ColorMap type="ramp">
${colormapEntries}
            </ColorMap>
          </RasterSymbolizer>
        </Rule>
      `;
    }
  } else if (config.mode === 'categorized' && config.categorizeField && config.categoryRules?.length) {
    // Categorized / Unique values
    const fieldName = escapeXml(config.categorizeField);
    rulesXml = config.categoryRules
      .map((rule) => {
        const val = escapeXml(rule.value);
        const symbolizer = isPoint
          ? buildPointSymbolizer(config, rule.color)
          : isLine
          ? buildLineSymbolizer(config, rule.color)
          : buildPolygonSymbolizer(config, rule.color);

        return `
        <Rule>
          <Name>${val || 'default'}</Name>
          <Title>${escapeXml(rule.label || val)}</Title>
          <ogc:Filter>
            <ogc:PropertyIsEqualTo>
              <ogc:PropertyName>${fieldName}</ogc:PropertyName>
              <ogc:Literal>${val}</ogc:Literal>
            </ogc:PropertyIsEqualTo>
          </ogc:Filter>
          ${symbolizer}
        </Rule>
      `;
      })
      .join('\n');
  } else if (config.mode === 'graduated' && config.graduatedField) {
    // Graduated / Numeric classification
    const fieldName = escapeXml(config.graduatedField);
    const minVal = config.graduatedMinVal ?? 0;
    const maxVal = config.graduatedMaxVal ?? 100;
    const startColor = config.graduatedColorStart || '#fee8c8';
    const endColor = config.graduatedColorEnd || '#e34a33';
    const numClasses = config.graduatedClasses || 5;
    const step = (maxVal - minVal) / numClasses;

    const classRules = [];
    for (let i = 0; i < numClasses; i++) {
      const lower = minVal + i * step;
      const upper = i === numClasses - 1 ? maxVal : minVal + (i + 1) * step;
      const color = interpolateColor(startColor, endColor, i / Math.max(1, numClasses - 1));

      const symbolizer = isPoint
        ? buildPointSymbolizer(config, color)
        : isLine
        ? buildLineSymbolizer(config, color)
        : buildPolygonSymbolizer(config, color);

      classRules.push(`
        <Rule>
          <Name>Class ${i + 1}</Name>
          <Title>${lower.toFixed(1)} - ${upper.toFixed(1)}</Title>
          <ogc:Filter>
            <ogc:PropertyIsBetween>
              <ogc:PropertyName>${fieldName}</ogc:PropertyName>
              <ogc:LowerBoundary><ogc:Literal>${lower}</ogc:Literal></ogc:LowerBoundary>
              <ogc:UpperBoundary><ogc:Literal>${upper}</ogc:Literal></ogc:UpperBoundary>
            </ogc:PropertyIsBetween>
          </ogc:Filter>
          ${symbolizer}
        </Rule>
      `);
    }
    rulesXml = classRules.join('\n');
  } else {
    // Single Symbol mode (default)
    const baseSymbolizer = isPoint
      ? buildPointSymbolizer(config)
      : isLine
      ? buildLineSymbolizer(config)
      : buildPolygonSymbolizer(config);

    const textSymbolizer = buildTextSymbolizer(config, isLine);

    rulesXml = `
      <Rule>
        <Name>Default Rule</Name>
        <Title>Standard Layer Symbology</Title>
        ${baseSymbolizer}
        ${textSymbolizer}
      </Rule>
    `;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<StyledLayerDescriptor version="1.0.0" 
  xsi:schemaLocation="http://www.opengis.net/sld StyledLayerDescriptor.xsd" 
  xmlns="http://www.opengis.net/sld" 
  xmlns:ogc="http://www.opengis.net/ogc" 
  xmlns:xlink="http://www.w3.org/1999/xlink" 
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <NamedLayer>
    <Name>${safeLayerName}</Name>
    <UserStyle>
      <Title>${safeLayerName} Style</Title>
      <Abstract>Generated by VistaBridge GeoStyler</Abstract>
      <FeatureTypeStyle>
        ${rulesXml}
      </FeatureTypeStyle>
    </UserStyle>
  </NamedLayer>
</StyledLayerDescriptor>`;
}

/**
 * Parses an SLD XML string into a partial StyleConfig object.
 * Safe for both browser DOMParser and fallback XML regex.
 * Namespace-agnostic: matches sld:, se:, ogc: or un-prefixed tags.
 */
export function sldToStyleConfig(sldXml: string): Partial<StyleConfig> {
  const config: Partial<StyleConfig> = {};
  if (!sldXml || typeof sldXml !== 'string') return config;

  function findNode(parent: Document | Element, localName: string): Element | null {
    const lower = localName.toLowerCase();
    const elements = parent.getElementsByTagName('*');
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      const name = (el.localName || el.nodeName.split(':').pop() || '').toLowerCase();
      if (name === lower) return el;
    }
    return null;
  }

  function findCssParam(parent: Element, paramName: string): string | null {
    const lowerParam = paramName.toLowerCase();
    const elements = parent.getElementsByTagName('*');
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      const local = (el.localName || el.nodeName.split(':').pop() || '').toLowerCase();
      if (local === 'cssparameter' || local === 'svgparameter') {
        const nameAttr = el.getAttribute('name');
        if (nameAttr && nameAttr.toLowerCase() === lowerParam) {
          return el.textContent?.trim() || null;
        }
      }
    }
    return null;
  }

  function extractParamRegex(xml: string, paramName: string): string | null {
    const regex = new RegExp(`<(?:[a-zA-Z0-9_-]+:)?(?:CssParameter|SvgParameter)[^>]*name=["']${paramName}["'][^>]*>([^<]+)<`, 'i');
    const match = xml.match(regex);
    return match ? match[1].trim() : null;
  }

  try {
    if (typeof window !== 'undefined' && window.DOMParser) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(sldXml, 'application/xml');

      // 0. RasterSymbolizer
      const raster = findNode(doc, 'RasterSymbolizer');
      if (raster) {
        const op = findNode(raster, 'Opacity')?.textContent?.trim();
        if (op) {
          const parsedOp = parseFloat(op);
          if (!isNaN(parsedOp)) {
            config.rasterOpacity = parsedOp;
            config.fillOpacity = parsedOp;
          }
        }

        const channelSelection = findNode(raster, 'ChannelSelection');
        const redChan = channelSelection ? findNode(channelSelection, 'RedChannel') : null;
        const greenChan = channelSelection ? findNode(channelSelection, 'GreenChannel') : null;
        const blueChan = channelSelection ? findNode(channelSelection, 'BlueChannel') : null;
        const grayChan = channelSelection ? findNode(channelSelection, 'GrayChannel') : null;

        if (redChan || greenChan || blueChan) {
          config.mode = 'multiband';
          const rName = redChan ? findNode(redChan, 'SourceChannelName')?.textContent?.trim() : '';
          const gName = greenChan ? findNode(greenChan, 'SourceChannelName')?.textContent?.trim() : '';
          const bName = blueChan ? findNode(blueChan, 'SourceChannelName')?.textContent?.trim() : '';

          if (rName) config.redBand = rName.startsWith('band_') ? rName : `band_${rName}`;
          if (gName) config.greenBand = gName.startsWith('band_') ? gName : `band_${gName}`;
          if (bName) config.blueBand = bName.startsWith('band_') ? bName : `band_${bName}`;
        } else {
          config.mode = 'single_band';
          if (grayChan) {
            const grayName = findNode(grayChan, 'SourceChannelName')?.textContent?.trim();
            if (grayName) config.band = grayName.startsWith('band_') ? grayName : `band_${grayName}`;
          }

          const colorMap = findNode(raster, 'ColorMap');
          if (colorMap) {
            const entries = Array.from(colorMap.getElementsByTagName('*')).filter((el) => {
              const name = (el.localName || el.nodeName.split(':').pop() || '').toLowerCase();
              return name === 'colormapentry';
            });

            if (entries.length > 0) {
              const quantities: number[] = [];
              const colors: string[] = [];
              entries.forEach((entry) => {
                const q = entry.getAttribute('quantity');
                const c = entry.getAttribute('color');
                if (q !== null && !isNaN(parseFloat(q))) quantities.push(parseFloat(q));
                if (c) colors.push(c.toLowerCase());
              });

              if (quantities.length > 0) {
                config.rescaleMin = Math.min(...quantities);
                config.rescaleMax = Math.max(...quantities);
              }

              if (colors.includes('#0000ff') && colors.includes('#00ff00') && colors.includes('#ffff00')) {
                config.colormapName = 'terrain';
              } else if (colors.includes('#440154') || colors.includes('#21918c')) {
                config.colormapName = 'viridis';
              } else if (colors.includes('#0000ff') && colors.includes('#00ffff') && colors.includes('#ff0000')) {
                config.colormapName = 'rainbow';
              } else if (colors.includes('#0d0887')) {
                config.colormapName = 'plasma';
              } else if (colors.includes('#3b0f70')) {
                config.colormapName = 'magma';
              } else if (colors.includes('#420a68')) {
                config.colormapName = 'inferno';
              } else if (colors.includes('#00204d')) {
                config.colormapName = 'cividis';
              } else {
                config.colormapName = 'gray';
              }
            }
          }
        }
      }

      // 1. PolygonSymbolizer
      const poly = findNode(doc, 'PolygonSymbolizer');
      if (poly) {
        const fill = findCssParam(poly, 'fill');
        if (fill) config.fillColor = fill;

        const fillOp = findCssParam(poly, 'fill-opacity');
        if (fillOp) config.fillOpacity = parseFloat(fillOp);

        const stroke = findCssParam(poly, 'stroke');
        if (stroke) config.strokeColor = stroke;

        const strokeWidth = findCssParam(poly, 'stroke-width');
        if (strokeWidth) config.strokeWidth = parseFloat(strokeWidth);

        const strokeOp = findCssParam(poly, 'stroke-opacity');
        if (strokeOp) config.strokeOpacity = parseFloat(strokeOp);

        const dash = findCssParam(poly, 'stroke-dasharray');
        config.lineDash = dash || '';
      }

      // 2. LineSymbolizer
      const line = findNode(doc, 'LineSymbolizer');
      if (line) {
        const stroke = findCssParam(line, 'stroke');
        if (stroke) config.strokeColor = stroke;

        const strokeWidth = findCssParam(line, 'stroke-width');
        if (strokeWidth) config.strokeWidth = parseFloat(strokeWidth);

        const strokeOp = findCssParam(line, 'stroke-opacity');
        if (strokeOp) config.strokeOpacity = parseFloat(strokeOp);

        const dash = findCssParam(line, 'stroke-dasharray');
        config.lineDash = dash || '';
      }

      // 3. PointSymbolizer
      const point = findNode(doc, 'PointSymbolizer');
      if (point) {
        const mark = findNode(point, 'WellKnownName');
        if (mark?.textContent) {
          const m = mark.textContent.trim().toLowerCase();
          config.pointIcon = m === 'triangle' ? 'marker' : m === 'cross' ? 'flag' : m;
        }

        const size = findNode(point, 'Size');
        if (size?.textContent) config.pointSize = parseFloat(size.textContent.trim());

        const fill = findCssParam(point, 'fill');
        if (fill) config.fillColor = fill;
      }

      // 4. TextSymbolizer (Labels)
      const text = findNode(doc, 'TextSymbolizer');
      if (text) {
        const prop = findNode(text, 'PropertyName');
        if (prop?.textContent) config.labelField = prop.textContent.trim();

        const fontSize = findCssParam(text, 'font-size');
        if (fontSize) config.labelSize = parseFloat(fontSize);

        const fill = findCssParam(text, 'fill');
        if (fill) config.labelColor = fill;

        const halo = findNode(text, 'Halo');
        if (halo) {
          const haloFill = findCssParam(halo, 'fill');
          if (haloFill) config.labelOutlineColor = haloFill;

          const haloRadius = findNode(halo, 'Radius');
          if (haloRadius?.textContent) config.labelOutlineWidth = parseFloat(haloRadius.textContent.trim());
        }

        const followLine = text.querySelector ? text.querySelector('VendorOption[name="followLine"]') : null;
        if (followLine?.textContent?.trim() === 'true') {
          config.labelRepeat = 'repeat';
        }
      }

      // 5. Mode assignment (if not already set by RasterSymbolizer)
      if (!config.mode) {
        const isBetween = findNode(doc, 'PropertyIsBetween');
        const isEqualTo = findNode(doc, 'PropertyIsEqualTo');
        if (isBetween) {
          config.mode = 'graduated';
          const field = findNode(isBetween, 'PropertyName')?.textContent?.trim();
          if (field) config.graduatedField = field;
        } else if (isEqualTo) {
          config.mode = 'categorized';
          const field = findNode(isEqualTo, 'PropertyName')?.textContent?.trim();
          if (field) config.categorizeField = field;
        } else {
          config.mode = 'single';
        }
      }
    } else {
      // Regex fallback (e.g. Node.js or when DOMParser is unavailable)
      const hasRaster = /<(?:[a-zA-Z0-9_-]+:)?RasterSymbolizer\b/i.test(sldXml);
      if (hasRaster) {
        const hasChannelSelection = /<(?:[a-zA-Z0-9_-]+:)?(?:RedChannel|GreenChannel|BlueChannel)\b/i.test(sldXml);
        if (hasChannelSelection) {
          config.mode = 'multiband';
          const redMatch = sldXml.match(/<(?:[a-zA-Z0-9_-]+:)?RedChannel>[\s\S]*?<(?:[a-zA-Z0-9_-]+:)?SourceChannelName>([^<]+)</i);
          const greenMatch = sldXml.match(/<(?:[a-zA-Z0-9_-]+:)?GreenChannel>[\s\S]*?<(?:[a-zA-Z0-9_-]+:)?SourceChannelName>([^<]+)</i);
          const blueMatch = sldXml.match(/<(?:[a-zA-Z0-9_-]+:)?BlueChannel>[\s\S]*?<(?:[a-zA-Z0-9_-]+:)?SourceChannelName>([^<]+)</i);
          if (redMatch) config.redBand = redMatch[1].trim().startsWith('band_') ? redMatch[1].trim() : `band_${redMatch[1].trim()}`;
          if (greenMatch) config.greenBand = greenMatch[1].trim().startsWith('band_') ? greenMatch[1].trim() : `band_${greenMatch[1].trim()}`;
          if (blueMatch) config.blueBand = blueMatch[1].trim().startsWith('band_') ? blueMatch[1].trim() : `band_${blueMatch[1].trim()}`;
        } else {
          config.mode = 'single_band';
          const grayMatch = sldXml.match(/<(?:[a-zA-Z0-9_-]+:)?GrayChannel>[\s\S]*?<(?:[a-zA-Z0-9_-]+:)?SourceChannelName>([^<]+)</i);
          if (grayMatch) config.band = grayMatch[1].trim().startsWith('band_') ? grayMatch[1].trim() : `band_${grayMatch[1].trim()}`;

          if (/quantity=["']([0-9.]+)["']/i.test(sldXml)) {
            const quantities = Array.from(sldXml.matchAll(/quantity=["']([0-9.-]+)["']/gi)).map((m) => parseFloat(m[1])).filter((n) => !isNaN(n));
            if (quantities.length > 0) {
              config.rescaleMin = Math.min(...quantities);
              config.rescaleMax = Math.max(...quantities);
            }
          }
          if (/#0000ff/i.test(sldXml) && /#00ff00/i.test(sldXml)) config.colormapName = 'terrain';
          else if (/#440154/i.test(sldXml)) config.colormapName = 'viridis';
          else if (/#00ffff/i.test(sldXml) && /#ff0000/i.test(sldXml)) config.colormapName = 'rainbow';
          else if (/#0d0887/i.test(sldXml)) config.colormapName = 'plasma';
          else if (/#3b0f70/i.test(sldXml)) config.colormapName = 'magma';
          else if (/#420a68/i.test(sldXml)) config.colormapName = 'inferno';
          else if (/#00204d/i.test(sldXml)) config.colormapName = 'cividis';
          else config.colormapName = 'gray';
        }

        const opacityMatch = sldXml.match(/<(?:[a-zA-Z0-9_-]+:)?Opacity>([^<]+)</i);
        if (opacityMatch) {
          const op = parseFloat(opacityMatch[1].trim());
          if (!isNaN(op)) {
            config.rasterOpacity = op;
            config.fillOpacity = op;
          }
        }
      }
      const stroke = extractParamRegex(sldXml, 'stroke');
      if (stroke) config.strokeColor = stroke;

      const strokeWidth = extractParamRegex(sldXml, 'stroke-width');
      if (strokeWidth) config.strokeWidth = parseFloat(strokeWidth);

      const strokeOp = extractParamRegex(sldXml, 'stroke-opacity');
      if (strokeOp) config.strokeOpacity = parseFloat(strokeOp);

      const dash = extractParamRegex(sldXml, 'stroke-dasharray');
      config.lineDash = dash || '';

      const fill = extractParamRegex(sldXml, 'fill');
      if (fill) config.fillColor = fill;

      const fillOp = extractParamRegex(sldXml, 'fill-opacity');
      if (fillOp) config.fillOpacity = parseFloat(fillOp);

      const wellKnown = sldXml.match(/<(?:[a-zA-Z0-9_-]+:)?WellKnownName>([^<]+)</i);
      if (wellKnown) config.pointIcon = wellKnown[1].trim().toLowerCase();

      const size = sldXml.match(/<(?:[a-zA-Z0-9_-]+:)?Size>([^<]+)</i);
      if (size) config.pointSize = parseFloat(size[1].trim());

      const prop = sldXml.match(/<(?:[a-zA-Z0-9_-]+:)?PropertyName>([^<]+)</i);
      if (prop) config.labelField = prop[1].trim();
    }
  } catch (err) {
    console.warn('Failed to parse SLD XML into StyleConfig:', err);
  }

  return config;
}
