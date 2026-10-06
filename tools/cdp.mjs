// Minimal Chrome DevTools Protocol client for headless Chromium.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// gpu: true renders WebGL on the GPU through Vulkan. Without it, headless
// Chromium renders WebGL on the CPU with SwiftShader.
export async function launch({ gpu = false } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'theme-cdp-'));
  const chrome = spawn('chromium', [
    '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--hide-scrollbars', '--allow-file-access-from-files',
    // The watchdog stops the GPU process when a large shader compiles for a long
    // time, so the photo renderer turns it off.
    ...(gpu ? ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--disable-gpu-watchdog'] : []),
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  const wsUrl = await new Promise((resolve, reject) => {
    let buf = '';
    chrome.stderr.on('data', d => {
      buf += d;
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) resolve(m[1]);
    });
    chrome.on('exit', code => reject(new Error(`chromium exited with ${code}`)));
  });
  const port = new URL(wsUrl).port;
  // Stop Chromium when the script stops, so no browser stays behind.
  const stop = () => { try { chrome.kill(); } catch {} };
  process.once('exit', stop);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { stop(); process.exit(130); });

  async function open(url) {
    const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise(r => ws.addEventListener('open', r, { once: true }));
    let id = 0;
    const pending = new Map();
    ws.addEventListener('message', ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
    });
    const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    const evaluate = async expression => {
      const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (res.result?.exceptionDetails) throw new Error(JSON.stringify(res.result.exceptionDetails).slice(0, 800));
      return res.result.result.value;
    };
    await send('Page.enable');
    await send('Page.navigate', { url });
    for (let i = 0; i < 100 && !(await evaluate('document.readyState === "complete"')); i++) await new Promise(r => setTimeout(r, 100));
    return { evaluate, send, close: () => ws.close() };
  }

  // Wait for Chromium to exit, so it does not write to the profile during the removal.
  async function close() {
    const exited = new Promise(r => chrome.once('exit', r));
    chrome.kill();
    await exited;
    rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
  }

  return { open, close };
}

// The Omarchy wordmark paths, with the fill rule of each path.
export function logoPaths(svg) {
  return [...svg.matchAll(/<path([^>]*)\/>/g)].map(m => ({
    d: m[1].match(/ d="([^"]+)"/)[1],
    evenodd: /fill-rule="evenodd"/.test(m[1]),
  }));
}
