// Captures product screenshots for the landing page from the running web UI.
// Usage: node --experimental-websocket landing/scripts/capture-screens.mjs <ui-url> <out-dir> [agent-session.json]
// Shots are 1440x900 CSS at 1.5x (2160x1350 px), in light and dark, saved as PNG;
// convert to webp afterwards. Seed the backend with demo data first: the UI shows
// whatever project and accounts the backend has.
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const [ui = 'http://localhost:5179', outDir = 'shots', sessionFile] = process.argv.slice(2)
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const session = sessionFile ? readFileSync(sessionFile, 'utf8') : null

// Each shot: a path, the theme, and an optional page script run after load.
const SHOTS = [
  { name: 'gateway', path: '/ai-gateway' },
  { name: 'agent', path: '/', after: `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', metaKey: true, ctrlKey: true, bubbles: true }))` },
]

mkdirSync(outDir, { recursive: true })
const profile = mkdtempSync(join(tmpdir(), 'beacon-shots-'))
const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--hide-scrollbars', '--force-color-profile=srgb', 'about:blank'])
const port = await new Promise((done, fail) => {
  let text = ''
  const timer = setTimeout(() => fail(new Error('Chrome did not start')), 20000)
  chrome.stderr.on('data', (c) => {
    text += c
    const m = text.match(/DevTools listening on ws:\/\/[^:]+:(\d+)\//)
    if (m) { clearTimeout(timer); done(Number(m[1])) }
  })
})
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function open() {
  const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json()
  const ws = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((r) => ws.addEventListener('open', r, { once: true }))
  let id = 0
  const pending = new Map()
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data)
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
  })
  const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })) })
  const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.result?.value
  return { ws, send, evaluate }
}

for (const theme of ['light', 'dark']) {
  for (const shot of SHOTS) {
    const { ws, send, evaluate } = await open()
    await send('Page.enable')
    await send('Runtime.enable')
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1.5, mobile: false })
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }, { name: 'prefers-reduced-motion', value: 'reduce' }] })
    // Seed storage on the origin first so the app reads it on its real load.
    await send('Page.navigate', { url: `${ui}/` })
    await sleep(1500)
    await evaluate(`(() => {
      localStorage.clear();
      localStorage.setItem('theme', ${JSON.stringify(theme)});
      localStorage.setItem('beacon_onboarded', '1');
      ${session ? `localStorage.setItem('beacon.agent.sessions.v1', ${JSON.stringify(`[${session}]`)});` : ''}
      return true
    })()`)
    await send('Page.navigate', { url: `${ui}${shot.path}` })
    await sleep(4000)
    if (shot.after) { await evaluate(shot.after); await sleep(2500) }
    const shotData = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
    const file = join(outDir, `${shot.name}-${theme}.png`)
    writeFileSync(file, Buffer.from(shotData.result.data, 'base64'))
    console.log('saved', file)
    ws.close()
  }
}
chrome.kill()
rmSync(profile, { recursive: true, force: true })
