#!/usr/bin/env node
// 重新生成资料库版 HTML 与 4 个 CSV 模板。
//
// 用法（在仓库根目录）：
//   node library/tools/build.mjs
//
// 为什么需要这个脚本：
//   library/agent-workbench-资料库版.html 是**生成物**，不是手写的源文件。
//   它的真源是 public/index.html + server.mjs 的 SCHEMAS。
//   改了主项目却没重新生成，资料包就会悄悄过期（界面是新的、字段是旧的）。
//
// 链路：
//   public/index.html  ──┐
//   server.mjs SCHEMAS ──┼──► [注入离线快照层] ──► [注入 CSV 数据源层] ──► 资料库版 HTML
//   package.json version┘                                              └─► 4 个 CSV 模板
//
// 字段清单**从 SCHEMAS 派生**，不硬编码——主项目加字段，CSV 模板自动跟着变。
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.resolve(HERE, '..');           // library/
const ROOT = path.resolve(LIB, '..');           // 仓库根

const SRC_HTML = path.join(ROOT, 'public', 'index.html');
const SRC_SVR = path.join(ROOT, 'server.mjs');
const PKG = path.join(ROOT, 'package.json');
const OUT_HTML = path.join(LIB, 'agent-workbench-资料库版.html');

// ---------------------------------------------------------------- 1. 读真源
// server.mjs 顶层会启动 HTTP 服务，不能直接 import，用括号配对把 SCHEMAS 抠出来求值。
function readSchemas() {
  const s = fs.readFileSync(SRC_SVR, 'utf8');
  const start = s.search(/const\s+SCHEMAS\s*=\s*\{/);
  if (start < 0) throw new Error('server.mjs 里找不到 const SCHEMAS = {');
  const open = s.indexOf('{', start);
  let depth = 0, i = open;
  for (; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}') { depth--; if (depth === 0) break; }
  }
  const literal = s.slice(open, i + 1);
  return new Function('return ' + literal)();
}

const SCHEMAS = readSchemas();
const VERSION = JSON.parse(fs.readFileSync(PKG, 'utf8')).version;
const HTML = fs.readFileSync(SRC_HTML, 'utf8');

// 机器表的账号字段是派生只读值（由 accounts 表的「当前」算出），不进 CSV
const DERIVED = { machines: ['WorkBuddy账号', 'TRAE账号'] };

// 每张表的 CSV 列 = _id + SCHEMAS 字段（去掉派生字段）
const TABLES = ['tasks', 'machines', 'accounts', 'github'];
const FIELDS = {};
const TYPES = {};
const ENUMS = {};
const REQUIRED = {};
for (const t of TABLES) {
  const props = SCHEMAS[t].properties;
  const drop = DERIVED[t] || [];
  FIELDS[t] = ['_id', ...props.map(p => p.name).filter(n => !drop.includes(n))];
  for (const p of props) {
    TYPES[p.name] = p.type;
    if (p.type === 'select' && p.config && p.config.options) {
      (ENUMS[t] = ENUMS[t] || {})[p.name] = p.config.options.map(o => o.text);
    }
  }
}
// 必填与服务端 server.mjs 保持一致（改服务端时这里也要跟着改，check.mjs 会兜底提醒）
Object.assign(REQUIRED, {
  tasks: ['任务标题', '状态', '优先级', '所在电脑'],
  machines: ['机器名'],
  accounts: ['账号名', '平台', '所属电脑'],
  github: ['电脑', '仓库'],
});

const snap = {
  schema: SCHEMAS,
  data: Object.fromEntries(TABLES.map(t => [t, []])),
  health: { version: VERSION, storage: { ok: true } },
};

