/**
 * God's Eye View: photoreal-style 3D terrain mode embedded in the map.
 *
 * Mounts a Cesium viewer over the map container at the map's current camera, with
 * sensor looks (NVG/FLIR/CRT/noir) and the dashboard's live aircraft, military
 * flights and earthquakes. Cesium is a separate lazy chunk and self-hosted under
 * /cesium (see cesiumAssetsPlugin in vite.config.ts); nothing here runs until the
 * user opens the view.
 *
 * Adapted from the approach in github.com/bilawalsidhu/gods-eye-view (MIT,
 * Copyright (c) 2026 Bilawal Sidhu). Keyless on purpose: Esri World Imagery plus
 * Re:Earth terrain (CC BY 4.0). No provider key ships to the browser, per the
 * repo's VITE_ secret policy (scripts/check-vite-env-secrets.mjs).
 */
import './../styles/gods-eye.css';
import 'cesium/Build/Cesium/Widgets/widgets.css';
import { VectorTile } from '@mapbox/vector-tile';
import Protobuf from 'pbf';

export interface GodsEyePoint {
  id: string;
  lat: number;
  lon: number;
  /** Meters above the ellipsoid; 0 clamps visually to the surface. */
  altM?: number;
  label: string;
  kind: 'aircraft' | 'military' | 'quake';
  /** Marker size in px. */
  size?: number;
}

export interface GodsEyeOptions {
  lat: number;
  lon: number;
  /** MapLibre-style zoom of the map being left, used to match the starting height. */
  zoom: number;
  points: () => GodsEyePoint[];
  onClose: (view: { lat: number; lon: number; zoom: number }) => void;
}

type MapStyle = 'satellite' | 'road';
type Look = 'none' | 'nvg' | 'flir' | 'crt' | 'noir';
const LOOKS: Look[] = ['none', 'nvg', 'flir', 'crt', 'noir'];
const KIND_COLOR = { aircraft: '#4dd0ff', military: '#ff5a4d', quake: '#ffc247' } as const;
const MAPLIBRE_M_PER_PX_EQ = 78271.517; // 512px tiles at zoom 0
const FOV_FACTOR = 0.866; // height = visibleGround / (2 * tan(30deg)), Cesium default 60deg vertical FOV
const REEARTH_TERRAIN = 'https://terrain.reearth.land/cesium-mesh/ellipsoid';
const OPENFREEMAP_TILEJSON = 'https://tiles.openfreemap.org/planet';
const ESRI_LABELS = 'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer';
const ESRI_ROADS = 'https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer';
const BUILDING_ZOOM = 14;
const MAX_BUILDING_TILES = 60;
const ESRI_STREETS = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer';
const CREDITS: Record<MapStyle, string> = {
  satellite: 'Imagery \u00a9 Esri, Maxar, Earthstar Geographics',
  road: 'Map \u00a9 Esri, HERE, Garmin, OpenStreetMap contributors',
};
const CREDITS_COMMON = 'Buildings \u00a9 OpenStreetMap contributors, OpenFreeMap \u00b7 Terrain: Re:Earth / Mapterhorn (CC BY 4.0)';
const ESRI_IMAGERY = 'https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer';

export function zoomToHeight(zoom: number, lat: number, viewportPx: number): number {
  const h = (MAPLIBRE_M_PER_PX_EQ * Math.cos((lat * Math.PI) / 180) * viewportPx * FOV_FACTOR) / 2 ** zoom;
  return Math.min(Math.max(h, 250), 2.5e7);
}

export function heightToZoom(height: number, lat: number, viewportPx: number): number {
  const z = Math.log2((MAPLIBRE_M_PER_PX_EQ * Math.cos((lat * Math.PI) / 180) * viewportPx * FOV_FACTOR) / Math.max(height, 1));
  return Math.min(Math.max(z, 1), 18);
}

type CesiumNS = typeof import('cesium');

