import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const cargoToml = await readFile(
  new URL("../frontend/src-tauri/Cargo.toml", import.meta.url),
  "utf8",
);
const mainRs = await readFile(
  new URL("../frontend/src-tauri/src/main.rs", import.meta.url),
  "utf8",
);
const releaseWorkflow = await readFile(
  new URL("../.github/workflows/release-desktop.yml", import.meta.url),
  "utf8",
);
const frontendPackage = JSON.parse(
  await readFile(new URL("../frontend/package.json", import.meta.url), "utf8"),
);

test("desktop release does not compile with the Tauri devtools feature", () => {
  assert.doesNotMatch(
    cargoToml,
    /tauri\s*=\s*\{[^}]*features\s*=\s*\[[^\]]*"devtools"/s,
  );
});

test("automatic DevTools opening is limited to debug builds", () => {
  assert.match(
    mainRs,
    /#\[cfg\(debug_assertions\)\]\s*\{\s*if let Some\(window\) = app\.get_webview_window\("main"\) \{\s*window\.open_devtools\(\);\s*\}\s*\}/s,
  );
});

test("desktop release builds and publishes Linux packages", () => {
  assert.match(frontendPackage.scripts["desktop:build:linux"], /--bundles deb,appimage/);
  assert.match(releaseWorkflow, /^  build-linux:/m);
  assert.match(releaseWorkflow, /needs: \[build, build-macos, build-linux\]/);
  assert.match(releaseWorkflow, /add_platform "linux-x86_64"/);
  assert.match(releaseWorkflow, /artifacts\/\*\*\/\*\.AppImage/);
  assert.match(releaseWorkflow, /artifacts\/\*\*\/\*\.deb/);
});
