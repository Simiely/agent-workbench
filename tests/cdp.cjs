// 极简 CDP 客户端：驱动 chrome-headless-shell 打开页面、执行 JS、拿结果。
// 零依赖（Node 18+ 内置 fetch，Node 22 内置 WebSocket）。
// 用途：本地版（真实后端 + 真实 fetch）的端到端验证。
// 与 --dump-dom 的区别：dump-dom 在 fetch 回来前就快照，这里会等条件成立。

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function findChrome() {
  const env = process.env.CHROME_HEADLESS;
  if (env && fs.existsSync(env)) return env;
  const root = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
  if (!fs.existsSync(root)) return null;
  const dirs = fs.readdirSync(root).filter(d => d.startsWith('chromium_headless_shell')).sort().reverse();
  for (const d of dirs) {
    const p = path.join(root, d, 'chrome-headless-shell-win64', 'chrome-headless-shell.exe');
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.ctxId = null;          // 当前主 frame 的 execution context
    this.loaded = false;
    ws.addEventListener('message', ev => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.method === 'Runtime.executionContextCreated') {
        const c = msg.params.context;
        if (c.auxData && c.auxData.isDefault) this.ctxId = c.id;
      }
      if (msg.method === 'Runtime.executionContextsCleared') {
        this.ctxId = null;
      }
      if (msg.method === 'Page.loadEventFired') {
        this.loaded = true;
      }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
      }
    });
  }

  send(method, params) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('CDP 超时: ' + method));
        }
      }, 30000);
    });
  }

  // 在页面里执行表达式，await Promise，返回 JSON 化结果
  async evalJson(expr, timeoutMs = 15000) {
    const r = await this.send('Runtime.evaluate', {
      expression: '(function(){try{return Promise.resolve(' + expr +
        ').then(function(v){return JSON.stringify({ok:true,v:v})})}catch(e){return JSON.stringify({ok:false,e:String(e)})}})()',
      awaitPromise: true,
      returnByValue: true,
      contextId: this.ctxId || undefined
    });
    if (r.exceptionDetails) {
      throw new Error('页面异常: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
    }
    const payload = JSON.parse(r.result.value);
    if (!payload.ok) throw new Error(payload.e);
    return payload.v;
  }

  // 轮询直到 cond() 为真
  async waitFor(expr, timeoutMs = 12000, intervalMs = 200) {
    const t0 = Date.now();
    let last = null;
    while (Date.now() - t0 < timeoutMs) {
      try {
        last = await this.evalJson(expr);
        if (last) return last;
      } catch (e) { last = 'ERR:' + e.message; }
      await sleep(intervalMs);
    }
    throw new Error('等待条件超时: ' + expr + ' (最后值: ' + JSON.stringify(last) + ')');
  }
}

async function launch() {
  const chrome = findChrome();
  if (!chrome) throw new Error('找不到 chrome-headless-shell');
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'awb-cdp-'));
  const proc = spawn(chrome, [
    '--headless', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
    '--remote-debugging-port=0',
    '--user-data-dir=' + ud,
    'about:blank'
  ], { stdio: 'ignore' });

  // 等 DevToolsActivePort 出现
  const portFile = path.join(ud, 'DevToolsActivePort');
  let wsUrl = null;
  let lines0 = '';
  for (let i = 0; i < 100; i++) {
    await sleep(100);
    if (fs.existsSync(portFile)) {
      const lines = fs.readFileSync(portFile, 'utf8').split('\n');
      if (lines.length >= 2 && lines[0].trim()) {
        lines0 = lines[0].trim();
        wsUrl = 'ws://127.0.0.1:' + lines0 + lines[1].trim();
        break;
      }
    }
  }
  if (!wsUrl) {
    proc.kill();
    throw new Error('DevTools 端口未就绪');
  }

  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.addEventListener('open', res, { once: true });
    ws.addEventListener('error', rej, { once: true });
  });
  const cdp = new CDP(ws);

  // 直接列出已有 page target，连接到它的页面级 ws 端点
  // （比 Target.attachToTarget 更稳：页面级连接天然就是 Page/Runtime 域的主人）
  const list = await (await fetch('http://127.0.0.1:' + lines0 + '/json/list')).json();
  const pageTarget = (list || []).find(t => t.type === 'page');
  if (!pageTarget) {
    proc.kill();
    throw new Error('未找到 page target');
  }

  const pws = new WebSocket(pageTarget.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    pws.addEventListener('open', res, { once: true });
    pws.addEventListener('error', rej, { once: true });
  });
  const pcdp = new CDP(pws);

  await pcdp.send('Page.enable');
  await pcdp.send('Runtime.enable');

  return {
    cdp: pcdp,
    async goto(url) {
      pcdp.loaded = false;
      await pcdp.send('Page.navigate', { url });
      // 等 load 事件 + 主 frame context 建立
      for (let i = 0; i < 60; i++) {
        if (pcdp.loaded && pcdp.ctxId) break;
        await sleep(100);
      }
      await sleep(300);
    },
    async close() {
      try { pws.close(); } catch (e) { /* ignore */ }
      try { ws.close(); } catch (e) { /* ignore */ }
      proc.kill();
      try { fs.rmSync(ud, { recursive: true, force: true }); } catch (e) { /* ignore */ }
    }
  };
}

module.exports = { launch, findChrome };
