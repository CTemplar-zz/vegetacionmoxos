"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl, { type Map as MapLibreMap } from "maplibre-gl";
import { feature as topojsonFeature } from "topojson-client";
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChevronDown,
  Droplets,
  Layers3,
  Leaf,
  LocateFixed,
  Search,
  X,
} from "lucide-react";
import "maplibre-gl/dist/maplibre-gl.css";

type ThemeMode = "vegetation" | "segments";

type AnnualValue = {
  year: number;
  permanenceDays: number | null;
  frequencyPct: number | null;
};

type VegetationClass = {
  id: string;
  description: string;
  areaKm2: number;
  series: number[];
  annual: AnnualValue[];
  longTerm: { permanenceDays: number | null; frequencyPct: number | null };
  maximumFloodedKm2: number;
  meanFloodedKm2: number;
};

type TimeSeriesData = {
  dates: string[];
  years: number[];
  summary: {
    classCount: number;
    observationCount: number;
    dateStart: string;
    dateEnd: string;
    totalAreaKm2: number;
  };
  classes: Record<string, VegetationClass>;
};

type SymbolData = {
  vegetation: {
    field: string;
    classes: Record<string, { label: string; color: string; outline: string }>;
  };
  segments: {
    field: string;
    lowerBound: number;
    breaks: Array<{ label: string; upper: number; color: string; outline: string }>;
  };
  extents: Record<string, [[number, number], [number, number]]>;
};

type GeoFeature = {
  type: "Feature";
  properties: Record<string, string | number | null>;
  geometry: { type: string; coordinates: unknown };
};

type GeoFeatureCollection = {
  type: "FeatureCollection";
  features: GeoFeature[];
};

const BOUNDS: [[number, number], [number, number]] = [
  [-67.6152, -16.3093],
  [-61.5452, -10.394],
];

const compact = new Intl.NumberFormat("es-BO", { maximumFractionDigits: 1 });
const detailed = new Intl.NumberFormat("es-BO", { maximumFractionDigits: 2 });

function topologyToFeatures(topology: Record<string, unknown>): GeoFeatureCollection {
  const objects = topology.objects as Record<string, unknown>;
  const object = objects[Object.keys(objects)[0]];
  return topojsonFeature(topology as never, object as never) as unknown as GeoFeatureCollection;
}

function vegetationExpression(symbols: SymbolData) {
  const values: unknown[] = ["match", ["get", symbols.vegetation.field]];
  Object.entries(symbols.vegetation.classes).forEach(([classId, symbol]) => {
    values.push(classId, symbol.color);
  });
  values.push("#8fa79a");
  return values;
}

function segmentExpression(symbols: SymbolData) {
  const breaks = symbols.segments.breaks;
  const values: unknown[] = [
    "step",
    ["to-number", ["get", symbols.segments.field]],
    breaks[0]?.color ?? "#b8e4e7",
  ];
  breaks.slice(0, -1).forEach((item, index) => {
    values.push(item.upper, breaks[index + 1].color);
  });
  return values;
}

function coordinatesBounds(features: GeoFeature[]) {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  const visit = (node: unknown) => {
    if (!Array.isArray(node)) return;
    if (typeof node[0] === "number" && typeof node[1] === "number") {
      west = Math.min(west, node[0]);
      east = Math.max(east, node[0]);
      south = Math.min(south, node[1]);
      north = Math.max(north, node[1]);
      return;
    }
    node.forEach(visit);
  };
  features.forEach((item) => visit(item.geometry.coordinates));
  return Number.isFinite(west)
    ? ([[west, south], [east, north]] as [[number, number], [number, number]])
    : null;
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat("es-BO", { day: "2-digit", month: "short", year: "numeric" }).format(
    new Date(`${date}T12:00:00`),
  );
}

function cleanDescription(description: string, classId: string) {
  if (description.slice(0, classId.length).toLocaleLowerCase("es") !== classId.toLocaleLowerCase("es")) return description;
  return description.slice(classId.length).replace(/^\s*[=:;-]?\s*/, "");
}

