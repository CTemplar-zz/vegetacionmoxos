"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Layer as LeafletLayer, Map as LeafletMap, TileLayer } from "leaflet";
import { feature as topojsonFeature } from "topojson-client";
import { PMTiles } from "pmtiles";
import { VectorTile, type VectorTileFeature, type VectorTileLayer } from "@mapbox/vector-tile";
import { PbfReader } from "pbf";
import {
  Area,
  AreaChart,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceArea,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ChevronDown,
  Check,
  Droplets,
  Layers3,
  Leaf,
  LocateFixed,
  Map as MapIcon,
  Maximize2,
  CalendarPlus,
  Trash2,
  PanelRightOpen,
  RotateCcw,
  Eye,
  EyeOff,
  Search,
  X,
} from "lucide-react";
import "leaflet/dist/leaflet.css";

const PUBLIC_BASE = import.meta.env.BASE_URL ?? "/";

function publicAsset(path: string) {
  return `${PUBLIC_BASE}${path.replace(/^\/+/, "")}`;
}

type ThemeMode = "vegetation" | "segments";

type TileSource = {
  url: string;
  format: "pmtiles" | "zxy";
  layerName: string;
  minZoom: number;
  maxZoom: number;
};

type VectorGridRuntimeLayer = LeafletLayer & {
  _getVectorTilePromise?: (coords: { z: number; x: number; y: number }) => Promise<unknown>;
  redraw?: () => unknown;
};

type TileSourcesConfig = {
  vegetation: TileSource;
  segments: TileSource;
};

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

type SegmentFloodData = {
  version: number;
  idField: "OBJECTID_1";
  dates: string[];
  ids: number[];
  classes: string[];
  bitsets: string[];
  floodRule: string;
};

type FloodLayerItem = { id: string; classId: string; date: string; opacity: number; visible: boolean };

type TimelinePoint = { date: string; value: number; percentage: number };

type DateRange = { start: string; end: string };

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

const BASE_MAPS = {
  topographic: {
    label: "Topográfico",
    description: "Relieve, ríos y localidades",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
    attribution: "Esri, HERE, Garmin, FAO, NOAA, USGS",
    tone: "topographic",
  },
  satellite: {
    label: "Satélite",
    description: "Imagen aérea del territorio",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Esri, Maxar, Earthstar Geographics",
    tone: "satellite",
  },
  streets: {
    label: "Calles",
    description: "Vías, poblaciones y límites",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}",
    attribution: "Esri, HERE, Garmin, OpenStreetMap contributors",
    tone: "streets",
  },
  lightGray: {
    label: "Gris claro",
    description: "Base neutra para análisis",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}",
    attribution: "Esri, HERE, Garmin",
    tone: "light-gray",
  },
} as const;

type BaseMapKey = keyof typeof BASE_MAPS;

const compact = new Intl.NumberFormat("es-BO", { maximumFractionDigits: 1 });
const detailed = new Intl.NumberFormat("es-BO", { maximumFractionDigits: 2 });

function topologyToFeatures(topology: Record<string, unknown>): GeoFeatureCollection {
  const objects = topology.objects as Record<string, unknown>;
  const object = objects[Object.keys(objects)[0]];
  return topojsonFeature(topology as never, object as never) as unknown as GeoFeatureCollection;
}

function vegetationColor(classId: unknown, symbols: SymbolData) {
  return symbols.vegetation.classes[String(classId)]?.color ?? "#8fa79a";
}

function segmentColor(value: unknown, symbols: SymbolData) {
  const breaks = symbols.segments.breaks;
  const numeric = Number(value);
  return breaks.find((item) => numeric <= item.upper)?.color ?? breaks.at(-1)?.color ?? "#b8e4e7";
}

function leafletBounds(bounds: [[number, number], [number, number]]) {
  return [
    [bounds[0][1], bounds[0][0]],
    [bounds[1][1], bounds[1][0]],
  ] as [[number, number], [number, number]];
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

function FloodTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ payload?: TimelinePoint }>; label?: string }) {
  const point = payload?.[0]?.payload;
  if (!active || !point || !label) return null;
  return (
    <div className="flood-tooltip">
      <strong>{formatDate(String(label))}</strong>
      <span><i className="percent-dot" />{detailed.format(point.percentage)}% inundado</span>
      <span><i className="area-dot" />{detailed.format(point.value)} km²</span>
    </div>
  );
}