// ---------------------------------------------------------------- 2. 离线快照层
const snapLayer = `<script>
/* ===== 离线快照层（生成物，请勿手改；改 public/index.html 后重新 build） =====
   内嵌空壳四表 + localStorage 冒充后端 REST。
   页面自身的 localDb() / Repo 读写链路走原有逻辑，未改动主项目任何代码。 */
(function () {
  var SNAP = ${JSON.stringify(snap)};
  var KEY = 'awb.offline.db.empty';
  var PLATFORMS = ['WorkBuddy', 'TRAE'];
  var MACHINE_ACC_FIELD = { 'WorkBuddy': 'WorkBuddy账号', 'TRAE': 'TRAE账号' };
  var ACC = { name: '账号名', plat: '平台', mach: '所属电脑', cur: '当前' };
  var REQUIRED = ${JSON.stringify(REQUIRED)};
  var ENUMS = ${JSON.stringify(ENUMS)};
  function blank(v) {
    if (v === null || v === undefined) return true;
    if (typeof v === 'string') return !v.trim();
    return false;
  }
  // 与服务端 checkRecord 同口径：必填空 → 拒写；枚举越界 → 拒写；机器名重名 → 拒写
  function check(dbKey, rec, isNew, selfId) {
    var req = REQUIRED[dbKey] || [];
    for (var i = 0; i < req.length; i++) {
      if (isNew && blank(rec[req[i]])) return req[i] + '不能为空';
    }
    var en = ENUMS[dbKey] || {};
    for (var f in en) {
      if (blank(rec[f])) continue;
      if (en[f].indexOf(rec[f]) < 0) return f + '只能是 ' + en[f].join(' / ');
    }
    if (dbKey === 'machines' && isNew && !blank(rec['机器名'])) {
      var nm = String(rec['机器名']).trim();
      var dup = (db().machines || []).some(function (m) { return m._id !== selfId && String(m['机器名'] || '').trim() === nm; });
      if (dup) return '已经有同名电脑了';
    }
    return null;
  }
  function newId() {
    var a = new Uint8Array(6);
    (window.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach(function (_, i) { a[i] = Math.floor(Math.random() * 256); });
    return Array.from(a).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) { var d = JSON.parse(raw); if (d && d.tasks) return d; }
    } catch (e) {}
    return JSON.parse(JSON.stringify(SNAP.data));
  }
  function save(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) {} }
  var DB = null;
  function db() { if (!DB) DB = load(); return DB; }
  // 机器表账号字段按 accounts 实时派生（与服务端 deriveMachine 同口径）
  function derive(d, m) {
    var out = Object.assign({}, m);
    PLATFORMS.forEach(function (p) {
      var cur = null;
      (d.accounts || []).forEach(function (a) {
        if (a[ACC.mach] === m['机器名'] && a[ACC.plat] === p && a[ACC.cur] === true) cur = a;
      });
      out[MACHINE_ACC_FIELD[p]] = cur ? (cur[ACC.name] || '') : '';
    });
    return out;
  }
  function unwrap(v) {
    if (v && typeof v === 'object' && !Array.isArray(v)) { for (var k in v) return v[k]; return undefined; }
    return v;
  }
  function ok(data) { return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } }); }
  function err(msg, code) { return new Response(JSON.stringify({ error: msg }), { status: code || 400, headers: { 'Content-Type': 'application/json' } }); }
  var realFetch = window.fetch.bind(window);
  window.fetch = function (input, opt) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    opt = opt || {};
    var method = (opt.method || (typeof input !== 'string' && input.method) || 'GET').toUpperCase();
    var mDb = url.match(/api\\/(?:schema|query)\\?db=([^&]+)/) || url.match(/api\\/records\\/[^/]+\\?db=([^&]+)/);
    var key = mDb ? decodeURIComponent(mDb[1]) : null;
    var body = null;
    try { body = opt.body ? JSON.parse(opt.body) : null; } catch (e) {}
    if (/api\\/records/.test(url) && method !== 'GET' && body && body.db) key = String(body.db);
    // 页面请求 API_BASE + 'health'（不是 /api/health）——只匹配 api\\/health 会漏，版本号徽标恒空
    if (/api\\/health/.test(url) || /(^|\\/)health(\\?|$)/.test(url)) return Promise.resolve(ok(SNAP.health));
    if (!key) return realFetch(input, opt);
    var d = db();
    if (SNAP.schema[key] === undefined) return Promise.resolve(err('unknown db'));
    if (/api\\/schema/.test(url) && method === 'GET') {
      var s = SNAP.schema[key];
      return Promise.resolve(ok({ label: s.label, properties: s.properties }));
    }
    if (/api\\/query/.test(url) && method === 'GET') {
      var rows = (d[key] || []).slice();
      if (key === 'machines') rows = rows.map(function (m) { return derive(d, m); });
      return Promise.resolve(ok({ results: rows, hasMore: false, nextCursor: null }));
    }
    if (/api\\/records$/.test(url) && method === 'POST') {
      if (SNAP.schema[body.db] === undefined) return Promise.resolve(err('unknown db'));
      var props = body.properties || {};
      var rec = { _id: newId() };
      for (var k in props) rec[k] = unwrap(props[k]);
      if (body.db === 'machines' && typeof rec['机器名'] === 'string') rec['机器名'] = rec['机器名'].trim();
      if (body.db === 'tasks' && typeof rec['所在电脑'] === 'string') rec['所在电脑'] = rec['所在电脑'].trim();
      if (!rec['更新时间'] && body.db !== 'machines') rec['更新时间'] = new Date().toISOString();
      var cerr = check(body.db, rec, true);
      if (cerr) return Promise.resolve(err(cerr));
      d[body.db].push(rec); save(d);
      return Promise.resolve(ok({ id: rec._id }));
    }
    var mRec = url.match(/api\\/records\\/([^/?]+)/);
    if (mRec && (method === 'PATCH' || method === 'DELETE')) {
      var id = decodeURIComponent(mRec[1]);
      var bucket = d[key] || [];
      var i = bucket.findIndex(function (r) { return r._id === id; });
      if (i < 0) return Promise.resolve(err('record not found', 404));
      if (method === 'PATCH') {
        var patch = body || {}, pp = patch.properties || {};
        var merged = Object.assign({}, bucket[i]);
        for (var f in pp) merged[f] = unwrap(pp[f]);
        var perr = check(key, merged, false, id);
        if (perr) return Promise.resolve(err(perr));
        for (var f2 in pp) bucket[i][f2] = unwrap(pp[f2]);
        if (key === 'accounts' && bucket[i][ACC.cur] === true) {
          (d.accounts || []).forEach(function (a) {
            if (a._id !== id && a[ACC.mach] === bucket[i][ACC.mach] && a[ACC.plat] === bucket[i][ACC.plat]) a[ACC.cur] = false;
          });
        }
        save(d); return Promise.resolve(ok({}));
      }
      bucket.splice(i, 1); save(d); return Promise.resolve(ok({}));
    }
    return realFetch(input, opt);
  };
})();
</script>
`;

