// 老库迁移回归：v1.0.x 的机器表单值账号 → accounts 表。
// 关键点：迁移是「搬走」不是「删掉」——一旦只清了旧字段却没生成记录，用户的号就没了。
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const PORT = parseInt(process.argv[2] || '8296', 10);
const ROOT = path.dirname(__dirname);
const STORAGE = path.join(ROOT, 'tests', '_out', 'storage-migrate-' + PORT);

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail !== undefined && detail !== '' ? '  → ' + detail : ''));
}

function getJSON(p) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path: p }, res => {
      let s = '';
      res.on('data', d => s += d);
      res.on('end', () => { try { resolve(JSON.parse(s)); } catch (e) { reject(e); } });
    }).on('error', reject);
  });
}

function boot() {
  const server = spawn(process.execPath, [path.join(ROOT, 'server.mjs'), String(PORT)], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CAP_STORAGE_DIR: STORAGE }
  });
  server.stdout.on('data', () => {});
  server.stderr.on('data', d => process.stderr.write('[srv] ' + d));
  return server;
}

const wait = ms => new Promise(r => setTimeout(r, ms));

// 线上真实存储是扁平记录：_id + 字段名直接做 key（不是 {id, properties}）
function oldDb() {
  return {
    machines: [
      { _id: 'm1', '机器名': '4070S', '位置': '书房', 'WorkBuddy账号': '坤坤', 'TRAE账号': '小黄trae', '最后确认': '2026-10-20', '排序': 1 },
      { _id: 'm2', '机器名': '4070TiSuper', '位置': '卧室', 'WorkBuddy账号': '小黄', 'TRAE账号': '鲁妈妈trae', '最后确认': '2026-10-21', '排序': 2 },
      // 这台只有「未登录」和空串：必须一条都不生成，别把「未登录」当账号
      { _id: 'm3', '机器名': 'RedmiBook', '位置': '随身', 'WorkBuddy账号': '未登录', 'TRAE账号': '', '排序': 3 },
      // 脏记录：没有机器名，不能参与迁移，也不能被清字段
      { _id: 'm9', 'WorkBuddy账号': '孤儿号' }
    ],
    tasks: [],
    github: []
  };
}

