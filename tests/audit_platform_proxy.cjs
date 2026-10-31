// 平台反代适配体检：模拟 tools-center 把工具挂在 /tool/agent-workbench/ 下，
// 验证页面所有 API 请求走对前缀（曾经用绝对 /api/... 导致平台下读取和添加全 404）。
// 覆盖：直连根路径 + 反代前缀路径 ×（挂载页渲染 / 添加电脑 / 添加任务 / 添加同步记录）。
const { launch } = require('./cdp.cjs');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.argv[2] || '8181', 10);
const PROXY_PORT = PORT + 100; // 8291 系列，避开其他脚本
const ROOT = path.dirname(__dirname);
const storage = path.join(ROOT, 'tests', '_out', 'storage-' + PORT);
fs.rmSync(storage, { recursive: true, force: true });
fs.mkdirSync(storage, { recursive: true });
fs.writeFileSync(path.join(storage, 'db.json'), JSON.stringify({ tasks: [], machines: [], github: [] }));

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail !== undefined && detail !== '' ? '  → ' + detail : ''));
}

async function click(cdp, sel) {
  const box = await cdp.evalJson('(function(){var e=document.querySelector(' + JSON.stringify(sel) + ');if(!e)return null;var r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};})()');
  if (!box) throw new Error('找不到元素: ' + sel);
  const { x, y } = box;
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

// 最小平台反代：/tool/agent-workbench/* → 工具 server，前缀剥离；无斜杠时 302
function startProxy() {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const prefix = '/tool/agent-workbench';
      if (req.url === prefix) { res.writeHead(302, { Location: prefix + '/' }); return res.end(); }
      if (!req.url.startsWith(prefix + '/')) { res.writeHead(404); return res.end('not found'); }
      const fwd = req.url.slice(prefix.length);
      const up = http.request({ host: '127.0.0.1', port: PORT, path: fwd, method: req.method, headers: req.headers },
        r => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
      up.on('error', () => { res.writeHead(502); res.end('bad gateway'); });
      req.pipe(up);
    });
    srv.listen(PROXY_PORT, '127.0.0.1', () => resolve(srv));
  });
}