export class GodsEyeView {
  private readonly root = document.createElement('div');
  private readonly stage = document.createElement('div');
  private readonly hud = document.createElement('div');
  private readonly credits = document.createElement('div');
  private viewer: import('cesium').Viewer | null = null;
  private cesium: CesiumNS | null = null;
  private mapStyle: MapStyle = 'satellite';
  private baseLayer: import('cesium').ImageryLayer | null = null;
  private roadLayer: import('cesium').ImageryLayer | null = null;
  private overlayLayers: import('cesium').ImageryLayer[] = [];
  private readonly tileData = new Map<string, { polys: { ring: [number, number][]; top: number; base: number }[]; ground: number[] }>();
  private readonly tilePrims = new Map<string, import('cesium').Primitive>();
  private tileTemplate: string | null = null;
  private readonly builtTiles = new Set<string>();
  private pointTimer: ReturnType<typeof setInterval> | null = null;
  private closed = false;
  private look: Look = 'none';
  private readonly onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') this.close();
  };

  constructor(private readonly host: HTMLElement, private readonly opts: GodsEyeOptions) {}

  async open(): Promise<void> {
    const { root, stage, hud } = this;
    const status = document.createElement('div');
    const scan = document.createElement('div');
    const credits = this.credits;
    root.className = 'gev-root';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', "God's Eye View");
    stage.className = 'gev-stage';
    scan.className = 'gev-scan';
    credits.className = 'gev-credits';
    hud.className = 'gev-hud';
    status.className = 'gev-status';
    status.textContent = "Acquiring God's Eye…";
    root.append(stage, scan, this.buildBar(), hud, credits, this.buildFlirFilter(), status);
    this.host.appendChild(root);
    document.addEventListener('keydown', this.onKey);
    this.setCredits();

    try {
      (window as unknown as { CESIUM_BASE_URL?: string }).CESIUM_BASE_URL = '/cesium/';
      const Cesium = (this.cesium = await import('cesium'));
      if (this.closed) return;
      // Keyless build: make sure nothing falls back to Cesium ion.
      Cesium.Ion.defaultAccessToken = '';

      const [imagery, terrain] = await Promise.all([this.makeImagery(Cesium), this.makeTerrain(Cesium)]);
      if (this.closed) return;
      const viewer = (this.viewer = new Cesium.Viewer(stage, {
        baseLayer: imagery ? new Cesium.ImageryLayer(imagery) : false,
        terrainProvider: terrain,
        geocoder: false,
        baseLayerPicker: false,
        homeButton: false,
        sceneModePicker: false,
        navigationHelpButton: false,
        animation: false,
        timeline: false,
        fullscreenButton: false,
        infoBox: false,
        selectionIndicator: false,
        creditContainer: document.createElement('div'), // our own attribution line below replaces Cesium's widget
        requestRenderMode: false,
        msaaSamples: 1,
      }));
      viewer.scene.globe.depthTestAgainstTerrain = true;
      this.baseLayer = viewer.imageryLayers.get(0) ?? null;
      void this.addStreetLayer(Cesium, viewer);
      void this.addReferenceLayers(Cesium, viewer);
      this.placeCamera(Cesium, viewer);
      void this.loadBuildings();
      viewer.camera.moveEnd.addEventListener(() => void this.loadBuildings());
      this.pointTimer = setInterval(() => this.syncPoints(), 5000);
      this.syncPoints();
      viewer.scene.postRender.addEventListener(() => this.updateHud());
      status.hidden = true;
    } catch (err) {
      console.warn("[GodsEye] failed to start", err);
      status.textContent = "God's Eye View unavailable on this device";
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    const view = this.currentView();
    document.removeEventListener('keydown', this.onKey);
    if (this.pointTimer) clearInterval(this.pointTimer);
    try {
      this.viewer?.destroy(); // releases the WebGL context
    } catch {
      /* already torn down */
    }
    this.root.remove();
    this.opts.onClose(view);
  }

  private async makeImagery(C: CesiumNS) {
    try {
      return await C.ArcGisMapServerImageryProvider.fromUrl(ESRI_IMAGERY, {
        credit: 'Powered by Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
        enablePickFeatures: false,
      });
    } catch {
      return new C.OpenStreetMapImageryProvider({ url: 'https://tile.openstreetmap.org/', credit: '© OpenStreetMap contributors' });
    }
  }

  private async makeTerrain(C: CesiumNS) {
    try {
      return await C.CesiumTerrainProvider.fromUrl(REEARTH_TERRAIN, { credit: 'Terrain: Re:Earth / Mapterhorn (CC BY 4.0)' } as never);
    } catch {
      return new C.EllipsoidTerrainProvider();
    }
  }


  private async addStreetLayer(C: CesiumNS, viewer: import('cesium').Viewer): Promise<void> {
    try {
      const provider = await C.ArcGisMapServerImageryProvider.fromUrl(ESRI_STREETS, { enablePickFeatures: false });
      if (this.closed || viewer.isDestroyed()) return;
      this.roadLayer = viewer.imageryLayers.addImageryProvider(provider);
      this.roadLayer.show = this.mapStyle === 'road';
    } catch {
      /* road map unavailable: satellite stays */
    }
  }

  private setCredits(): void {
    this.credits.textContent = `${CREDITS[this.mapStyle]} \u00b7 ${CREDITS_COMMON}`;
  }

  /** Place names and roads over the satellite imagery. Best-effort. */
  private async addReferenceLayers(C: CesiumNS, viewer: import('cesium').Viewer): Promise<void> {
    for (const url of [ESRI_ROADS, ESRI_LABELS]) {
      try {
        const provider = await C.ArcGisMapServerImageryProvider.fromUrl(url, { enablePickFeatures: false });
        if (!this.closed && !viewer.isDestroyed()) {
          const layer = viewer.imageryLayers.addImageryProvider(provider);
          layer.show = this.mapStyle === 'satellite';
          this.overlayLayers.push(layer);
        }
      } catch {
        /* overlay is optional */
      }
    }
  }

  private async tileUrl(z: number, x: number, y: number): Promise<string | null> {
    if (!this.tileTemplate) {
      const res = await fetch(OPENFREEMAP_TILEJSON);
      const json = (await res.json()) as { tiles?: string[] };
      this.tileTemplate = json.tiles?.[0] ?? null;
    }
    return this.tileTemplate?.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y)) ?? null;
  }

  /** Extrude OSM buildings (OpenFreeMap vector tiles) around where the camera is looking. */
  private async loadBuildings(): Promise<void> {
    const C = this.cesium;
    const viewer = this.viewer;
    if (!C || !viewer || viewer.isDestroyed()) return;
    const { camera } = viewer;
    if (camera.positionCartographic.height > 20_000) return;
    const { lat, lon } = this.currentView();
    const n = 2 ** BUILDING_ZOOM;
    const cx = Math.floor(((lon + 180) / 360) * n);
    const latRad = (lat * Math.PI) / 180;
    const cy = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
    for (let dx = -2; dx <= 2; dx++) {
      for (let dy = -2; dy <= 2; dy++) {
        const key = `${cx + dx}/${cy + dy}`;
        if (this.builtTiles.has(key) || this.builtTiles.size >= MAX_BUILDING_TILES) continue;
        this.builtTiles.add(key);
        void this.buildTile(C, viewer, cx + dx, cy + dy).catch(() => this.builtTiles.delete(key));
      }
    }
  }

  private async buildTile(C: CesiumNS, viewer: import('cesium').Viewer, x: number, y: number): Promise<void> {
    const url = await this.tileUrl(BUILDING_ZOOM, x, y);
    if (!url) return;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`tile ${res.status}`);
    const layer = new VectorTile(new Protobuf(new Uint8Array(await res.arrayBuffer()))).layers.building;
    if (!layer) return;
    type Ring = [number, number][];
    const polys: { ring: Ring; top: number; base: number }[] = [];
    for (let i = 0; i < layer.length && polys.length < 2500; i++) {
      const f = layer.feature(i);
      if (f.type !== 3) continue;
      const geo = f.toGeoJSON(x, y, BUILDING_ZOOM).geometry;
      const coords = geo.coordinates as number[][][] | number[][][][];
      const outers = geo.type === 'Polygon' ? [(coords as number[][][])[0]] : geo.type === 'MultiPolygon' ? (coords as number[][][][]).map((poly) => poly[0]) : [];
      const top = Number(f.properties.render_height) || 8;
      const base = Number(f.properties.render_min_height) || 0;
      for (const ring of outers) if (ring && ring.length >= 4) polys.push({ ring: ring as Ring, top, base });
    }
    if (!polys.length || this.closed || viewer.isDestroyed()) return;
    // Sit each building on the terrain under its first vertex.
    const carto = polys.map((p) => C.Cartographic.fromDegrees(p.ring[0]?.[0] ?? 0, p.ring[0]?.[1] ?? 0));
    let ground = carto;
    try {
      ground = await C.sampleTerrainMostDetailed(viewer.terrainProvider, carto);
    } catch {
      /* flat terrain: height 0 */
    }
    if (this.closed || viewer.isDestroyed()) return;
    const key = `${x}/${y}`;
    this.tileData.set(key, { polys, ground: ground.map((g) => g.height || 0) });
    this.renderTile(C, viewer, key);
  }

  /** Building colour per map style: muted grey-blue over imagery, warm map-app palette on the road map. */
  private buildingColor(C: CesiumNS, top: number, style: MapStyle) {
    const tint = Math.min(top / 120, 1);
    return style === 'road'
      ? C.Color.fromHsl(0.07 - tint * 0.04, 0.45 + tint * 0.25, 0.8 - tint * 0.25, 0.97)
      : C.Color.fromHsl(0.58, 0.18 + tint * 0.2, 0.62 + tint * 0.18, 0.95);
  }

  private renderTile(C: CesiumNS, viewer: import('cesium').Viewer, key: string): void {
    const data = this.tileData.get(key);
    if (!data || viewer.isDestroyed()) return;
    const old = this.tilePrims.get(key);
    if (old) viewer.scene.primitives.remove(old);
    const instances = data.polys.map((p, i) => {
      const g = data.ground[i] ?? 0;
      return new C.GeometryInstance({
        geometry: new C.PolygonGeometry({
          polygonHierarchy: new C.PolygonHierarchy(C.Cartesian3.fromDegreesArray(p.ring.flat())),
          height: g + p.base,
          extrudedHeight: g + Math.max(p.top, p.base + 3),
          vertexFormat: C.PerInstanceColorAppearance.FLAT_VERTEX_FORMAT,
        }),
        attributes: { color: C.ColorGeometryInstanceAttribute.fromColor(this.buildingColor(C, p.top, this.mapStyle)) },
      });
    });
    const prim = new C.Primitive({ geometryInstances: instances, appearance: new C.PerInstanceColorAppearance({ flat: true, translucent: false }), asynchronous: true });
    viewer.scene.primitives.add(prim);
    this.tilePrims.set(key, prim);
  }

  private setMapStyle(style: MapStyle): void {
    const C = this.cesium;
    const viewer = this.viewer;
    this.mapStyle = style;
    this.setCredits();
    if (!C || !viewer || viewer.isDestroyed()) return;
    if (this.baseLayer) this.baseLayer.show = style === 'satellite';
    if (this.roadLayer) this.roadLayer.show = style === 'road';
    for (const l of this.overlayLayers) l.show = style === 'satellite';
    for (const key of this.tileData.keys()) this.renderTile(C, viewer, key);
  }

  private placeCamera(C: CesiumNS, viewer: import('cesium').Viewer): void {
    const { lat, lon, zoom } = this.opts;
    const height = zoomToHeight(zoom, lat, this.stage.clientHeight || window.innerHeight);
    const target = C.Cartesian3.fromDegrees(lon, lat, 0);
    // Match the 2D map first (straight down), then tilt into the oblique "god's eye" angle.
    viewer.camera.setView({ destination: C.Cartesian3.fromDegrees(lon, lat, height), orientation: { heading: 0, pitch: -C.Math.PI_OVER_TWO, roll: 0 } });
    viewer.camera.flyToBoundingSphere(new C.BoundingSphere(target, 0), {
      duration: 2.2,
      // Zoomed in already: descend to a low oblique so the 3D city is actually visible.
      offset: new C.HeadingPitchRange(0, C.Math.toRadians(-40), zoom >= 8 ? Math.min(Math.max(height * 0.85, 400), 3500) : Math.max(height * 0.85, 400)),
    });
  }

  private currentView(): { lat: number; lon: number; zoom: number } {
    const fallback = { lat: this.opts.lat, lon: this.opts.lon, zoom: this.opts.zoom };
    const C = this.cesium;
    const viewer = this.viewer;
    if (!C || !viewer || viewer.isDestroyed()) return fallback;
    const { scene, camera, canvas } = viewer;
    const mid = new C.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2);
    const hit = scene.pickPosition(mid) ?? camera.pickEllipsoid(mid, scene.globe.ellipsoid);
    if (!hit) return fallback;
    const carto = C.Cartographic.fromCartesian(hit);
    const lat = C.Math.toDegrees(carto.latitude);
    const lon = C.Math.toDegrees(carto.longitude);
    const range = C.Cartesian3.distance(camera.positionWC, hit);
    return { lat, lon, zoom: heightToZoom(range, lat, canvas.clientHeight) };
  }

  private syncPoints(): void {
    const C = this.cesium;
    const viewer = this.viewer;
    if (!C || !viewer || viewer.isDestroyed()) return;
    const pts = this.opts.points();
    viewer.entities.removeAll();
    for (const p of pts) {
      if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue;
      viewer.entities.add({
        id: `${p.kind}:${p.id}`,
        position: C.Cartesian3.fromDegrees(p.lon, p.lat, p.altM ?? 0),
        point: {
          pixelSize: p.size ?? 7,
          color: C.Color.fromCssColorString(KIND_COLOR[p.kind]),
          outlineColor: C.Color.BLACK.withAlpha(0.7),
          outlineWidth: 1,
          disableDepthTestDistance: p.kind === 'quake' ? 0 : Number.POSITIVE_INFINITY,
        },
        label: {
          text: p.label,
          font: '11px monospace',
          fillColor: C.Color.WHITE,
          style: C.LabelStyle.FILL_AND_OUTLINE,
          outlineWidth: 2,
          pixelOffset: new C.Cartesian2(0, -14),
          distanceDisplayCondition: new C.DistanceDisplayCondition(0, 60_000),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    }
  }

  private updateHud(): void {
    const C = this.cesium;
    const viewer = this.viewer;
    if (!C || !viewer || viewer.isDestroyed()) return;
    const c = viewer.camera.positionCartographic;
    const lat = C.Math.toDegrees(c.latitude);
    const lon = C.Math.toDegrees(c.longitude);
    const alt = c.height;
    const altText = alt >= 10_000 ? `${(alt / 1000).toFixed(0)} km` : `${alt.toFixed(0)} m`;
    this.hud.textContent = `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon).toFixed(4)}°${lon >= 0 ? 'E' : 'W'}  ALT ${altText}  HDG ${Math.round(C.Math.toDegrees(viewer.camera.heading))}°`;
  }

  private buildBar(): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'gev-bar';
    const title = document.createElement('div');
    title.className = 'gev-title';
    title.textContent = "God's Eye View";
    const spacer = document.createElement('div');
    spacer.className = 'gev-spacer';
    const styleBtns = (['satellite', 'road'] as MapStyle[]).map((st) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'gev-btn';
      b.textContent = st === 'satellite' ? 'Satellite' : 'Road map';
      b.setAttribute('aria-pressed', String(st === this.mapStyle));
      b.addEventListener('click', () => {
        this.setMapStyle(st);
        styleBtns.forEach((x, i) => x.setAttribute('aria-pressed', String((['satellite', 'road'] as MapStyle[])[i] === st)));
      });
      return b;
    });
    const sep = document.createElement('div');
    sep.className = 'gev-sep';
    const looks = LOOKS.map((look) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'gev-btn';
      b.textContent = look === 'none' ? 'Normal' : look;
      b.setAttribute('aria-pressed', String(look === this.look));
      b.addEventListener('click', () => {
        this.look = look;
        this.stage.dataset.look = look;
        this.root.dataset.look = look;
        looks.forEach((x, i) => x.setAttribute('aria-pressed', String(LOOKS[i] === look)));
      });
      return b;
    });
    const exit = document.createElement('button');
    exit.type = 'button';
    exit.className = 'gev-btn';
    exit.textContent = 'Exit ✕';
    exit.title = 'Back to the map (Esc)';
    exit.addEventListener('click', () => this.close());
    bar.append(title, spacer, ...styleBtns, sep, ...looks, exit);
    return bar;
  }

  /** Ironbow-style thermal ramp, referenced by the FLIR look. */
  private buildFlirFilter(): SVGSVGElement {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', '0');
    svg.setAttribute('height', '0');
    svg.setAttribute('aria-hidden', 'true');
    svg.style.position = 'absolute';
    const filter = document.createElementNS(ns, 'filter');
    filter.id = 'gev-flir';
    const gray = document.createElementNS(ns, 'feColorMatrix');
    gray.setAttribute('type', 'matrix');
    gray.setAttribute('values', '0.33 0.33 0.33 0 0  0.33 0.33 0.33 0 0  0.33 0.33 0.33 0 0  0 0 0 1 0');
    const ramp = document.createElementNS(ns, 'feComponentTransfer');
    const channel = (tag: 'feFuncR' | 'feFuncG' | 'feFuncB', values: string) => {
      const f = document.createElementNS(ns, tag);
      f.setAttribute('type', 'table');
      f.setAttribute('tableValues', values);
      ramp.appendChild(f);
    };
    channel('feFuncR', '0 0.2 0.5 0.85 1 1');
    channel('feFuncG', '0 0 0.1 0.45 0.85 1');
    channel('feFuncB', '0 0.35 0.45 0.2 0.1 0.9');
    filter.append(gray, ramp);
    svg.appendChild(filter);
    return svg;
  }
}
