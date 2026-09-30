/**
 * Build `lib/plugin.js` by bundling schemastery into the plugin output.
 *
 * The Harness loader imports the published `main`, so the bundled entry is what
 * runs in a profile: composing the schema dependency in keeps the install a
 * plain `dsh plugin add` with nothing to resolve at load time. `lib/index.js`
 * stays the readable source and the module the tests import.
 */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Resolve a locally installed esbuild, tolerating a checkout without one. */
async function loadEsbuild() {
  try {
    return await import('esbuild')
  } catch {
    const candidates = [
      join(process.cwd(), 'node_modules', 'esbuild', 'lib', 'main.js'),
      join(import.meta.dirname, '..', 'deepseek-harness', 'node_modules', '.pnpm', 'esbuild@0.21.5', 'node_modules', 'esbuild', 'lib', 'main.js'),
    ]
    const fallback = candidates.find((candidate) => existsSync(candidate))
    if (fallback === undefined) throw new Error('build: no esbuild found; run `npm i -D esbuild` in this package')
    return await import(pathToFileURL(fallback).href)
  }
}

const esbuild = await loadEsbuild()

await esbuild.build({
  entryPoints: ['lib/index.js'],
  outfile: 'lib/plugin.js',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  packages: 'external',
  logLevel: 'info',
})
