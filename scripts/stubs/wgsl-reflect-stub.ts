// Stub for the 'wgsl_reflect' module specifier, aliased in vite.config.ts.
//
// @luma.gl/shadertools's getShaderLayoutFromWGSL (lib/wgsl/get-shader-layout-wgsl.js)
// imports `WgslReflect` from 'wgsl_reflect' at module scope, but that function
// is only reachable through a WebGPU device adapter — @luma.gl/webgpu is not
// a dependency of this project (grep -rn "@luma.gl/webgpu|WebGPUDevice" src
// is empty). Real 'wgsl_reflect' is ~192KB minified (~45KB gzip) and would
// otherwise ship in the conflict-zone-cull chunk for nothing.
//
// This stub satisfies the import at build time but throws if the class is
// ever actually instantiated, so a wrong assumption here fails loudly
// instead of silently returning a broken shader layout.
export class WgslReflect {
  constructor() {
    throw new Error(
      '[wgsl-reflect-stub] WgslReflect was instantiated, but this app has ' +
      'no WebGPU device path (@luma.gl/webgpu is not a dependency). If ' +
      'this fires, the dead-code analysis behind the vite.config.ts ' +
      'resolve.alias for wgsl_reflect was wrong — remove the alias and ' +
      'restore the real wgsl_reflect dependency.'
    );
  }
}