// ---------------------------------------------------------------- 3. CSV 数据源层
const csvLayer = `<script>
/* ===== CSV 数据源层（生成物，请勿手改） =====
   数据在浏览器本地持久化；导出成 4 个标准 CSV，导入时按文件名认表。 */
(function () {
  var FIELDS = ${JSON.stringify(FIELDS)};
  var TYPES = ${JSON.stringify(TYPES)};
  var REQUIRED = ${JSON.stringify(REQUIRED)};
  var ENUMS = ${JSON.stringify(ENUMS)};
  var KEY = 'awb.offline.db.empty';
  var ORDER = ['tasks', 'machines', 'accounts', 'github'];
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  // 手写 CSV 解析器：处理引号包裹、字段内换行/逗号、"" 转义、BOM、CRLF
  function parseCSV(text) {
    var rows = [], row = [], cur = '', i = 0, inQ = false, atStart = true;
    text = String(text || '').replace(/^\\uFEFF/, '');
    while (i < text.length) {
      var c = text[i];
      if (inQ) {
        if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i += 2; continue; } inQ = false; atStart = false; i++; continue; }
        cur += c; i++; continue;
      }
      // 只有字段起始处的引号才是「包裹符」，字段中间的引号按字面保留。
      // 否则手工写的  标题 "重点"  会被吞掉引号。
      if (c === '"' && atStart) { inQ = true; atStart = false; i++; continue; }
      if (c === ',') { row.push(cur); cur = ''; atStart = true; i++; continue; }
      if (c === '\\r') { i++; continue; }
      if (c === '\\n') { row.push(cur); rows.push(row); row = []; cur = ''; atStart = true; i++; continue; }
      cur += c; atStart = false; i++;
    }
    row.push(cur); rows.push(row);
    while (rows.length && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') rows.pop();
    return rows;
  }
  function toCSV(rows) {
    return rows.map(function (r) {
      return r.map(function (v) {
        v = v === null || v === undefined ? '' : String(v);
        return /[",\\n\\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
      }).join(',');
    }).join('\\r\\n');
  }
  function blank(v) { return v === null || v === undefined || (typeof v === 'string' && !v.trim()); }
  // CSV 里全是字符串，写回前按字段类型还原
  function conv(field, v) {
    var ty = TYPES[field];
    if (ty === 'checkbox') return v === true || v === 'true' || v === '是' || v === '1';
    if (ty === 'number') { var n = parseFloat(v); return isNaN(n) ? null : n; }
    return v;
  }
  function readDb() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null') || { tasks: [], machines: [], accounts: [], github: [] }; }
    catch (e) { return { tasks: [], machines: [], accounts: [], github: [] }; }
  }
  function download(name, text) {
    var blob = new Blob(['\\uFEFF' + text], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 400);
  }
  function tableOf(fname) {
    var f = String(fname || '').toLowerCase();
    for (var i = 0; i < ORDER.length; i++) if (f.indexOf(ORDER[i]) >= 0) return ORDER[i];
    return null;
  }
  var panel = null;
  function status(msg, bad) {
    var el = document.getElementById('csvStatus');
    if (!el) return;
    el.innerHTML = '<div style="margin-top:10px;padding:8px 10px;border-radius:8px;font-size:12.5px;line-height:1.65;'
      + (bad ? 'background:rgba(224,108,108,.12);color:#e06c6c' : 'background:rgba(120,200,140,.12);color:#6cc08c') + '">' + msg + '</div>';
  }
  function closePanel() { if (panel) { panel.remove(); panel = null; } }
  function openPanel() {
    if (panel) { closePanel(); return; }
    var db = readDb();
    var cnt = ORDER.map(function (t) { return (t === 'tasks' ? '任务' : t === 'machines' ? '机器' : t === 'accounts' ? '账号' : 'GitHub') + ' ' + ((db[t] || []).length); }).join(' · ');
    panel = document.createElement('div');
    panel.id = 'csvPanel';
    panel.style.cssText = 'position:fixed;z-index:9999;right:14px;top:52px;width:320px;max-height:78vh;overflow:auto;'
      + 'background:var(--panel-2,#1c1c1e);border:1px solid var(--border,#333);border-radius:12px;'
      + 'padding:14px 15px;box-shadow:0 10px 34px rgba(0,0,0,.42);font-size:13px;color:var(--text,#e8e6e3)';
    panel.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">'
      + '<b style="font-size:13.5px">CSV 数据表</b>'
      + '<button id="csvX" type="button" style="background:none;border:0;color:inherit;cursor:pointer;font-size:16px;line-height:1">×</button></div>'
      + '<div style="font-size:12px;opacity:.72;line-height:1.7;margin-bottom:10px">'
      + '当前：' + esc(cnt) + '<br>数据存在<b>本机浏览器</b>里。导出可备份与迁移，导入可恢复或批量改数据。</div>'
      + '<button id="csvExport" type="button" style="width:100%;margin-bottom:7px;padding:8px;border-radius:8px;border:1px solid var(--border,#333);background:var(--panel-3,#252527);color:inherit;cursor:pointer;font-size:12.5px">导出 4 个 CSV</button>'
      + '<button id="csvImport" type="button" style="width:100%;margin-bottom:7px;padding:8px;border-radius:8px;border:1px solid var(--border,#333);background:var(--panel-3,#252527);color:inherit;cursor:pointer;font-size:12.5px">导入 CSV 文件（可多选）</button>'
      + '<button id="csvClear" type="button" style="width:100%;padding:8px;border-radius:8px;border:1px solid rgba(224,108,108,.4);background:rgba(224,108,108,.1);color:#e06c6c;cursor:pointer;font-size:12.5px">清空全部数据</button>'
      + '<div id="csvStatus"></div>'
      + '<input id="csvFile" type="file" accept=".csv,text/csv" multiple style="display:none">';
    document.body.appendChild(panel);
    panel.querySelector('#csvX').addEventListener('click', closePanel);
    panel.querySelector('#csvExport').addEventListener('click', doExport);
    panel.querySelector('#csvImport').addEventListener('click', function () { panel.querySelector('#csvFile').click(); });
    panel.querySelector('#csvFile').addEventListener('change', doImport);
    panel.querySelector('#csvClear').addEventListener('click', doClear);
  }
  function doExport() {
    var db = readDb(), n = 0, i = 0;
    ORDER.forEach(function (t) {
      var rows = (db[t] || []).map(function (r) {
        return FIELDS[t].map(function (f) { return r[f] === true ? '是' : (r[f] === false ? '否' : (r[f] == null ? '' : r[f])); });
      });
      rows.unshift(FIELDS[t].slice());
      n += Math.max(0, rows.length - 1);
      setTimeout(function () { download('awb-' + t + '.csv', toCSV(rows)); }, i * 320);
      i++;
    });
    status('已导出 ' + n + ' 条（4 个文件，文件名 awb-*.csv）。浏览器可能询问「是否允许下载多个文件」，选允许。');
  }
  function doImport(e) {
    var files = Array.prototype.slice.call((e.target.files) || []);
    if (!files.length) return;
    var db = readDb(), done = [], errs = [], pending = files.length;
    files.forEach(function (file) {
      var t = tableOf(file.name);
      if (!t) { errs.push(esc(file.name) + '：认不出是哪张表（文件名要含 tasks / machines / accounts / github）'); if (--pending === 0) finish(); return; }
      var fr = new FileReader();
      fr.onload = function () {
        var rows = parseCSV(fr.result);
        if (!rows.length) { errs.push(esc(file.name) + '：空文件'); if (--pending === 0) finish(); return; }
        var head = rows[0].map(function (h) { return String(h || '').trim(); });
        var idx = {}, missing = [];
        FIELDS[t].forEach(function (f) { var p = head.indexOf(f); if (p < 0) missing.push(f); else idx[f] = p; });
        // _id 允许缺失（新建时页面会补），其余缺列就报错
        var hard = missing.filter(function (f) { return f !== '_id'; });
        if (hard.length) { errs.push(esc(file.name) + '：缺少列 ' + hard.join('、')); if (--pending === 0) finish(); return; }
        var recs = [], bad = [];
        for (var i = 1; i < rows.length; i++) {
          var r = rows[i], o = {};
          FIELDS[t].forEach(function (f) {
            if (idx[f] === undefined) return;
            var raw = r[idx[f]] === undefined ? '' : r[idx[f]];
            if (raw === '' && f !== '_id') return;
            o[f] = conv(f, raw);
          });
          if (!Object.keys(o).length) continue;
          var req = REQUIRED[t] || [], skip = false;
          for (var k = 0; k < req.length; k++) if (blank(o[req[k]])) { bad.push('第 ' + (i + 1) + ' 行：' + req[k] + '不能为空'); skip = true; break; }
          if (skip) continue;
          var en = ENUMS[t] || {};
          for (var f2 in en) if (!blank(o[f2]) && en[f2].indexOf(o[f2]) < 0) { bad.push('第 ' + (i + 1) + ' 行：' + f2 + '只能是 ' + en[f2].join(' / ')); break; }
          recs.push(o);
        }
        if (bad.length) { errs.push(esc(file.name) + '：' + bad.slice(0, 4).join('；') + (bad.length > 4 ? ' 等 ' + bad.length + ' 处' : '')); if (--pending === 0) finish(); return; }
        db[t] = recs;
        done.push(esc(file.name) + ' ' + recs.length + ' 条');
        if (--pending === 0) finish();
      };
      fr.onerror = function () { errs.push(esc(file.name) + '：读取失败'); if (--pending === 0) finish(); };
      fr.readAsText(file, 'utf-8');
    });
    function finish() {
      if (errs.length) { status(errs.join('<br>'), true); e.target.value = ''; return; }
      localStorage.setItem(KEY, JSON.stringify(db));
      status('已导入：' + done.join(' · ') + '。正在刷新…');
      setTimeout(function () { location.reload(); }, 700);
    }
  }
  function doClear() {
    if (!window.confirm('清空全部数据？四张表都会变空，且无法撤销。\\n\\n建议先「导出 4 个 CSV」备份。')) return;
    localStorage.setItem(KEY, JSON.stringify({ tasks: [], machines: [], accounts: [], github: [] }));
    status('已清空，正在刷新…');
    setTimeout(function () { location.reload(); }, 500);
  }
  function mount() {
    var imp = document.getElementById('impBtn');
    if (!imp || document.getElementById('csvBtn')) return;
    var b = document.createElement('button');
    b.id = 'csvBtn'; b.type = 'button'; b.className = imp.className;
    b.textContent = 'CSV';
    b.title = '导出 / 导入 CSV 数据表（备份、迁移、批量改数据）';
    imp.parentNode.insertBefore(b, imp.nextSibling);
    b.addEventListener('click', openPanel);
    document.addEventListener('click', function (ev) {
      if (!panel) return;
      if (panel.contains(ev.target) || ev.target.id === 'csvBtn') return;
      closePanel();
    });
    document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') closePanel(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();
</script>
`;