(async () => {
  const server = spawn(process.execPath, [path.join(ROOT, 'server.mjs'), String(PORT)], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CAP_STORAGE_DIR: storage }
  });
  server.stdout.on('data', () => {});
  server.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  await new Promise(r => setTimeout(r, 1200));
  const proxy = await startProxy();

  let browser = null;
  try {
    browser = await launch();
    const { cdp } = browser;
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });

    const bad = [], apiUrls = [];
    cdp.ws.addEventListener('message', ev => {
      const m = JSON.parse(ev.data);
      if (m.method === 'Network.requestWillBeSent') {
        if (/\/api\//.test(m.params.request.url)) apiUrls.push(m.params.request.url);
      }
      if (m.method === 'Network.responseReceived') {
        const r = m.params.response;
        if (/\/api\//.test(r.url) && r.status >= 400) bad.push(r.status + ' ' + r.url);
      }
    });
    await cdp.send('Network.enable');

    const base = 'http://127.0.0.1:' + PROXY_PORT + '/tool/agent-workbench/';
    await browser.goto(base);
    await new Promise(r => setTimeout(r, 1500));

    const boot = await cdp.evalJson(`(function(){
      var t=document.querySelector('.toast');
      return {
        列数: document.querySelectorAll('#board .col').length,
        加载失败toast: t ? /加载失败|失败/.test(t.textContent) : false
      };
    })()`);
    const prefixed = apiUrls.filter(u => u.indexOf('/tool/agent-workbench/api/') >= 0).length;
    check('反代：页面挂在 /tool/agent-workbench/ 下能正常启动、API 请求带前缀',
      !boot.加载失败toast && prefixed > 0 && prefixed === apiUrls.length,
      '带前缀 ' + prefixed + '/' + apiUrls.length);

    // 1) 添加电脑（真实鼠标）
    await click(cdp, '#addBtn');
    await new Promise(r => setTimeout(r, 300));
    await click(cdp, '[data-add="machine"]');
    await new Promise(r => setTimeout(r, 350));
    await click(cdp, '#m_name');
    await cdp.send('Input.insertText', { text: '反代测试机' });
    await click(cdp, '#m_save');
    await new Promise(r => setTimeout(r, 900));
    const m1 = await cdp.evalJson('(function(){return Array.prototype.map.call(document.querySelectorAll("#board .ch-name"),function(n){return n.textContent.trim()})})()');
    check('反代：添加电脑成功', m1.indexOf('反代测试机') >= 0, JSON.stringify(m1));

    // 2) 添加任务
    await click(cdp, '#addBtn');
    await new Promise(r => setTimeout(r, 300));
    await click(cdp, '[data-add="task"]');
    await new Promise(r => setTimeout(r, 450));
    await click(cdp, '#f_title');
    await cdp.send('Input.insertText', { text: '反代测试任务' });
    await click(cdp, '#saveBtn');
    await new Promise(r => setTimeout(r, 900));
    const t1 = await cdp.evalJson('(function(){return Array.prototype.map.call(document.querySelectorAll("#board .c-title"),function(n){return n.textContent.trim()})})()');
    check('反代：添加任务成功', t1.indexOf('反代测试任务') >= 0, JSON.stringify(t1));

    // 3) 添加同步记录
    await click(cdp, '#addBtn');
    await new Promise(r => setTimeout(r, 300));
    await click(cdp, '[data-add="gh"]');
    await new Promise(r => setTimeout(r, 450));
    await click(cdp, '#gf_repo');
    await cdp.send('Input.insertText', { text: 'Simiely/proxy-test' });
    await click(cdp, '#saveBtn');
    await new Promise(r => setTimeout(r, 900));
    const g1 = await cdp.evalJson('(function(){return Array.prototype.map.call(document.querySelectorAll("#ghList .repo-card"),function(c){var t=c.querySelector(".re-title,.repo-name");return t?t.textContent.trim():""})})()');
    check('反代：添加同步记录成功', g1.some(x => x.indexOf('proxy-test') >= 0), JSON.stringify(g1.slice(0, 3)));

    // 4) 无 4xx
    check('反代：所有 /api/ 请求无 4xx', bad.length === 0, bad.slice(0, 3).join(' / ') || '无');

    // 5) 落盘
    const db = JSON.parse(fs.readFileSync(path.join(storage, 'db.json'), 'utf8'));
    check('反代：三条数据都已落盘', db.machines.length === 1 && db.tasks.length === 1 && db.github.length === 1,
      db.machines.length + '/' + db.tasks.length + '/' + db.github.length);

    // 6) 直连根路径仍然正常（不回归）
    await browser.goto('http://127.0.0.1:' + PORT + '/');
    await new Promise(r => setTimeout(r, 1200));
    const direct = await cdp.evalJson('(function(){return {列数:document.querySelectorAll("#board .col").length, 有数据:document.querySelectorAll("#board .c-title").length}})()');
    const rootApi = apiUrls.filter(u => u.indexOf('/api/') > 0 && u.indexOf('/tool/') < 0).length;
    check('直连：根路径 API 请求不带前缀且数据正常', direct.有数据 === 1 && rootApi > 0, '根级 API ' + rootApi + ' 个 / 卡片=' + direct.有数据);
  } catch (e) {
    check('执行异常', false, e.message);
  } finally {
    if (browser) await browser.close();
    proxy.close();
    server.kill();
  }

  const failed = results.filter(r => !r.ok);
  console.log('='.repeat(56));
  if (failed.length) {
    console.log('FAILED: ' + failed.map(r => r.name).join(', '));
    process.exit(1);
  }
  console.log('平台反代适配体检 ALL PASS  (' + results.length + ' 项)');
})();
