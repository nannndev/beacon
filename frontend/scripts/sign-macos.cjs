// Re-signs the built macOS bundle so every binary in it shares one code identity,
// and with a Developer ID also notarizes it.
//
// Why: macOS privacy permissions (Local Network, etc.) are keyed to a binary's code
// identity. Tauri ad-hoc signs each sidecar with a random identifier
// ("backend-5555…"), so the permission a user grants "Beacon" doesn't cover the
// backend that actually sends requests, and LAN calls fail with "No route to host".
// Signing every binary as com.beacon.app makes the grant apply to all of them.
//
// Identity: BEACON_SIGNING_IDENTITY (e.g. "Developer ID Application: … (TEAMID)"),
// else ad-hoc ("-"). A Developer ID build is also notarized when credentials exist:
//   local: BEACON_NOTARY_PROFILE, a `notarytool store-credentials` Keychain profile
//   CI:    BEACON_NOTARY_KEY + BEACON_NOTARY_ISSUER + BEACON_NOTARY_KEY_PATH (API key)
// Not APPLE_*: `tauri build` reads those itself and would sign and notarize the
// bundle before this script re-signs it, wasting a notarization round trip.
//
// Runs after `tauri build`; rebuilds the DMG and the updater archive from the
// re-signed .app because Tauri packed both from the old signatures.
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

if (process.platform !== 'darwin') process.exit(0)

const conf = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src-tauri', 'tauri.conf.json'), 'utf8'))
const IDENTITY = process.env.BEACON_SIGNING_IDENTITY || conf.bundle?.macOS?.signingIdentity || '-'
const ADHOC = IDENTITY === '-'
const ID = conf.identifier
const bundleDir = path.join(__dirname, '..', 'src-tauri', 'target', 'release', 'bundle')
const app = path.join(bundleDir, 'macos', `${conf.productName}.app`)
const run = (cmd, args) => execFileSync(cmd, args, { stdio: 'inherit' })

if (!fs.existsSync(app)) {
  console.error(`sign-macos: ${app} not found; run tauri build first`)
  process.exit(1)
}

// Notarization requires the hardened runtime and a secure timestamp; ad-hoc builds
// skip both (no timestamp server for "-", and the runtime gains nothing unsigned).
const signArgs = (target) => [
  '--force', '--sign', IDENTITY, '--identifier', ID,
  ...(ADHOC ? [] : ['--options', 'runtime', '--timestamp']),
  target,
]

// Inner binaries first, then the bundle, so the outer seal covers the new signatures.
const macos = path.join(app, 'Contents', 'MacOS')
for (const name of fs.readdirSync(macos)) run('codesign', signArgs(path.join(macos, name)))
run('codesign', signArgs(app))
run('codesign', ['--verify', '--deep', '--strict', app])

function notaryAuth() {
  const { BEACON_NOTARY_PROFILE, BEACON_NOTARY_KEY, BEACON_NOTARY_ISSUER, BEACON_NOTARY_KEY_PATH } = process.env
  if (BEACON_NOTARY_PROFILE) return ['--keychain-profile', BEACON_NOTARY_PROFILE]
  if (BEACON_NOTARY_KEY && BEACON_NOTARY_ISSUER && BEACON_NOTARY_KEY_PATH) {
    return ['--key', BEACON_NOTARY_KEY_PATH, '--key-id', BEACON_NOTARY_KEY, '--issuer', BEACON_NOTARY_ISSUER]
  }
  return null
}

// Submits a file to Apple, waits for the verdict, and staples the ticket to `staple`.
function notarize(file, staple) {
  const auth = notaryAuth()
  if (ADHOC || !auth) return false
  run('xcrun', ['notarytool', 'submit', file, ...auth, '--wait'])
  run('xcrun', ['stapler', 'staple', staple])
  return true
}

// Notarize the .app itself (via a zip, the format notarytool takes for bundles), then
// staple it, so everything packed from it below already carries the ticket.
let notarized = false
if (!ADHOC) {
  const zip = path.join(bundleDir, 'macos', `${conf.productName}-notarize.zip`)
  run('ditto', ['-c', '-k', '--keepParent', app, zip])
  notarized = notarize(zip, app)
  fs.rmSync(zip, { force: true })
  if (!notarized) console.warn('sign-macos: Developer ID signed but NOT notarized (no notary credentials)')
}

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

// DMG: rebuild from the re-signed .app, then sign and notarize the DMG itself.
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
    if (!ADHOC) {
      run('codesign', ['--force', '--sign', IDENTITY, '--timestamp', out])
      if (notarized) notarize(out, out)
    }
  }
}

const how = ADHOC ? 'ad-hoc' : `${IDENTITY}${notarized ? ', notarized' : ''}`
console.log(`sign-macos: signed ${app} as ${ID} (${how})`)
