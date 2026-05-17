import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';
import path from 'path';
import { createVtkPlugins } from './Utilities/build/plugins.mjs';

const noWebGL = !!process.env.NO_WEBGL;
const webGPU = !!process.env.WEBGPU;
const testBrowser = process.env.TEST_BROWSER || 'chromium';
const ci = !!process.env.CI;

function buildBrowserInstances() {
  if (ci) {
    console.log('Running tests in CI mode');
    return [
      {
        browser: 'chromium',
        launch: {
          headless: true,
          args: ["--headless=new", "--no-sandbox", "--enable-unsafe-swiftshader", "--use-angle=swiftshader"],
        },
      },
      { browser: 'firefox', launch: { headless: true } },
    ];
  }
  const launchOptions = {
    firefoxUserPrefs: {
      // GitHub Actions does not have WebGPU for Firefox, throws UnsupportedError.
      'dom.webgpu.enabled': true,
      'webgl.force-enabled': true
    }
  };
  return [{ browser: testBrowser, launch: launchOptions }];
}

export default defineConfig({
  resolve: {
    alias: {
      'vtk.js': path.resolve(import.meta.dirname),
    },
  },
  optimizeDeps: {
    include: ['webworker-promise/lib/register'],
  },
  css: {
    modules: {
      localsConvention: 'camelCaseOnly',
    },
  },
  define: {
    __BASE_PATH__: JSON.stringify(''),
    __VTK_TEST_NO_WEBGL__: JSON.stringify(noWebGL),
    __VTK_TEST_WEBGPU__: JSON.stringify(webGPU),
    global: 'globalThis',
  },
  plugins: createVtkPlugins({
    includeCjson: true,
    includeStaticData: true,
    staticDataRootDir: import.meta.dirname,
  }),
  test: {
    include: ['Sources/**/test*.js'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'Sources/Testing/testUtils.js',
      'Sources/Testing/setupTestEnv.js',
    ],
    setupFiles: ['Sources/Testing/setupTestEnv.js'],
    testTimeout: 120000,
    reporters: ['default', 'junit'],
    outputFile: {
      junit: 'Utilities/TestResults/junit-report.xml',
    },
    fileParallelism: false, // GPU tests should run sequentially
    maxWorkers: 1, // Single worker for GPU resource management
    retry: ci ? 1 : 0,
    allowOnly: !ci,
    browser: {
      enabled: true,
      provider: playwright(),
      instances: buildBrowserInstances(),
    },
  },
});
