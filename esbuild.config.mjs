/* ============================================================================
 *  NEXUS SUITE — build config
 *
 *  Bundles src/ into a SINGLE main.js (+ styles.css) so Obsidian's one-file
 *  plugin loader is happy and mobile stays intact (no runtime require of
 *  sibling files). CommonJS throughout — each src module uses require()/
 *  module.exports and esbuild resolves the local graph.
 *
 *    npm run dev     → watch mode, inline sourcemap, rebuild on save
 *    npm run build   → one production build, minified-ish, no sourcemap
 * ==========================================================================*/
import esbuild from 'esbuild';
import { existsSync } from 'fs';

const MODE = process.argv[2] || 'build';          // build | watch | production
const prod = MODE === 'production';
const watch = MODE === 'watch' || MODE === 'dev';

// Node builtins used behind desktop-only try/catch guards — keep them as
// runtime require() (Electron resolves them; mobile throws and is caught).
const NODE_BUILTINS = [
  'fs', 'path', 'os', 'crypto', 'child_process', 'util', 'events',
  'stream', 'http', 'https', 'url', 'zlib', 'net', 'tls', 'assert',
  'buffer', 'process',
];

const entryPoints = { main: 'src/main.js' };
if (existsSync('src/styles/index.css')) entryPoints.styles = 'src/styles/index.css';

/** @type {import('esbuild').BuildOptions} */
const opts = {
  entryPoints,
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2018',
  outdir: '.',
  logLevel: 'info',
  // dev: external .map (keeps the synced main.js small; devtools still maps to src/)
  sourcemap: prod ? false : 'linked',
  minify: prod,
  treeShaking: true,
  external: [
    'obsidian',
    'electron',
    '@codemirror/*',
    '@lezer/*',
    ...NODE_BUILTINS,
  ],
};

if (watch) {
  const ctx = await esbuild.context(opts);
  await ctx.watch();
  console.log('[nexus-suite] esbuild watching src/ … (Ctrl-C zum Beenden)');
} else {
  await esbuild.build(opts);
  console.log(`[nexus-suite] build fertig (${prod ? 'production' : 'dev'}).`);
}