// ---------------------------------------------------------------- 4. 组装输出
const banner = `<!--
================================================================================
  Agent 工作台 · 资料库版 —— 数据源适配说明（给接手改造的 AI / 开发者看）

  ⚠️ 本文件是【生成物】，请勿手改。改 public/index.html 或 server.mjs 后，
     跑  node library/tools/build.mjs  重新生成。

--------------------------------------------------------------------------------
1. 数据读写出口（只有两处，全改完就接上了）
--------------------------------------------------------------------------------
  两处共用同一个 localStorage key：'awb.offline.db.empty'
      localStorage.getItem('awb.offline.db.empty')
      localStorage.setItem('awb.offline.db.empty', JSON.stringify(db))
  → 把这两处的「读 / 写」换成读平台表格、写平台表格即可，其余代码不用动。

--------------------------------------------------------------------------------
2. 数据形状（db 对象）
--------------------------------------------------------------------------------
  一张表 = 一个 CSV，一条记录 = 一行，一个字段 = 一列。
${TABLES.map(t => '  ' + t + ': [ { ' + FIELDS[t].join(', ') + ' } ]').join('\n')}

  ⚠️ machines 的 WorkBuddy账号 / TRAE账号 是派生只读（由 accounts 的「当前」算出），
     存储里不留第二份，CSV 里也没有这两列。接表格时不要给它俩建列。

--------------------------------------------------------------------------------
3. 字段口径（写入前必须校验，否则会写脏）
--------------------------------------------------------------------------------
${Object.entries(ENUMS).map(([t, e]) => Object.entries(e).map(([f, vs]) => '  ' + t + '.' + f + ' = ' + vs.join(' / ')).join('\n')).join('\n')}
  当前 / 仓库归档 / 仓库置顶 = 布尔（CSV 里写「是 / 否」或 true / false 均可）
  必填：${Object.entries(REQUIRED).map(([t, r]) => t + '[' + r.join(',') + ']').join(' ')}

--------------------------------------------------------------------------------
4. 接手时请保留的能力（用户已经在用）
--------------------------------------------------------------------------------
  · 顶栏「复制提示词」：带现状骨架（电脑/任务/待办原文/仓库），AI 据以判断新建还是续写
  · 顶栏「批量导入」：AI 回写长文本 → 预览清单 → 确认后落库
  · 顶栏「CSV」面板：导出 4 个 CSV / 导入 CSV / 清空
  · 搜索同时检索任务看板与 GitHub 看板
  · 手机窄屏下栏顶不置顶
  → 换数据源时这些交互不能丢。

  生成链路与维护说明见 library/维护指南.md
================================================================================
-->
`;

let out = HTML;
const mi = out.indexOf('<head>');
if (mi < 0) throw new Error('public/index.html 里找不到 <head>');
out = banner + out.slice(0, mi + 6) + '\n' + snapLayer + out.slice(mi + 6);
if (!out.includes('</body>')) throw new Error('找不到 </body>');
out = out.replace('</body>', csvLayer + '</body>');

fs.writeFileSync(OUT_HTML, out, 'utf8');
console.log('✓ ' + path.relative(ROOT, OUT_HTML) + '  ' + Math.round(out.length / 1024) + 'KB  (v' + VERSION + ')');

// ---- 4 个空 CSV 模板（只有表头），UTF-8 BOM ----
for (const t of TABLES) {
  const head = FIELDS[t].map(f => (/[",\n]/.test(f) ? '"' + f + '"' : f)).join(',');
  fs.writeFileSync(path.join(LIB, 'awb-' + t + '.csv'), '\uFEFF' + head + '\r\n', 'utf8');
  console.log('✓ library/awb-' + t + '.csv  (' + FIELDS[t].length + ' 列)');
}
console.log('\n字段从 server.mjs SCHEMAS 派生，主项目加字段后重跑本脚本即可同步。');
