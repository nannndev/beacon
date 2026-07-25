const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

test('uses BEACON_PYTHON for the backend build', () => {
  const script = path.join(__dirname, 'prepare-desktop.cjs');
  const configuredPython = 'beacon-configured-python';
  const result = spawnSync(process.execPath, [script], {
    encoding: 'utf8',
    env: { ...process.env, PATH: '', BEACON_PYTHON: configuredPython },
  });
  const output = `${result.stdout}${result.stderr}`;

  assert.match(output, new RegExp(`using ${escapeRegExp(configuredPython)}`));
});

test('defines a macOS desktop build that emits an app and DMG', () => {
  const packageJson = require('../package.json');
  assert.match(
    packageJson.scripts['desktop:build:mac'],
    /desktop:prepare.*tauri:build -- --bundles app,dmg/,
  );
});

test('defines a Linux desktop build that emits deb and AppImage packages', () => {
  const packageJson = require('../package.json');
  assert.match(
    packageJson.scripts['desktop:build:linux'],
    /desktop:prepare.*tauri:build -- --bundles deb,appimage/,
  );
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