(async () => {
  fs.rmSync(STORAGE, { recursive: true, force: true });
  fs.mkdirSync(STORAGE, { recursive: true });
  fs.writeFileSync(path.join(STORAGE, 'db.json'), JSON.stringify(oldDb(), null, 2));

  let server = boot();
  await wait(1200);

  try {
    // ---------- 1. 迁移生成账号记录 ----------
    const d1 = await getJSON('/api/query?db=accounts');
    const accs = d1.results || [];
    const tag = a => a['账号名'] + '/' + a['平台'] + (a['当前'] ? '*' : '');
    check('老库账号被搬进 accounts 表', accs.length === 4, accs.map(tag).join(' '));
    check('按机器 × 平台拆成 4 条', JSON.stringify(accs.map(tag).sort()) ===
      JSON.stringify(['坤坤/WorkBuddy*', '小黄/WorkBuddy*', '小黄trae/TRAE*', '鲁妈妈trae/TRAE*']),
      accs.map(tag).sort().join(' '));
    check('「未登录」没有被写成账号', accs.every(a => a['账号名'] !== '未登录'), accs.map(a => a['账号名']).join('/'));
    check('迁移来的号都是「当前」', accs.every(a => a['当前'] === true), accs.filter(a => !a['当前']).length + ' 条非当前');
    check('所属电脑跟着机器名', accs.filter(a => a['所属电脑'] === '4070TiSuper').length === 2,
      accs.map(a => a['所属电脑']).join('/'));

    // ---------- 2. 机器表旧字段清空、派生值正确 ----------
    // 注意：/api/query 对 machines 是派生视图（账号字段按 accounts 现算），
    // 所以「字段有没有真的清掉」必须看落盘的 db.json，不能看查询结果。
    const raw0 = JSON.parse(fs.readFileSync(path.join(STORAGE, 'db.json'), 'utf8'));
    const raw1 = (raw0.machines || []).filter(m => m._id === 'm1')[0] || {};
    const raw9 = (raw0.machines || []).filter(m => m._id === 'm9')[0] || {};
    const d2 = await getJSON('/api/query?db=machines');
    const macs = d2.results || [];
    const byName = n => macs.filter(m => m['机器名'] === n)[0] || {};
    check('迁移后机器表落地不再存账号字段', !('WorkBuddy账号' in raw1) && !('TRAE账号' in raw1),
      JSON.stringify(Object.keys(raw1)));
    check('读接口派生回当前账号', byName('4070S')['WorkBuddy账号'] === '坤坤' && byName('4070S')['TRAE账号'] === '小黄trae',
      JSON.stringify([byName('4070S')['WorkBuddy账号'], byName('4070S')['TRAE账号']]));
    check('只有「未登录」的机器派生为空', byName('RedmiBook')['WorkBuddy账号'] === '' && byName('RedmiBook')['TRAE账号'] === '',
      JSON.stringify([byName('RedmiBook')['WorkBuddy账号'], byName('RedmiBook')['TRAE账号']]));
    check('没有机器名的脏记录没被清字段', raw9['WorkBuddy账号'] === '孤儿号', JSON.stringify(raw9));

    // ---------- 3. 幂等：重启不会重复生成 ----------
    const raw = JSON.parse(fs.readFileSync(path.join(STORAGE, 'db.json'), 'utf8'));
    check('库里写了迁移标记', !!raw._meta && !!raw._meta.accountsMigrated, JSON.stringify(raw._meta));
    check('库里账号数是 4', (raw.accounts || []).length === 4, String((raw.accounts || []).length));

    server.kill();
    await wait(600);
    server = boot();
    await wait(1200);
    const d3 = await getJSON('/api/query?db=accounts');
    check('重启后不重复迁移', (d3.results || []).length === 4, String((d3.results || []).length));
    const d4 = await getJSON('/api/query?db=machines');
    check('重启后派生值仍然正确', (d4.results || []).filter(m => m['机器名'] === '4070TiSuper')[0]['TRAE账号'] === '鲁妈妈trae',
      JSON.stringify((d4.results || []).filter(m => m['机器名'] === '4070TiSuper')[0]['TRAE账号']));

    // ---------- 4. 升级后还能继续加号（迁移不是死胡同）----------
    const body = JSON.stringify({
      db: 'accounts',
      properties: {
        '账号名': { text: '坤坤-小号' }, '平台': { select: 'WorkBuddy' },
        '所属电脑': { text: '4070S' }, '当前': { checkbox: false }
      }
    });
    const added = await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: PORT, path: '/api/records', method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, res => {
        let s = ''; res.on('data', d => s += d); res.on('end', () => { try { resolve(JSON.parse(s)); } catch (e) { reject(e); } });
      });
      req.on('error', reject); req.write(body); req.end();
    });
    check('迁移后还能新增账号', !!added && !!added.id, JSON.stringify(added).slice(0, 120));
    const d5 = await getJSON('/api/query?db=accounts');
    const pool = (d5.results || []).filter(a => a['所属电脑'] === '4070S' && a['平台'] === 'WorkBuddy');
    // 4070S 原本只有「坤坤」一个号，加完是 2 条：老号必须还在，不能被新号顶掉
    check('新增后老号还在（2 条）', pool.length === 2 && pool.some(a => a['账号名'] === '坤坤'), pool.map(tag).join(' '));
    check('新增没有顶掉当前账号', (d5.results || []).filter(a => a['所属电脑'] === '4070S' && a['平台'] === 'WorkBuddy' && a['当前']).length === 1,
      pool.filter(a => a['当前']).map(a => a['账号名']).join('/'));
  } catch (e) {
    check('执行未抛错', false, e && e.message);
    console.error(e);
  } finally {
    server.kill();
  }

  const failed = results.filter(r => !r.ok);
  console.log('');
  if (failed.length) {
    console.log('FAILED ' + failed.length + '/' + results.length);
    failed.forEach(f => console.log('  - ' + f.name));
    process.exit(1);
  }
  console.log('ALL PASS (' + results.length + ' 项)');
})();
