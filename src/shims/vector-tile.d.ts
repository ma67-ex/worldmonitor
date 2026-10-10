// Minimal types for the MVT decoders used by GodsEyeView (no @types packages installed).
declare module 'pbf' {
  export default class Protobuf {
    constructor(buf?: Uint8Array);
  }
}
declare module '@mapbox/vector-tile' {
  import type Protobuf from 'pbf';
  interface VTFeature {
    type: number;
    properties: Record<string, unknown>;
    toGeoJSON(x: number, y: number, z: number): {
      geometry: { type: string; coordinates: number[][][] | number[][][][] };
    };
  }
  interface VTLayer {
    length: number;
    feature(i: number): VTFeature;
  }
  export class VectorTile {
    constructor(pbf: Protobuf);
    layers: Record<string, VTLayer | undefined>;
  }
}
