// Re-signs the built macOS bundle so every binary in it shares one code identity.
//
// Why: macOS privacy permissions (Local Network, etc.) are keyed to a binary's code
// identity. Tauri ad-hoc signs each sidecar with a random identifier
// ("backend-5555…"), so the permission a user grants "Beacon" doesn't cover the
// backend that actually sends requests, and LAN calls fail with "No route to host".
// Signing every binary as com.beacon.app makes the grant apply to all of them.
//
// Runs after `tauri build`; rebuilds the DMG and the updater archive from the
// re-signed .app because Tauri packed both from the old signatures.
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

if (process.platform !== 'darwin') process.exit(0)

const conf = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src-tauri', 'tauri.conf.json'), 'utf8'))
const IDENTITY = process.env.APPLE_SIGNING_IDENTITY || conf.bundle?.macOS?.signingIdentity || '-'
const ID = conf.identifier
const bundleDir = path.join(__dirname, '..', 'src-tauri', 'target', 'release', 'bundle')
const app = path.join(bundleDir, 'macos', `${conf.productName}.app`)
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' })

if (!fs.existsSync(app)) {
  console.error(`sign-macos: ${app} not found; run tauri build first`)
  process.exit(1)
}

// Inner binaries first, then the bundle, so the outer seal covers the new signatures.
const macos = path.join(app, 'Contents', 'MacOS')
for (const name of fs.readdirSync(macos)) {
  run('codesign', ['--force', '--sign', IDENTITY, '--identifier', ID, path.join(macos, name)])
}
run('codesign', ['--force', '--sign', IDENTITY, '--identifier', ID, app])
run('codesign', ['--verify', '--deep', '--strict', app])

// Updater archive: re-pack and re-sign it so updates ship the shared identity too.
const tarball = `${app}.tar.gz`
if (fs.existsSync(tarball)) {
  run('tar', ['-czf', tarball, '-C', path.dirname(app), path.basename(app)])
  if (process.env.TAURI_SIGNING_PRIVATE_KEY || process.env.TAURI_SIGNING_PRIVATE_KEY_PATH) {
    run('npx', ['tauri', 'signer', 'sign', tarball])
  } else {
    // A stale .sig would make the updater reject the new archive, so remove it.
    fs.rmSync(`${tarball}.sig`, { force: true })
    console.warn('sign-macos: no TAURI_SIGNING_PRIVATE_KEY; updater archive left unsigned')
  }
}

// DMG: rebuild from the re-signed .app.
const dmgDir = path.join(bundleDir, 'dmg')
if (fs.existsSync(dmgDir)) {
  for (const dmg of fs.readdirSync(dmgDir).filter((f) => f.endsWith('.dmg'))) {
    const out = path.join(dmgDir, dmg)
    const stage = fs.mkdtempSync(path.join(dmgDir, '.stage-'))
    run('ditto', [app, path.join(stage, path.basename(app))])
    fs.symlinkSync('/Applications', path.join(stage, 'Applications'))
    fs.rmSync(out, { force: true })
    run('hdiutil', ['create', '-volname', conf.productName, '-srcfolder', stage, '-ov', '-format', 'UDZO', out])
    fs.rmSync(stage, { recursive: true, force: true })
  }
}

console.log(`sign-macos: signed ${app} as ${ID} (${IDENTITY === '-' ? 'ad-hoc' : IDENTITY})`)
