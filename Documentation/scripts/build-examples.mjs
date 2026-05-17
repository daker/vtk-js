#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { build as viteBuild } from 'vite';

import { createVtkPlugins } from '../../Utilities/build/plugins.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DOCS_ROOT = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(DOCS_ROOT, '..');
const SOURCES_ROOT = path.resolve(REPO_ROOT, 'Sources');
const EXAMPLES_ROOT = path.resolve(REPO_ROOT, 'Examples');

const EXAMPLE_SOURCES = [
  {
    root: SOURCES_ROOT,
    shouldSkipDir: (relDir) =>
      relDir === 'Testing' || relDir.startsWith('Testing/'),
    isExampleFile: (relPath) => /\/example\/index\.js$/.test(relPath),
    getExampleName: (fullPath) =>
      path.basename(path.dirname(path.dirname(fullPath))),
  },
  {
    root: EXAMPLES_ROOT,
    shouldSkipDir: () => false,
    isExampleFile: (relPath) => {
      const segments = relPath.split('/');
      return segments.length === 3 && segments[2] === 'index.js';
    },
    getExampleName: (fullPath) => path.basename(path.dirname(fullPath)),
  },
];

function buildHtml(
  exampleName,
  bundleFile,
  isModule = false,
  inlineScript = null
) {
  let exampleScript = `<script src="${bundleFile}"></script>`;
  if (isModule) {
    exampleScript = `<script type="module" src="${bundleFile}"></script>`;
  }
  if (inlineScript) {
    exampleScript = isModule
      ? `<script type="module">${inlineScript}</script>`
      : `<script>${inlineScript}</script>`;
  }

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>VTK.js | Example - ${exampleName}</title>
    <style>
      html, body { margin: 0; padding: 0; height: 100%; }
      body { font-family: sans-serif; }
    </style>
  </head>
  <body>
    <div id="vtk-root" style="height:100%; width:100%;"></div>
    <script>
      window.global = window.global || {};
    </script>
    ${exampleScript}
  </body>
</html>
`;
}

async function walkExamples(config, dir = config.root, results = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const relDir = path
          .relative(config.root, fullPath)
          .replace(/\\/g, '/');
        if (relDir && config.shouldSkipDir(relDir)) {
          return;
        }
        await walkExamples(config, fullPath, results);
      } else if (entry.name === 'index.js') {
        const relPath = path
          .relative(config.root, fullPath)
          .replace(/\\/g, '/');
        if (!config.isExampleFile(relPath)) return;
        const exampleName = config.getExampleName(fullPath, relPath);
        results.push({
          name: exampleName,
          entryPath: fullPath,
        });
      }
    })
  );
  return results;
}

async function collectEntries() {
  const entriesByRoot = await Promise.all(
    EXAMPLE_SOURCES.map((config) => walkExamples(config))
  );
  const entries = {};
  entriesByRoot.flat().forEach(({ name, entryPath }) => {
    entries[name] = entryPath;
  });
  return entries;
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimeByExt = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
  };
  return mimeByExt[ext] || 'application/octet-stream';
}

function toDataUri(filePath, source) {
  return `data:${getMimeType(filePath)};base64,${source.toString('base64')}`;
}

/**
 * Inline CSS url() references as data URIs.
 * Required because cssRuntimePlugin converts CSS to JS strings,
 * so relative url() paths would no longer resolve at runtime.
 */
async function inlineCssAssetUrls(code, id) {
  const urlRegex = /url\((['"]?)([^'")]+)\1\)/g;
  const matches = Array.from(code.matchAll(urlRegex));
  if (!matches.length) {
    return code;
  }

  const replacements = await Promise.all(
    matches.map(async ([fullMatch, quote, rawUrl]) => {
      const assetUrl = rawUrl.trim();
      if (
        assetUrl.startsWith('data:') ||
        assetUrl.startsWith('http://') ||
        assetUrl.startsWith('https://') ||
        assetUrl.startsWith('//')
      ) {
        return { fullMatch, replacement: fullMatch };
      }

      const assetPath = path.resolve(path.dirname(id), assetUrl);
      try {
        const source = await fs.readFile(assetPath);
        const dataUrl = toDataUri(assetPath, source);
        return {
          fullMatch,
          replacement: `url(${quote}${dataUrl}${quote})`,
        };
      } catch (err) {
        return { fullMatch, replacement: fullMatch };
      }
    })
  );

  let transformed = code;
  replacements.forEach(({ fullMatch, replacement }) => {
    transformed = transformed.replace(fullMatch, replacement);
  });
  return transformed;
}

/**
 * Convert CSS imports to JS that injects <style> tags at runtime.
 * Needed so standalone example HTML files work with a single <script> tag.
 */
function cssRuntimePlugin() {
  const cssFileRegex = /\.css$/i;
  const cssModuleRegex = /\.module\.css$/i;
  const VIRTUAL_PREFIX = '\0vtk-css-runtime:';
  const classNameRegex = /\.([A-Za-z_][\w-]*)/g;

  function toCamelCase(value) {
    return value.replace(/-+([a-zA-Z0-9])/g, (_, c) => c.toUpperCase());
  }

  function transformCssModule(css, fileId) {
    const fileBase = path
      .basename(fileId, '.css')
      .replace(/\./g, '-')
      .replace(/[^A-Za-z0-9_-]/g, '_');
    const classMap = {};
    const composesMap = {};

    for (const match of css.matchAll(classNameRegex)) {
      const original = match[1];
      if (classMap[original]) {
        continue;
      }

      const hash = crypto
        .createHash('sha256')
        .update(`${fileId}:${original}`)
        .digest('base64url')
        .slice(0, 5);
      classMap[original] = `${fileBase}_${original}_${hash}`;
    }

    const ruleRegex = /\.([A-Za-z_][\w-]*)\s*\{([^}]*)\}/g;
    for (const [, ownerClass, ruleBody] of css.matchAll(ruleRegex)) {
      const composedClasses = [];
      const composesRegex = /composes:\s*([^;]+);/g;
      for (const [, composesValue] of ruleBody.matchAll(composesRegex)) {
        const localNames = composesValue
          .split(/\s+/)
          .map((v) => v.trim())
          .filter((v) => v && v !== 'from' && !v.startsWith("'") && !v.startsWith('"'));
        localNames.forEach((name) => {
          if (classMap[name] && name !== ownerClass) {
            composedClasses.push(name);
          }
        });
      }
      if (composedClasses.length) {
        composesMap[ownerClass] = [...new Set(composedClasses)];
      }
    }

    let transformedCss = css.replace(/composes:\s*[^;]+;/g, '');
    const escapedKeys = Object.keys(classMap).sort((a, b) => b.length - a.length);
    escapedKeys.forEach((original) => {
      const escaped = original.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      transformedCss = transformedCss.replace(
        new RegExp(`\\.${escaped}(?![\\w-])`, 'g'),
        `.${classMap[original]}`
      );
    });

    const moduleMap = {};
    const resolveComposed = (className, seen = new Set()) => {
      if (seen.has(className)) return [];
      seen.add(className);
      const direct = composesMap[className] || [];
      return direct.flatMap((dep) => [dep, ...resolveComposed(dep, seen)]);
    };

    Object.entries(classMap).forEach(([original, scoped]) => {
      const composedScoped = resolveComposed(original)
        .map((name) => classMap[name])
        .filter(Boolean);
      const exportValue = [scoped, ...composedScoped].join(' ');
      moduleMap[original] = exportValue;
      moduleMap[toCamelCase(original)] = exportValue;
    });

    return { css: transformedCss, moduleMap };
  }

  return {
    name: 'vtk-css-runtime',
    enforce: 'pre',
    async resolveId(source, importer) {
      if (!cssFileRegex.test(source)) {
        return null;
      }

      const resolved = await this.resolve(source, importer, { skipSelf: true });
      if (!resolved) {
        return null;
      }

      return `${VIRTUAL_PREFIX}${Buffer.from(resolved.id).toString('base64url')}`;
    },
    async load(id) {
      if (!id.startsWith(VIRTUAL_PREFIX)) {
        return null;
      }

      const fileId = Buffer.from(
        id.slice(VIRTUAL_PREFIX.length),
        'base64url'
      ).toString('utf8');
      const rawCss = await fs.readFile(fileId, 'utf8');
      const inlinedCss = await inlineCssAssetUrls(rawCss, fileId);
      const styleId = `vtk-css:${path
        .relative(REPO_ROOT, fileId)
        .replace(/\\/g, '/')}`;
      let css = inlinedCss;
      let moduleMap = {};

      if (cssModuleRegex.test(fileId)) {
        const transformed = transformCssModule(inlinedCss, fileId);
        css = transformed.css;
        moduleMap = transformed.moduleMap;
      }

      return `
const css = ${JSON.stringify(css)};
if (typeof document !== 'undefined' && !document.querySelector('style[data-vtk-css-id="${styleId}"]')) {
  const style = document.createElement('style');
  style.setAttribute('data-vtk-css-id', ${JSON.stringify(styleId)});
  style.textContent = css;
  document.head.appendChild(style);
}
export default ${JSON.stringify(moduleMap)};
`;
    },
  };
}

async function walkFiles(dir, results = []) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walkFiles(fullPath, results);
      } else {
        results.push(fullPath);
      }
    })
  );
  return results;
}

async function copyApplicationStaticAssets(entryPath, outDir) {
  const sourceDir = path.dirname(entryPath);
  const assetRegex = /\.(png|jpe?g|gif|svg|webp)$/i;
  const files = await walkFiles(sourceDir);

  await Promise.all(
    files
      .filter((filePath) => assetRegex.test(filePath))
      .map(async (filePath) => {
        const relPath = path.relative(sourceDir, filePath);
        const destPath = path.resolve(outDir, relPath);
        await fs.mkdir(path.dirname(destPath), { recursive: true });
        await fs.copyFile(filePath, destPath);
      })
  );
}

/**
 * Shared Vite config for building doc examples.
 */
function createSharedViteConfig() {
  return {
    configFile: false,
    root: REPO_ROOT,
    logLevel: 'warn',
    resolve: {
      alias: {
        '@kitware/vtk.js': path.resolve(REPO_ROOT, 'Sources'),
        'vtk.js': REPO_ROOT,
      },
    },
    define: {
      __BASE_PATH__: JSON.stringify('/vtk-js'),
    },
    css: {
      modules: {
        localsConvention: 'camelCaseOnly',
      },
    },
  };
}

function createExamplePlugins() {
  return [...createVtkPlugins({ includeCjson: true }), cssRuntimePlugin()];
}

async function build() {
  const entries = await collectEntries();
  const distDir = path.resolve(DOCS_ROOT, '.vitepress', 'dist', 'examples');

  await fs.mkdir(distDir, { recursive: true });

  const applicationEntries = {};
  const esEntries = {};

  Object.entries(entries).forEach(([chunkName, entryPath]) => {
    const relPath = path.relative(REPO_ROOT, entryPath).replace(/\\/g, '/');
    console.log(`Processing example: ${chunkName} (${relPath})`);
    if (relPath.startsWith('Examples/Applications/')) {
      applicationEntries[chunkName] = entryPath;
    } else {
      esEntries[chunkName] = entryPath;
    }
  });

  // Build ES module examples
  if (Object.keys(esEntries).length) {
    await viteBuild({
      ...createSharedViteConfig(),
      plugins: createExamplePlugins(),
      build: {
        outDir: distDir,
        emptyOutDir: false,
        minify: false,
        rollupOptions: {
          input: esEntries,
          output: {
            format: 'es',
            entryFileNames: '[name]/index.js',
            chunkFileNames: '_shared/[name]-[hash].js',
            assetFileNames: '_assets/[name]-[hash][extname]',
          },
        },
      },
    });

    await Promise.all(
      Object.entries(esEntries).map(async ([chunkName, entryPath]) => {
        const outDir = path.resolve(distDir, chunkName);
        await fs.mkdir(outDir, { recursive: true });
        await copyApplicationStaticAssets(entryPath, outDir);
      })
    );
  }

  // Build Application examples (single file inline bundles)
  for (const [chunkName, entryPath] of Object.entries(applicationEntries)) {
    const outDir = path.resolve(distDir, chunkName);
    await fs.mkdir(outDir, { recursive: true });

    const result = await viteBuild({
      ...createSharedViteConfig(),
      plugins: createExamplePlugins(),
      build: {
        write: false,
        minify: 'esbuild',
        assetsInlineLimit: Infinity,
        rollupOptions: {
          input: entryPath,
          output: {
            format: 'es',
            codeSplitting: false,
          },
        },
      },
    });

    const output = Array.isArray(result) ? result[0].output : result.output;
    const appChunk = output.find((item) => item.type === 'chunk');
    if (!appChunk) {
      throw new Error(`Failed to generate inline module for ${chunkName}`);
    }

    const inlineScript = appChunk.code.replace(/<\/script>/gi, '<\\/script>');
    await fs.writeFile(
      path.resolve(outDir, 'index.html'),
      buildHtml(chunkName, './index.js', true, inlineScript),
      'utf8'
    );
  }

  // Write HTML wrappers for ES module examples
  await Promise.all(
    Object.keys(entries).map(async (chunkName) => {
      if (Object.hasOwn(applicationEntries, chunkName)) {
        return;
      }

      const outDir = path.resolve(distDir, chunkName);
      await fs.mkdir(outDir, { recursive: true });
      await fs.writeFile(
        path.resolve(outDir, 'index.html'),
        buildHtml(chunkName, './index.js', true),
        'utf8'
      );
    })
  );

  console.log(`Built ${Object.keys(entries).length} example(s) in ${distDir}`);

  const dataSrc = path.resolve(REPO_ROOT, 'Data');
  const dataDest = path.resolve(DOCS_ROOT, '.vitepress', 'dist', 'data');
  try {
    await fs.access(dataSrc);
    await fs.mkdir(dataDest, { recursive: true });
    await fs.cp(dataSrc, dataDest, { recursive: true, force: true });
    console.log(`Copied Data assets to ${dataDest}`);
  } catch (err) {
    console.warn(`Skipping Data copy: ${err.message}`);
  }
}

build().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
