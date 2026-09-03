// Stub for the 'three/webgpu' module specifier, aliased in vite.config.ts.
//
// three-render-objects.mjs unconditionally does `import { WebGPURenderer }
// from 'three/webgpu'` at module scope, even though this app never sets
// `useWebGPU: true` (see src/components/GlobeMap.ts's rendererConfig) and
// therefore never constructs it. Real 'three/webgpu' is ~585KB minified
// (~165KB gzip) and would otherwise ship in the GlobeMap chunk for nothing.
//
// This stub satisfies the import at build time but throws if the class is
// ever actually instantiated, so a wrong assumption here fails loudly
// instead of silently rendering a broken globe.
export class WebGPURenderer {
  constructor() {
    throw new Error(
      '[three-webgpu-stub] WebGPURenderer was instantiated, but this app ' +
      'never sets useWebGPU: true. If this fires, the dead-code analysis ' +
      'behind the vite.config.ts resolve.alias for three/webgpu was wrong ' +
      '— remove the alias and restore the real three/webgpu dependency.'
    );
  }
}

// three-globe.mjs also imports StorageInstancedBufferAttribute directly from
// 'three/webgpu' — same computeGeoKde-only reachability as WebGPURenderer
// above, same throw-on-construct treatment.
export class StorageInstancedBufferAttribute {
  constructor() {
    throw new Error(
      '[three-webgpu-stub] StorageInstancedBufferAttribute was instantiated, ' +
      'but this app never calls computeGeoKde (heatmapsData is always empty ' +
      'in GlobeMap.ts). If this fires, the dead-code analysis behind the ' +
      'vite.config.ts resolve.alias for three/webgpu was wrong — remove the ' +
      'alias and restore the real three/webgpu dependency.'
    );
  }
}

// three-globe.mjs's dead `computeGeoKde` (GPU heatmap kernel-density, only
// invoked for non-empty heatmapsData — GlobeMap.ts never sets it) reaches
// WebGPU through a second hop: `three/tsl` (node_modules/three/build/three.tsl.js)
// re-exports ~90 named bindings read off `TSL` imported from 'three/webgpu'.
// An empty object here makes every one of those re-exports `undefined`
// instead of a real value — harmless, since the only consumer destructuring
// them (computeGeoKde) is itself unreachable. Keeps the real three.tsl.js
// module intact (its own large export list stays a single source of truth)
// instead of also aliasing 'three/tsl' and re-deriving that list here.
export const TSL: Record<string, unknown> = {};