export default function Geoportal() {
  const mapContainer = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const leafletRef = useRef<typeof import("leaflet") | null>(null);
  const vegetationLayerRef = useRef<LeafletLayer | null>(null);
  const segmentsLayerRef = useRef<LeafletLayer | null>(null);
  const selectedLayerRef = useRef<LeafletLayer | null>(null);
  const selectionUsesVectorTilesRef = useRef(false);
  const selectedClassRef = useRef<string | null>(null);
  const createVectorLayerRef = useRef<((source: TileSource, options: Record<string, unknown>) => VectorGridRuntimeLayer | null) | null>(null);
  const segmentTileSourceRef = useRef<TileSource | null>(null);
  const floodLayerRefs = useRef(new Map<string, LeafletLayer>());
  const floodOpacityRefs = useRef(new Map<string, number>());
  const layerOpacityRef = useRef({ vegetation: 0.93, segments: 0.92 });
  const dragStartRef = useRef<string | null>(null);
  const dragEndRef = useRef<string | null>(null);
  const floodDataRef = useRef<SegmentFloodData | null>(null);
  const segmentRowByIdRef = useRef(new Map<number, number>());
  const baseLayerRef = useRef<TileLayer | null>(null);
  const vegetationFeatures = useRef<GeoFeature[]>([]);
  const [seriesData, setSeriesData] = useState<TimeSeriesData | null>(null);
  const [symbols, setSymbols] = useState<SymbolData | null>(null);
  const [mode, setMode] = useState<ThemeMode>("vegetation");
  const [layerVisibility, setLayerVisibility] = useState({ vegetation: true, segments: false });
  const [selectedClass, setSelectedClass] = useState<string | null>(null);
  const [year, setYear] = useState<string>("all");
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [legendOpen, setLegendOpen] = useState(true);
  const [baseMap, setBaseMap] = useState<BaseMapKey>("topographic");
  const [baseMapOpen, setBaseMapOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [chartExpanded, setChartExpanded] = useState(false);
  const [selectedFloodDate, setSelectedFloodDate] = useState<string>("");
  const [floodLayers, setFloodLayers] = useState<FloodLayerItem[]>([]);
  const [layerOpacity, setLayerOpacity] = useState({ vegetation: 0.93, segments: 0.92 });
  const [zoomRange, setZoomRange] = useState<DateRange | null>(null);
  const [dragStart, setDragStart] = useState<string | null>(null);
  const [dragEnd, setDragEnd] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      import("leaflet"),
      fetch(publicAsset("data/vegetacion_moxos.topojson")).then((response) => response.json()),
      fetch(publicAsset("data/segmentos.topojson")).then((response) => response.json()),
      fetch(publicAsset("data/vegetation-timeseries.json")).then((response) => response.json()),
      fetch(publicAsset("data/symbology.json")).then((response) => response.json()),
      fetch(publicAsset("data/tile-sources.json")).then((response) => response.json()) as Promise<TileSourcesConfig>,
      fetch(publicAsset("data/segment-flood-bitsets.json")).then((response) => response.json()) as Promise<SegmentFloodData>,
    ])
      .then(async ([L, vegetationTopology, segmentTopology, timeSeries, symbolData, tileSources, floodData]) => {
        if (cancelled || !mapContainer.current) return;
        (window as Window & { L?: typeof L }).L = L;
        await import("leaflet.vectorgrid");
        const vegetation = topologyToFeatures(vegetationTopology);
        const segments = topologyToFeatures(segmentTopology);
        vegetationFeatures.current = vegetation.features;
        setSeriesData(timeSeries);
        setSymbols(symbolData);
        floodDataRef.current = floodData;
        segmentRowByIdRef.current = new Map(floodData.ids.map((id, index) => [Number(id), index]));
        segmentTileSourceRef.current = tileSources.segments;

        leafletRef.current = L;
        const map = L.map(mapContainer.current, {
          preferCanvas: true,
          zoomControl: false,
          attributionControl: true,
          minZoom: 5,
          maxZoom: 13,
        });
        mapRef.current = map;

        const paneLevels = [
          ["vegetationPane", 410],
          ["segmentsPane", 420],
          ["floodPane", 430],
          ["selectionPane", 440],
        ] as const;
        paneLevels.forEach(([name, zIndex]) => {
          const pane = map.createPane(name);
          pane.style.zIndex = String(zIndex);
        });

        L.control.zoom({ position: "bottomleft" }).addTo(map);
        baseLayerRef.current = L.tileLayer(BASE_MAPS.topographic.url, {
          attribution: BASE_MAPS.topographic.attribution,
          maxZoom: 13,
        }).addTo(map);

        const renderer = L.canvas({ padding: 0.45 });
        const showSegmentPopup = (
          properties: Record<string, unknown> | undefined,
          latlng: import("leaflet").LatLng,
        ) => {
          if (!properties) return;
          const content = document.createElement("div");
          content.className = "segment-popup-card";

          const heading = document.createElement("div");
          heading.className = "segment-popup-heading";
          const eyebrow = document.createElement("span");
          eyebrow.textContent = "Segmento de inundación";
          const title = document.createElement("strong");
          title.textContent = properties.CLASE1 ? `Vegetación ${String(properties.CLASE1)}` : "Información del segmento";
          heading.append(eyebrow, title);
          if (properties.OBJECTID_1 != null) {
            const identifier = document.createElement("small");
            identifier.className = "segment-popup-id";
            identifier.textContent = `ID ${String(properties.OBJECTID_1)}`;
            heading.append(identifier);
          }

          const metrics = document.createElement("div");
          metrics.className = "segment-popup-metrics";
          const addMetric = (label: string, rawValue: unknown, unit: string) => {
            const metric = document.createElement("div");
            const labelNode = document.createElement("span");
            labelNode.textContent = label;
            const valueNode = document.createElement("strong");
            const numeric = Number(rawValue);
            valueNode.textContent = Number.isFinite(numeric) ? detailed.format(numeric) : "Sin dato";
            const unitNode = document.createElement("small");
            unitNode.textContent = Number.isFinite(numeric) ? unit : "";
            metric.append(labelNode, valueNode, unitNode);
            metrics.append(metric);
          };
          addMetric("Frecuencia", properties.Frec, "%");
          addMetric("Permanencia", properties.PromDias, "días");
          content.append(heading, metrics);

          L.popup({ className: "segment-popup", closeButton: true, maxWidth: 290, offset: [0, -8] })
            .setLatLng(latlng)
            .setContent(content)
            .openOn(map);
        };

        const chooseFeature = (feature: GeoFeature | undefined, layer: import("leaflet").Layer) => {
          layer.on("click", () => {
            const classId = feature?.properties?.CLASE1;
            if (classId) {
              setSelectedClass(String(classId));
              setPanelOpen(true);
            }
          });
        };

        const vectorGrid = (L as typeof L & {
          vectorGrid?: {
            protobuf: (url: string, options: Record<string, unknown>) => VectorGridRuntimeLayer;
          };
        }).vectorGrid;

        const createVectorLayer = (source: TileSource, options: Record<string, unknown>) => {
          if (!vectorGrid) return null;
          const layer = vectorGrid.protobuf(source.format === "zxy" ? source.url : "", options);
          if (source.format !== "pmtiles") return layer;

          const archive = new PMTiles(source.url);
          layer._getVectorTilePromise = async ({ z, x, y }) => {
            const response = await archive.getZxy(z, x, y);
            if (!response) return { layers: {} };

            const tile = new VectorTile(new PbfReader(response.data));
            Object.values(tile.layers).forEach((vectorLayer: VectorTileLayer) => {
              const features: VectorTileFeature[] = [];
              for (let index = 0; index < vectorLayer.length; index += 1) {
                const feature = vectorLayer.feature(index) as VectorTileFeature & { geometry?: unknown };
                feature.geometry = feature.loadGeometry();
                feature.properties = { ...feature.properties, OBJECTID_1: feature.id };
                features.push(feature);
              }
              (vectorLayer as VectorTileLayer & { features: VectorTileFeature[] }).features = features;
            });
            return tile;
          };
          return layer;
        };
        createVectorLayerRef.current = createVectorLayer;

        if (tileSources.segments.url && vectorGrid) {
          const segmentsTiles = createVectorLayer(tileSources.segments, {
            pane: "segmentsPane",
            minZoom: tileSources.segments.minZoom,
            maxNativeZoom: tileSources.segments.maxZoom,
            maxZoom: tileSources.segments.maxZoom,
            interactive: true,
            vectorTileLayerStyles: {
              [tileSources.segments.layerName]: (properties: Record<string, unknown>) => {
                if (selectedClassRef.current && String(properties.CLASE1) !== selectedClassRef.current) return [];
                const color = segmentColor(properties.PromDias, symbolData);
                const opacity = layerOpacityRef.current.segments;
                return { color, fill: true, fillColor: color, fillOpacity: opacity, opacity, weight: 0.45 };
              },
            },
          });
          if (!segmentsTiles) throw new Error("No fue posible inicializar la capa de segmentos.");
          segmentsTiles.on("click", (event: unknown) => {
            const segmentEvent = event as {
              latlng?: import("leaflet").LatLng;
              layer?: { properties?: Record<string, unknown> };
            };
            if (segmentEvent.latlng) showSegmentPopup(segmentEvent.layer?.properties, segmentEvent.latlng);
          });
          segmentsLayerRef.current = segmentsTiles;
        } else {
          segmentsLayerRef.current = L.geoJSON(segments as never, {
            pane: "segmentsPane",
            renderer,
            style: (feature) => {
              const color = segmentColor(feature?.properties?.PromDias, symbolData);
              return { color, fill: true, fillColor: color, fillOpacity: 0.92, opacity: 0.85, weight: 0.45 };
            },
            onEachFeature: ((feature: GeoFeature, layer: import("leaflet").Layer) => {
              layer.on("click", (event: unknown) => {
                const latlng = (event as { latlng?: import("leaflet").LatLng }).latlng;
                if (latlng) showSegmentPopup(feature.properties, latlng);
              });
            }) as never,
          });
        }

        if (tileSources.vegetation.url && vectorGrid) {
          const vegetationTiles = createVectorLayer(tileSources.vegetation, {
            pane: "vegetationPane",
            minZoom: tileSources.vegetation.minZoom,
            maxNativeZoom: tileSources.vegetation.maxZoom,
            maxZoom: tileSources.vegetation.maxZoom,
            interactive: true,
            vectorTileLayerStyles: {
              [tileSources.vegetation.layerName]: (properties: Record<string, unknown>) => ({
                color: "#102f28",
                fill: true,
                fillColor: vegetationColor(properties.CLASE1, symbolData),
                fillOpacity: layerOpacityRef.current.vegetation,
                opacity: layerOpacityRef.current.vegetation,
                weight: 0.55,
              }),
            },
          });
          if (!vegetationTiles) throw new Error("No fue posible inicializar la capa de vegetación.");
          vegetationTiles.on("click", (event: unknown) => {
            const properties = (event as { layer?: { properties?: Record<string, unknown> } }).layer?.properties;
            if (properties?.CLASE1) {
              setSelectedClass(String(properties.CLASE1));
              setPanelOpen(true);
            }
          });
          vegetationLayerRef.current = vegetationTiles.addTo(map);

          const selectionTiles = createVectorLayer(tileSources.vegetation, {
            pane: "selectionPane",
            minZoom: tileSources.vegetation.minZoom,
            maxNativeZoom: tileSources.vegetation.maxZoom,
            maxZoom: tileSources.vegetation.maxZoom,
            interactive: false,
            vectorTileLayerStyles: {
              [tileSources.vegetation.layerName]: (properties: Record<string, unknown>) =>
                String(properties.CLASE1) === selectedClassRef.current
                  ? [
                      { color: "#0b3d34", fill: false, fillOpacity: 0, opacity: 0.92, weight: 4 },
                      { color: "#fff9e8", fill: false, fillOpacity: 0, opacity: 1, weight: 2 },
                    ]
                  : [],
            },
          });
          if (!selectionTiles) throw new Error("No fue posible inicializar el resaltado de selección.");
          selectedLayerRef.current = selectionTiles;
          selectionUsesVectorTilesRef.current = true;
        } else {
          vegetationLayerRef.current = L.geoJSON(vegetation as never, {
            pane: "vegetationPane",
            renderer,
            style: (feature) => ({
              color: "#102f28",
              fill: true,
              fillColor: vegetationColor(feature?.properties?.CLASE1, symbolData),
              fillOpacity: 0.93,
              opacity: 0.56,
              weight: 0.55,
            }),
            onEachFeature: chooseFeature as never,
          }).addTo(map);
        }

        map.fitBounds(leafletBounds(symbolData.extents?.Vegetacion_Moxos ?? BOUNDS), { padding: [44, 44] });
        map.whenReady(() => {
          window.setTimeout(() => map.invalidateSize(), 0);
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
      floodLayerRefs.current.clear();
      floodOpacityRefs.current.clear();
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const vegetationLayer = vegetationLayerRef.current;
    const segmentsLayer = segmentsLayerRef.current;
    if (!map || !vegetationLayer || !segmentsLayer) return;
    if (layerVisibility.vegetation && !map.hasLayer(vegetationLayer)) vegetationLayer.addTo(map);
    if (!layerVisibility.vegetation && map.hasLayer(vegetationLayer)) map.removeLayer(vegetationLayer);
    if (layerVisibility.segments && !map.hasLayer(segmentsLayer)) segmentsLayer.addTo(map);
    if (!layerVisibility.segments && map.hasLayer(segmentsLayer)) map.removeLayer(segmentsLayer);
  }, [layerVisibility]);

  useEffect(() => {
    layerOpacityRef.current = layerOpacity;
    (vegetationLayerRef.current as VectorGridRuntimeLayer | null)?.redraw?.();
    (segmentsLayerRef.current as VectorGridRuntimeLayer | null)?.redraw?.();
  }, [layerOpacity]);

  useEffect(() => {
    const map = mapRef.current;
    const L = leafletRef.current;
    if (!map || !L) return;
    selectedClassRef.current = selectedClass;
    (segmentsLayerRef.current as VectorGridRuntimeLayer | null)?.redraw?.();
    const shouldShowSelection = Boolean(selectedClass);

    if (selectionUsesVectorTilesRef.current && selectedLayerRef.current) {
      if (map.hasLayer(selectedLayerRef.current)) map.removeLayer(selectedLayerRef.current);
      if (shouldShowSelection) {
        (selectedLayerRef.current as VectorGridRuntimeLayer).redraw?.();
        selectedLayerRef.current.addTo(map);
      }
      return;
    }

    if (selectedLayerRef.current) {
      map.removeLayer(selectedLayerRef.current);
      selectedLayerRef.current = null;
    }
    if (!shouldShowSelection || !selectedClass) return;
    const matches = vegetationFeatures.current.filter((item) => String(item.properties.CLASE1) === selectedClass);
    if (!matches.length) return;
    selectedLayerRef.current = L.geoJSON({ type: "FeatureCollection", features: matches } as never, {
      pane: "selectionPane",
      renderer: L.canvas({ padding: 0.45 }),
      interactive: false,
      style: { color: "#fff9e8", fillOpacity: 0, opacity: 1, weight: 3 },
    }).addTo(map);
  }, [selectedClass, layerVisibility]);

  const toggleLayer = (layer: ThemeMode) => {
    setMode(layer);
    setLayerVisibility((current) => ({ ...current, [layer]: !current[layer] }));
  };

  useEffect(() => {
    const map = mapRef.current;
    const L = leafletRef.current;
    if (!map || !L) return;
    if (baseLayerRef.current) map.removeLayer(baseLayerRef.current);
    const definition = BASE_MAPS[baseMap];
    baseLayerRef.current = L.tileLayer(definition.url, {
      attribution: definition.attribution,
      maxZoom: 13,
    }).addTo(map);
    baseLayerRef.current.bringToBack();
  }, [baseMap]);

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
      .map((date, index) => {
        const value = selected.series[index] ?? 0;
        const percentage = selected.areaKm2 > 0 ? Math.min(100, (value / selected.areaKm2) * 100) : 0;
        return { date, value, percentage };
      })
      .filter((item) => year === "all" || item.date.startsWith(year));
  }, [selected, seriesData, year]);

  const expandedTimeline = useMemo(() => {
    if (!zoomRange) return timeline;
    return timeline.filter((item) => item.date >= zoomRange.start && item.date <= zoomRange.end);
  }, [timeline, zoomRange]);

  useEffect(() => {
    if (selectedFloodDate && !timeline.some((item) => item.date === selectedFloodDate)) setSelectedFloodDate("");
  }, [timeline, selectedFloodDate]);

  useEffect(() => {
    setZoomRange(null);
    setDragStart(null);
    setDragEnd(null);
    dragStartRef.current = null;
    dragEndRef.current = null;
  }, [selectedClass, year]);

  const chartLabel = (state: unknown) => {
    const label = (state as { activeLabel?: unknown } | undefined)?.activeLabel;
    return label ? String(label) : null;
  };

  const startChartDrag = (state: unknown) => {
    const label = chartLabel(state);
    if (!label) return;
    dragStartRef.current = label;
    dragEndRef.current = label;
    setDragStart(label);
    setDragEnd(label);
  };

  const updateChartDrag = (state: unknown) => {
    if (!dragStartRef.current) return;
    const label = chartLabel(state);
    if (!label) return;
    dragEndRef.current = label;
    setDragEnd(label);
  };

  const finishChartDrag = () => {
    const start = dragStartRef.current;
    const end = dragEndRef.current;
    if (start && end) {
      if (start === end) {
        setSelectedFloodDate(start);
      } else {
        setZoomRange({ start: start < end ? start : end, end: start < end ? end : start });
        setSelectedFloodDate("");
      }
    }
    dragStartRef.current = null;
    dragEndRef.current = null;
    setDragStart(null);
    setDragEnd(null);
  };

  const removeFloodLayer = (layerId: string) => {
    const layer = floodLayerRefs.current.get(layerId);
    if (layer && mapRef.current?.hasLayer(layer)) mapRef.current.removeLayer(layer);
    floodLayerRefs.current.delete(layerId);
    floodOpacityRefs.current.delete(layerId);
    setFloodLayers((current) => current.filter((item) => item.id !== layerId));
  };

  const updateFloodLayerOpacity = (layerId: string, opacity: number) => {
    floodOpacityRefs.current.set(layerId, opacity);
    (floodLayerRefs.current.get(layerId) as VectorGridRuntimeLayer | undefined)?.redraw?.();
    setFloodLayers((current) => current.map((item) => item.id === layerId ? { ...item, opacity } : item));
  };

  const toggleFloodLayerVisibility = (layerId: string) => {
    const item = floodLayers.find((candidate) => candidate.id === layerId);
    const layer = floodLayerRefs.current.get(layerId);
    const map = mapRef.current;
    if (!item || !layer || !map) return;
    const visible = !item.visible;
    if (visible && !map.hasLayer(layer)) layer.addTo(map);
    if (!visible && map.hasLayer(layer)) map.removeLayer(layer);
    setFloodLayers((current) => current.map((candidate) => candidate.id === layerId ? { ...candidate, visible } : candidate));
  };

  const addFloodLayer = () => {
    const map = mapRef.current;
    const source = segmentTileSourceRef.current;
    const createVectorLayer = createVectorLayerRef.current;
    const floodData = floodDataRef.current;
    if (!map || !source || !createVectorLayer || !floodData || !selectedClass || !selectedFloodDate) return;
    const dateIndex = floodData.dates.indexOf(selectedFloodDate);
    if (dateIndex < 0) return;
    const bytes = Uint8Array.from(atob(floodData.bitsets[dateIndex]), (character) => character.charCodeAt(0));
    const classId = selectedClass;
    const layerId = `${classId}-${selectedFloodDate}-${Date.now()}`;
    floodOpacityRefs.current.set(layerId, 0.82);
    const layer = createVectorLayer(source, {
      pane: "floodPane",
      minZoom: source.minZoom,
      maxNativeZoom: source.maxZoom,
      maxZoom: source.maxZoom,
      interactive: false,
      vectorTileLayerStyles: {
        [source.layerName]: (properties: Record<string, unknown>) => {
          if (String(properties.CLASE1) !== classId) return [];
          const rowIndex = segmentRowByIdRef.current.get(Number(properties.OBJECTID_1));
          if (rowIndex == null || (bytes[rowIndex >> 3] & (1 << (rowIndex & 7))) === 0) return [];
          const opacity = floodOpacityRefs.current.get(layerId) ?? 0.82;
          return { color: "#0d5f95", fill: true, fillColor: "#248ec7", fillOpacity: opacity, opacity, weight: 0.55 };
        },
      },
    });
    if (!layer) return;
    layer.addTo(map);
    floodLayerRefs.current.set(layerId, layer);
    setFloodLayers((current) => [...current, { id: layerId, classId, date: selectedFloodDate, opacity: 0.82, visible: true }]);
    setChartExpanded(false);
    setLayerVisibility((current) => ({ ...current, segments: true }));
    setMode("segments");
  };

  const selectClass = (classId: string, zoom = true) => {
    setSelectedClass(classId);
    setPanelOpen(true);
    setSearchOpen(false);
    setQuery("");
    if (!zoom) return;
    const matches = vegetationFeatures.current.filter((item) => String(item.properties.CLASE1) === classId);
    const bounds = coordinatesBounds(matches);
    if (bounds) mapRef.current?.fitBounds(leafletBounds(bounds), { padding: [80, 80], maxZoom: 10, animate: true, duration: 0.9 });
  };

  const resetExtent = () => mapRef.current?.fitBounds(leafletBounds(symbols?.extents?.Vegetacion_Moxos ?? BOUNDS), { padding: [44, 44], animate: true, duration: 0.9 });

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

          <div className="theme-switch" aria-label="Visibilidad de capas">
            <button
              className={layerVisibility.vegetation ? "active" : ""}
              onClick={() => toggleLayer("vegetation")}
              aria-pressed={layerVisibility.vegetation}
            >
              <Leaf size={16} /> Vegetación {layerVisibility.vegetation ? <Eye size={14} /> : <EyeOff size={14} />}
            </button>
            <button
              className={layerVisibility.segments ? "active" : ""}
              onClick={() => toggleLayer("segments")}
              aria-pressed={layerVisibility.segments}
            >
              <Droplets size={16} /> Permanencia {layerVisibility.segments ? <Eye size={14} /> : <EyeOff size={14} />}
            </button>
          </div>

          <div className="layer-opacity-control" aria-label="Opacidad de capas principales">
            <label>
              <span><Leaf size={13} /> Vegetación <strong>{Math.round(layerOpacity.vegetation * 100)}%</strong></span>
              <input type="range" min="0" max="100" value={Math.round(layerOpacity.vegetation * 100)} onChange={(event) => setLayerOpacity((current) => ({ ...current, vegetation: Number(event.target.value) / 100 }))} />
            </label>
            <label>
              <span><Droplets size={13} /> Permanencia <strong>{Math.round(layerOpacity.segments * 100)}%</strong></span>
              <input type="range" min="0" max="100" value={Math.round(layerOpacity.segments * 100)} onChange={(event) => setLayerOpacity((current) => ({ ...current, segments: Number(event.target.value) / 100 }))} />
            </label>
          </div>

          {selected && !panelOpen && (
            <button className="reopen-detail" onClick={() => setPanelOpen(true)}><PanelRightOpen size={16} /><span>Ver detalle de <strong>{selected.id}</strong></span></button>
          )}
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

        <div className={`basemap-control ${baseMapOpen ? "open" : ""}`}>
          <button
            className="basemap-trigger"
            onClick={() => setBaseMapOpen(!baseMapOpen)}
            aria-expanded={baseMapOpen}
            aria-label="Seleccionar mapa base"
          >
            <MapIcon size={16} />
            <span><small>Mapa base</small><strong>{BASE_MAPS[baseMap].label}</strong></span>
            <ChevronDown size={15} />
          </button>
          {baseMapOpen && (
            <div className="basemap-menu">
              {Object.entries(BASE_MAPS).map(([key, item]) => (
                <button
                  key={key}
                  className={baseMap === key ? "active" : ""}
                  onClick={() => { setBaseMap(key as BaseMapKey); setBaseMapOpen(false); }}
                >
                  <i className={`basemap-swatch ${item.tone}`} />
                  <span><strong>{item.label}</strong><small>{item.description}</small></span>
                  {baseMap === key && <Check size={15} />}
                </button>
              ))}
            </div>
          )}
        </div>

        {floodLayers.length > 0 && (
          <div className={`flood-layer-control ${panelOpen && selected ? "panel-offset" : ""}`}>
            <div className="flood-layer-heading"><Droplets size={14} /><span>Capas por fecha</span></div>
            {floodLayers.map((item) => (
              <div className="flood-layer-row" key={item.id}>
                <div className={`flood-layer-meta ${item.visible ? "" : "hidden"}`}><i /><span><strong>{item.classId}</strong><small>{formatDate(item.date)}</small></span><button className="visibility-button" onClick={() => toggleFloodLayerVisibility(item.id)} aria-label={`${item.visible ? "Desactivar" : "Activar"} inundación de ${formatDate(item.date)}`}>{item.visible ? <Eye size={14} /> : <EyeOff size={14} />}</button><button onClick={() => removeFloodLayer(item.id)} aria-label={`Eliminar inundación de ${formatDate(item.date)}`}><Trash2 size={14} /></button></div>
                <label><span>Opacidad <strong>{Math.round(item.opacity * 100)}%</strong></span><input type="range" min="0" max="100" value={Math.round(item.opacity * 100)} onChange={(event) => updateFloodLayerOpacity(item.id, Number(event.target.value) / 100)} /></label>
              </div>
            ))}
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
                <div className="chart-actions"><label>
                  <span className="sr-only">Periodo del gráfico</span>
                  <select value={year} onChange={(event) => setYear(event.target.value)}>
                    <option value="all">Serie completa</option>
                    {[...seriesData!.years, 2023].reverse().map((item) => <option key={item} value={String(item)}>{item}</option>)}
                  </select>
                </label><button className="expand-chart" onClick={() => setChartExpanded(true)} aria-label="Ampliar gráfico"><Maximize2 size={15} /></button></div>
              </div>
              <p className="chart-note">Porcentaje inundado · superficie en km² sobre el eje derecho</p>
              <div className="timeline-chart">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={timeline} margin={{ top: 8, right: 0, left: -10, bottom: 0 }} onClick={(state) => state?.activeLabel && setSelectedFloodDate(String(state.activeLabel))}>
                    <defs>
                      <linearGradient id="floodGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#1b7f92" stopOpacity={0.46} />
                        <stop offset="100%" stopColor="#1b7f92" stopOpacity={0.03} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid vertical={false} stroke="#dce3dd" strokeDasharray="2 5" />
                    <XAxis dataKey="date" minTickGap={45} tickFormatter={(value) => year === "all" ? String(value).slice(0, 4) : String(value).slice(5)} tick={{ fontSize: 10, fill: "#6c7871" }} axisLine={false} tickLine={false} />
                    <YAxis yAxisId="percent" domain={[0, "dataMax"]} tickFormatter={(value) => `${detailed.format(Number(value))}%`} tick={{ fontSize: 9, fill: "#176c7b" }} axisLine={false} tickLine={false} width={47} />
                    <YAxis yAxisId="area" orientation="right" domain={[0, "dataMax"]} tickFormatter={(value) => detailed.format(Number(value))} tick={{ fontSize: 9, fill: "#596a62" }} axisLine={false} tickLine={false} width={51} />
                    <Tooltip content={<FloodTooltip />} />
                    <Area yAxisId="percent" type="monotone" dataKey="percentage" stroke="#176c7b" strokeWidth={1.6} fill="url(#floodGradient)" isAnimationActive={false} />
                    <Line yAxisId="area" type="monotone" dataKey="value" stroke="#174d57" strokeWidth={1} dot={false} activeDot={false} isAnimationActive={false} />
                    {selectedFloodDate && <ReferenceLine x={selectedFloodDate} stroke="#d2693c" strokeWidth={1.5} />}
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

      {chartExpanded && selected && (
        <div className="chart-modal" role="dialog" aria-modal="true" aria-label="Gráfico ampliado de superficie inundada">
          <div className="chart-modal-card">
            <div className="chart-modal-header">
              <div><span className="eyebrow">Clase {selected.id} · Temporalidad</span><h2>Superficie inundada</h2></div>
              <button onClick={() => setChartExpanded(false)} aria-label="Cerrar gráfico ampliado"><X size={20} /></button>
            </div>
            <div className="zoom-instructions"><p>Arrastre horizontalmente sobre el gráfico para ampliar un rango. Haga clic en un punto para seleccionar una fecha.</p>{zoomRange && <button onClick={() => setZoomRange(null)}><RotateCcw size={14} /> Restablecer rango</button>}</div>
            <div className="expanded-chart">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={expandedTimeline} margin={{ top: 15, right: 5, left: 5, bottom: 10 }} onMouseDown={startChartDrag} onMouseMove={updateChartDrag} onMouseUp={finishChartDrag} onMouseLeave={finishChartDrag}>
                  <defs><linearGradient id="floodGradientExpanded" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#1b7f92" stopOpacity={0.55} /><stop offset="100%" stopColor="#1b7f92" stopOpacity={0.04} /></linearGradient></defs>
                  <CartesianGrid vertical={false} stroke="#dce3dd" strokeDasharray="2 5" />
                  <XAxis dataKey="date" minTickGap={54} tickFormatter={(value) => year === "all" ? String(value).slice(0, 4) : String(value).slice(5)} tick={{ fontSize: 11, fill: "#6c7871" }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="percent" domain={[0, "dataMax"]} tickFormatter={(value) => `${detailed.format(Number(value))}%`} tick={{ fontSize: 11, fill: "#176c7b" }} axisLine={false} tickLine={false} width={68} label={{ value: "% inundado", angle: -90, position: "insideLeft", fill: "#176c7b", fontSize: 11 }} />
                  <YAxis yAxisId="area" orientation="right" domain={[0, "dataMax"]} tickFormatter={(value) => detailed.format(Number(value))} tick={{ fontSize: 11, fill: "#596a62" }} axisLine={false} tickLine={false} width={78} label={{ value: "Superficie (km²)", angle: 90, position: "insideRight", fill: "#596a62", fontSize: 11 }} />
                  <Tooltip content={<FloodTooltip />} />
                  <Area yAxisId="percent" type="monotone" dataKey="percentage" stroke="#176c7b" strokeWidth={2} fill="url(#floodGradientExpanded)" isAnimationActive={false} />
                  <Line yAxisId="area" type="monotone" dataKey="value" stroke="#174d57" strokeWidth={1.2} dot={false} activeDot={false} isAnimationActive={false} />
                  {selectedFloodDate && <ReferenceLine x={selectedFloodDate} stroke="#d2693c" strokeWidth={2} />}
                  {dragStart && dragEnd && <ReferenceArea x1={dragStart} x2={dragEnd} yAxisId="percent" fill="#6ca9b3" fillOpacity={0.22} strokeOpacity={0.45} />}
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="date-layer-builder">
              <label><span>Fecha seleccionada</span><select value={selectedFloodDate} onChange={(event) => setSelectedFloodDate(event.target.value)}><option value="">Seleccione una fecha</option>{expandedTimeline.map((item) => <option value={item.date} key={item.date}>{formatDate(item.date)}</option>)}</select></label>
              <button onClick={addFloodLayer} disabled={!selectedFloodDate}><CalendarPlus size={17} /> Mostrar inundación en el mapa</button>
            </div>
            <small className="flood-rule-note">Azul: segmento con inundación. Los segmentos sin inundación quedan transparentes.</small>
          </div>
        </div>
      )}
    </main>
  );
}
