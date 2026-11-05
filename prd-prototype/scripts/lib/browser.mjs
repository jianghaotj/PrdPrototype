// 无依赖的无头浏览器驱动：启动本机 Chrome / Edge / Chromium，经 DevTools 协议（管道模式）执行脚本与截图。
// 支持 Node 18+；可用环境变量 CHROME_PATH 指定浏览器可执行文件。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const CANDIDATES = {
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary'
  ],
  win32: [
    path.join(process.env['PROGRAMFILES'] || 'C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(process.env['LOCALAPPDATA'] || '', 'Google\\Chrome\\Application\\chrome.exe'),
    path.join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Microsoft\\Edge\\Application\\msedge.exe'),
    path.join(process.env['PROGRAMFILES'] || 'C:\\Program Files', 'Microsoft\\Edge\\Application\\msedge.exe')
  ],
  linux: ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge', '/snap/bin/chromium']
};

export function findBrowser() {
  if (process.env.CHROME_PATH) {
    if (fs.existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
    throw new Error('CHROME_PATH 指向的文件不存在：' + process.env.CHROME_PATH);
  }
  const list = CANDIDATES[process.platform] || CANDIDATES.linux;
  const hit = list.find((p) => p && fs.existsSync(p));
  if (!hit) throw new Error('没有找到 Chrome、Edge 或 Chromium。请安装其中之一，或用环境变量 CHROME_PATH 指定浏览器可执行文件。');
  return hit;
}

export function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function withTimeout(promise, ms, message) {
  let t;
  const guard = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(message)), ms); });
  return Promise.race([promise, guard]).finally(() => clearTimeout(t));
}

