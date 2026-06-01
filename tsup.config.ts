import { defineConfig } from 'tsup';

export default defineConfig([
    // ── npm build: dual ESM + CJS (+ types) ──────────────────────────────
    // fix-webm-duration stays EXTERNAL here (it's a declared dependency that a
    // consumer's bundler resolves/dedupes).
    {
        entry: ['src/index.ts'],
        format: ['esm', 'cjs'],
        outExtension({ format }) {
            // ESM stays `.esm.js` (valid ESM under "type":"module").
            // CJS must be `.cjs` so Node always treats it as CommonJS,
            // otherwise "type":"module" makes Node load it as ESM and require() returns {}.
            return { js: format === 'esm' ? '.esm.js' : '.cjs' };
        },
        dts: true,
        // No source maps in the published build — src/ isn't shipped, so maps would
        // be dead weight (~60% of the tarball). Set CF_SOURCEMAP=1 for local debugging.
        sourcemap: !!process.env.CF_SOURCEMAP,
        clean: true,
        splitting: false,
        treeshake: true,
        minify: false,
        outDir: 'dist',
        target: 'es2020',
    },
    // ── CDN build: one self-contained minified IIFE exposing window.CapturFlow ─
    // fix-webm-duration is INLINED (noExternal) so a plain <script> works with no
    // module resolver. Produces dist/index.global.js.
    {
        entry: ['src/index.ts'],
        format: ['iife'],
        globalName: 'CapturFlow',
        noExternal: ['fix-webm-duration'],
        dts: false,
        sourcemap: false,
        clean: false,        // keep the ESM/CJS output from the first config
        minify: true,
        treeshake: true,
        outDir: 'dist',
        target: 'es2020',
    },
]);