export default function Geoportal() {
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const vegetationFeatures = useRef<GeoFeature[]>([]);
  const [seriesData, setSeriesData] = useState<TimeSeriesData | null>(null);
  const [symbols, setSymbols] = useState<SymbolData | null>(null);
  const [mode, setMode] = useState<ThemeMode>("vegetation");
  const [selectedClass, setSelectedClass] = useState<string | null>(null);
  const [year, setYear] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [legendOpen, setLegendOpen] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/data/vegetacion_moxos.topojson").then((response) => response.json()),
      fetch("/data/segmentos.topojson").then((response) => response.json()),
      fetch("/data/vegetation-timeseries.json").then((response) => response.json()),
      fetch("/data/symbology.json").then((response) => response.json()),
    ])
      .then(([vegetationTopology, segmentTopology, timeSeries, symbolData]) => {
        if (cancelled || !mapContainer.current) return;
        const vegetation = topologyToFeatures(vegetationTopology);
        const segments = topologyToFeatures(segmentTopology);
        vegetationFeatures.current = vegetation.features;
        setSeriesData(timeSeries);
        setSymbols(symbolData);

        const map = new maplibregl.Map({
          container: mapContainer.current,
          bounds: symbolData.extents?.Vegetacion_Moxos ?? BOUNDS,
          fitBoundsOptions: { padding: 44 },
          minZoom: 5,
          maxZoom: 16,
          attributionControl: false,
          style: {
            version: 8,
            sources: {
              topographic: {
                type: "raster",
                tiles: [
                  "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
                ],
                tileSize: 256,
                attribution: "Esri, HERE, Garmin, FAO, NOAA, USGS, OpenStreetMap contributors",
              },
            },
            layers: [{ id: "basemap", type: "raster", source: "topographic" }],
          },
        });
        mapRef.current = map;
        map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-left");
        map.addControl(new maplibregl.AttributionControl({ compact: true }), "bottom-right");

        map.on("load", () => {
          map.addSource("segments", { type: "geojson", data: segments as never });
          map.addSource("vegetation", { type: "geojson", data: vegetation as never });
          map.addLayer({
            id: "segments-fill",
            type: "fill",
            source: "segments",
            layout: { visibility: "none" },
            paint: { "fill-color": segmentExpression(symbolData) as never, "fill-opacity": 0.92 },
          });
          map.addLayer({
            id: "segments-line",
            type: "line",
            source: "segments",
            layout: { visibility: "none" },
            paint: {
              "line-color": segmentExpression(symbolData) as never,
              "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.15, 11, 0.7],
            },
          });
          map.addLayer({
            id: "vegetation-fill",
            type: "fill",
            source: "vegetation",
            paint: { "fill-color": vegetationExpression(symbolData) as never, "fill-opacity": 0.93 },
          });
          map.addLayer({
            id: "vegetation-line",
            type: "line",
            source: "vegetation",
            paint: {
              "line-color": "#102f28",
              "line-opacity": 0.55,
              "line-width": ["interpolate", ["linear"], ["zoom"], 5, 0.22, 11, 1.1],
            },
          });
          map.addLayer({
            id: "selected-outline",
            type: "line",
            source: "vegetation",
            filter: ["==", ["get", "CLASE1"], ""],
            paint: { "line-color": "#fff9e8", "line-width": 3, "line-blur": 0.3 },
          });

          const chooseFeature = (event: maplibregl.MapLayerMouseEvent) => {
            const classId = event.features?.[0]?.properties?.CLASE1;
            if (classId) {
              setSelectedClass(String(classId));
              setPanelOpen(true);
            }
          };
          ["vegetation-fill", "segments-fill"].forEach((layer) => {
            map.on("click", layer, chooseFeature);
            map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
            map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = ""));
          });
          setLoading(false);
        });
      })
      .catch((error) => {
        if (!cancelled) {
          setLoading(false);
          setLoadError(error instanceof Error ? error.message : "No fue posible cargar los datos.");
        }
      });
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;
    const vegetationVisibility = mode === "vegetation" ? "visible" : "none";
    const segmentVisibility = mode === "segments" ? "visible" : "none";
    ["vegetation-fill", "vegetation-line"].forEach((layer) => map.setLayoutProperty(layer, "visibility", vegetationVisibility));
    ["segments-fill", "segments-line"].forEach((layer) => map.setLayoutProperty(layer, "visibility", segmentVisibility));
  }, [mode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded() || !map.getLayer("selected-outline")) return;
    map.setFilter("selected-outline", ["==", ["get", "CLASE1"], selectedClass ?? ""]);
  }, [selectedClass]);

  const classList = useMemo(() => {
    if (!seriesData) return [];
    return Object.values(seriesData.classes).sort((a, b) => b.areaKm2 - a.areaKm2);
  }, [seriesData]);

  const filteredClasses = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("es");
    if (!normalized) return classList.slice(0, 10);
    return classList
      .filter((item) => `${item.id} ${item.description}`.toLocaleLowerCase("es").includes(normalized))
      .slice(0, 12);
  }, [classList, query]);

  const selected = selectedClass && seriesData ? seriesData.classes[selectedClass] : null;

  const timeline = useMemo(() => {
    if (!selected || !seriesData) return [];
    return seriesData.dates
      .map((date, index) => ({ date, value: selected.series[index] ?? 0 }))
      .filter((item) => year === "all" || item.date.startsWith(year));
  }, [selected, seriesData, year]);

  const selectClass = (classId: string, zoom = true) => {
    setSelectedClass(classId);
    setPanelOpen(true);
    setSearchOpen(false);
    setQuery("");
    if (!zoom) return;
    const matches = vegetationFeatures.current.filter((item) => String(item.properties.CLASE1) === classId);
    const bounds = coordinatesBounds(matches);
    if (bounds) mapRef.current?.fitBounds(bounds, { padding: 80, maxZoom: 10, duration: 900 });
  };

  const resetExtent = () => mapRef.current?.fitBounds(symbols?.extents?.Vegetacion_Moxos ?? BOUNDS, { padding: 44, duration: 900 });

  return (
    <main className="geoportal-shell">
      <header className="topbar">
        <div className="brand-mark"><Leaf size={20} strokeWidth={1.8} /></div>
        <div className="brand-copy">
          <span className="eyebrow">Observatorio territorial</span>
          <h1>Vegetación e inundación del Beni</h1>
        </div>
        <div className="period-badge">
          <span>Serie MODIS</span>
          <strong>2001—2023</strong>
        </div>
      </header>

      <section className="map-stage" aria-label="Mapa interactivo de vegetación e inundación">
        <div ref={mapContainer} className="map-canvas" />

        <div className="map-tools">
          <div className="search-shell">
            <Search size={17} />
            <input
              value={query}
              onChange={(event) => { setQuery(event.target.value); setSearchOpen(true); }}
              onFocus={() => setSearchOpen(true)}
              placeholder="Buscar una clase de vegetación…"
              aria-label="Buscar clase de vegetación"
            />
            {query && <button onClick={() => setQuery("")} aria-label="Limpiar búsqueda"><X size={15} /></button>}
            {searchOpen && (
              <div className="search-results">
                <div className="search-caption">{query ? `${filteredClasses.length} coincidencias` : "Clases con mayor superficie"}</div>
                {filteredClasses.map((item) => (
                  <button key={item.id} onClick={() => selectClass(item.id)}>
                    <span className="class-swatch" style={{ background: symbols?.vegetation.classes[item.id]?.color ?? "#809b87" }} />
                    <span><strong>{item.id}</strong><small>{cleanDescription(item.description, item.id)}</small></span>
                  </button>
                ))}
                {!filteredClasses.length && <p className="empty-search">No se encontraron clases.</p>}
              </div>
            )}
          </div>

          <div className="theme-switch" aria-label="Tema del mapa">
            <button className={mode === "vegetation" ? "active" : ""} onClick={() => setMode("vegetation")}>
              <Leaf size={16} /> Vegetación
            </button>
            <button className={mode === "segments" ? "active" : ""} onClick={() => setMode("segments")}>
              <Droplets size={16} /> Permanencia
            </button>
          </div>
        </div>

        <button className="reset-map" onClick={resetExtent} aria-label="Volver a la extensión completa"><LocateFixed size={18} /></button>

        <div className={`legend-card ${legendOpen ? "open" : ""}`}>
          <button className="legend-heading" onClick={() => setLegendOpen(!legendOpen)}>
            <span><Layers3 size={16} /> Simbología</span><ChevronDown size={16} />
          </button>
          {legendOpen && symbols && (
            <div className="legend-body">
              {mode === "vegetation" ? (
                <>
                  <p>Clases de vegetación · CLASE1</p>
                  <div className="vegetation-ramp">
                    {Object.values(symbols.vegetation.classes).filter((_, index) => index % 18 === 0).map((symbol) => (
                      <i key={`${symbol.label}-${symbol.color}`} style={{ background: symbol.color }} />
                    ))}
                  </div>
                  <small>230 categorías · colores originales del mapa</small>
                </>
              ) : (
                <>
                  <p>Permanencia media · días</p>
                  <div className="break-list">
                    {symbols.segments.breaks.map((item) => <span key={item.label}><i style={{ background: item.color }} />{item.label.replace(" - ", " — ")}</span>)}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {!selected && !loading && (
          <div className="map-intro">
            <span className="intro-index">01</span>
            <div><strong>Explore el territorio</strong><p>Seleccione un polígono para descubrir su régimen histórico de inundación.</p></div>
          </div>
        )}

        {seriesData && (
          <div className="dataset-strip">
            <span><strong>{compact.format(seriesData.summary.classCount)}</strong> clases</span>
            <span><strong>{compact.format(seriesData.summary.observationCount)}</strong> fechas</span>
            <span><strong>8</strong> días</span>
          </div>
        )}

        {loading && <div className="loading-screen"><span /><p>Preparando el territorio</p></div>}
        {loadError && <div className="error-screen"><strong>No fue posible abrir el geoportal</strong><p>{loadError}</p></div>}
      </section>

      <aside className={`detail-panel ${panelOpen && selected ? "open" : ""}`} aria-live="polite">
        {selected && (
          <>
            <button className="panel-close" onClick={() => setPanelOpen(false)} aria-label="Cerrar detalle"><X size={19} /></button>
            <div className="detail-header">
              <span className="detail-swatch" style={{ background: symbols?.vegetation.classes[selected.id]?.color ?? "#799481" }} />
              <div><span className="eyebrow">Clase de vegetación</span><h2>{selected.id}</h2></div>
            </div>
            <p className="description">{cleanDescription(selected.description, selected.id)}</p>

            <div className="metric-grid">
              <article><span>Superficie</span><strong>{detailed.format(selected.areaKm2)}</strong><small>km²</small></article>
              <article><span>Frecuencia media</span><strong>{detailed.format(selected.longTerm.frequencyPct ?? 0)}</strong><small>% · 2001—2022</small></article>
              <article><span>Permanencia media</span><strong>{detailed.format(selected.longTerm.permanenceDays ?? 0)}</strong><small>días · 2001—2022</small></article>
            </div>

            <section className="chart-section">
              <div className="section-title">
                <div><span className="eyebrow">Temporalidad</span><h3>Superficie inundada</h3></div>
                <label>
                  <span className="sr-only">Periodo del gráfico</span>
                  <select value={year} onChange={(event) => setYear(event.target.value)}>
                    <option value="all">Serie completa</option>
                    {[...seriesData!.years, 2023].reverse().map((item) => <option key={item} value={String(item)}>{item}</option>)}
                  </select>
                </label>
              </div>
              <p className="chart-note">Área inundada estimada cada 8 días · km²</p>
              <div className="timeline-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={timeline} margin={{ top: 8, right: 4, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="floodGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#1b7f92" stopOpacity={0.46} />
                        <stop offset="100%" stopColor="#1b7f92" stopOpacity={0.03} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} stroke="#dce3dd" strokeDasharray="2 5" />
                    <XAxis dataKey="date" minTickGap={45} tickFormatter={(value) => year === "all" ? String(value).slice(0, 4) : String(value).slice(5)} tick={{ fontSize: 10, fill: "#6c7871" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: "#6c7871" }} axisLine={false} tickLine={false} width={48} />
                    <Tooltip formatter={(value) => [`${detailed.format(Number(value))} km²`, "Superficie"]} labelFormatter={(label) => formatDate(String(label))} contentStyle={{ borderRadius: 12, border: "1px solid #d8dfd9", fontSize: 12 }} />
                    <Area type="monotone" dataKey="value" stroke="#176c7b" strokeWidth={1.6} fill="url(#floodGradient)" isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              <div className="chart-summary"><span>Máximo observado <strong>{detailed.format(selected.maximumFloodedKm2)} km²</strong></span><span>Promedio <strong>{detailed.format(selected.meanFloodedKm2)} km²</strong></span></div>
            </section>

            <section className="chart-section annual-section">
              <div className="section-title"><div><span className="eyebrow">Índices anuales</span><h3>Frecuencia y permanencia</h3></div></div>
              <div className="annual-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={selected.annual} margin={{ top: 12, right: -4, left: -24, bottom: 0 }}>
                    <CartesianGrid vertical={false} stroke="#dce3dd" strokeDasharray="2 5" />
                    <XAxis dataKey="year" minTickGap={22} tick={{ fontSize: 10, fill: "#6c7871" }} axisLine={false} tickLine={false} />
                    <YAxis yAxisId="frequency" tick={{ fontSize: 10, fill: "#6c7871" }} axisLine={false} tickLine={false} />
                    <YAxis yAxisId="days" orientation="right" hide />
                    <Tooltip formatter={(value, name) => name === "Frecuencia" ? [`${detailed.format(Number(value))}%`, name] : [`${detailed.format(Number(value))} días`, name]} contentStyle={{ borderRadius: 12, border: "1px solid #d8dfd9", fontSize: 12 }} />
                    <Bar yAxisId="frequency" name="Frecuencia" dataKey="frequencyPct" fill="#86b8b1" radius={[3, 3, 0, 0]} maxBarSize={10} />
                    <Line yAxisId="days" name="Permanencia" dataKey="permanenceDays" stroke="#173f36" strokeWidth={1.8} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className="chart-key"><span><i className="bar-key" /> Frecuencia (%)</span><span><i className="line-key" /> Permanencia (días)</span></div>
            </section>

            <footer className="panel-footer">Fuente: MODIS · observaciones cada 8 días · procesamiento 2001—2023</footer>
          </>
        )}
      </aside>
    </main>
  );
}