export async function launch() {
  const exe = findBrowser();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prd-proto-'));
  const args = [
    '--headless=new', '--remote-debugging-pipe', '--user-data-dir=' + dir,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--disable-extensions',
    '--disable-background-networking', '--disable-sync', '--hide-scrollbars', '--mute-audio',
    '--disable-features=Translate,MediaRouter', 'about:blank'
  ];
  const proc = spawn(exe, args, { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  let stderr = '';
  proc.stderr.on('data', (d) => { stderr += d; if (stderr.length > 20000) stderr = stderr.slice(-20000); });
  const out = proc.stdio[3], inp = proc.stdio[4];
  let seq = 0, closed = false;
  const pending = new Map();
  const listeners = new Set();
  let chunks = [];
  inp.on('data', (buf) => {
    let start = 0;
    for (let i = 0; i < buf.length; i++) {
      if (buf[i] !== 0) continue;
      chunks.push(buf.subarray(start, i));
      const text = Buffer.concat(chunks).toString('utf8');
      chunks = [];
      start = i + 1;
      let msg;
      try { msg = JSON.parse(text); } catch (e) { continue; }
      if (msg.id && pending.has(msg.id)) {
        const p = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) p.rej(new Error(msg.error.message + (msg.error.data ? '：' + msg.error.data : '')));
        else p.res(msg.result);
      } else if (msg.method) listeners.forEach((fn) => fn(msg));
    }
    if (start < buf.length) chunks.push(buf.subarray(start));
  });
  const exited = new Promise((res) => proc.on('exit', () => { closed = true; pending.forEach((p) => p.rej(new Error('浏览器已退出'))); pending.clear(); res(); }));
  proc.on('error', () => {});
  out.on('error', () => {});

  function send(method, params = {}, sessionId) {
    if (closed) return Promise.reject(new Error('浏览器已退出'));
    const id = ++seq;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((res, rej) => {
      pending.set(id, { res, rej });
      out.write(JSON.stringify(payload) + '\0');
    });
  }
  try {
    await withTimeout(send('Browser.getVersion'), 20000, '浏览器启动超时');
  } catch (e) {
    try { proc.kill('SIGKILL'); } catch (x) {}
    throw new Error('浏览器启动失败：' + exe + '\n' + e.message + '\n' + stderr.slice(-1500));
  }

  async function newPage({ width = 1600, height = 1000, offline = false } = {}) {
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const errors = [];
    const dialogs = [];
    const requests = [];
    const byRequestId = new Map();
    const frameNames = new Map();   /* 子 frame 的 id → name，用来区分托管端的检查 iframe */
    const waiters = [];
    const onEvent = (msg) => {
      if (msg.sessionId !== sessionId) return;
      if (msg.method === 'Page.frameNavigated') {
        const f = msg.params.frame;
        if (f && f.parentId) frameNames.set(f.id, f.name || '');
      } else if (msg.method === 'Network.requestWillBeSent') {
        const r = { requestId: msg.params.requestId, url: msg.params.request.url, type: msg.params.type || '', frameId: msg.params.frameId || '', frameName: frameNames.get(msg.params.frameId) || '', failed: '' };
        requests.push(r);
        byRequestId.set(r.requestId, r);
      } else if (msg.method === 'Network.loadingFailed') {
        /* 断网时请求会以 blockedReason 或 errorText 失败：记录下来，证明请求确实被拦下 */
        const r = byRequestId.get(msg.params.requestId);
        if (r) r.failed = msg.params.blockedReason || msg.params.errorText || 'failed';
      } else if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails || {};
        errors.push('脚本异常：' + ((d.exception && d.exception.description) || d.text || '未知错误').split('\n').slice(0, 3).join(' | '));
      } else if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
        errors.push('控制台错误：' + msg.params.args.map((a) => (a.value !== undefined ? a.value : a.description || '')).join(' ').slice(0, 400));
      } else if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
        errors.push('浏览器错误：' + String(msg.params.entry.text).slice(0, 400) + (msg.params.entry.url ? '（' + msg.params.entry.url.slice(0, 160) + '）' : ''));
      }
      if (msg.method === 'Page.javascriptDialogOpening') {
        /* 原生对话框会阻塞页面：自动确认并记录 */
        dialogs.push(msg.params.type + '：' + String(msg.params.message || '').slice(0, 80));
        send('Page.handleJavaScriptDialog', { accept: true }, sessionId).catch(() => {});
      }
      for (let i = waiters.length - 1; i >= 0; i--) {
        if (waiters[i].method === msg.method) { waiters[i].res(msg.params); waiters.splice(i, 1); }
      }
    };
    listeners.add(onEvent);
    const s = (m, p) => send(m, p, sessionId);
    await s('Page.enable');
    await s('Runtime.enable');
    await s('Log.enable');
    await s('Network.enable');
    /* 断网：屏蔽所有网络地址的请求（file:// 本地文件不受影响）；请求记录仍然保留，供检查报告使用 */
    if (offline) await s('Network.setBlockedURLs', { urls: ['http://*', 'https://*', 'ws://*', 'wss://*'] });
    await s('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    function waitEvent(method, timeout) {
      let w;
      const p = new Promise((res) => { w = { method, res }; waiters.push(w); });
      return withTimeout(p, timeout, '等待 ' + method + ' 超时').finally(() => { const i = waiters.indexOf(w); if (i >= 0) waiters.splice(i, 1); });
    }
    return {
      errors,
      dialogs,
      requests,
      send: s,
      async goto(url, timeout = 60000) {
        const loaded = waitEvent('Page.loadEventFired', timeout);
        loaded.catch(() => {});
        const r = await s('Page.navigate', { url });
        if (r.errorText) throw new Error('打开页面失败：' + r.errorText + '（' + url + '）');
        if (!r.loaderId) { await sleep(50); return; }   /* 只改了 hash，不会重新加载 */
        await loaded;
      },
      async evaluate(expression, timeout = 180000) {
        const call = s('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
        const r = await withTimeout(call, timeout, '页面脚本执行超时');
        if (r.exceptionDetails) {
          const d = r.exceptionDetails;
          throw new Error(((d.exception && d.exception.description) || d.text || '页面脚本出错').split('\n').slice(0, 4).join(' | '));
        }
        return r.result ? r.result.value : undefined;
      },
      async waitFor(expression, timeout = 30000) {
        const t0 = Date.now();
        while (Date.now() - t0 < timeout) {
          if (await this.evaluate('!!(' + expression + ')')) return true;
          await sleep(80);
        }
        throw new Error('等待页面条件超时：' + expression);
      },
      async setViewport(w, h) { await s('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false }); },
      async screenshot(file) {
        const r = await s('Page.captureScreenshot', { format: 'png' });
        fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
        fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
        return file;
      },
      async close() {
        listeners.delete(onEvent);
        try { await withTimeout(send('Target.closeTarget', { targetId }), 3000, 'close'); } catch (e) {}
      }
    };
  }
  async function close() {
    try { await withTimeout(send('Browser.close'), 2000, 'close'); } catch (e) {}
    await Promise.race([exited, sleep(2500)]);
    if (!closed) { try { proc.kill('SIGKILL'); } catch (e) {} }
    for (let i = 0; i < 5; i++) {
      try { fs.rmSync(dir, { recursive: true, force: true }); break; } catch (e) { await sleep(200); }
    }
  }
  return { exe, newPage, close };
}

export function fileUrl(p) { return pathToFileURL(path.resolve(p)).href; }
