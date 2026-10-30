// 守卫清零审计：检查视图状态层是否还有「补丁式守卫」。
//
// 原则（用户提出）：守卫是补丁打补丁。逻辑写正确了就不需要守卫。
// 判定标准：视图状态层不应出现「拦截/复位非法状态」的代码。
//
// 检查项：
//   1. 视图状态只有单一字段（不出现两个可组合维度）
//   2. setView 内无「非法值兜底」
//   3. 不存在 kpiAllowed / allowedXxx 之类的合法性判断函数
//   4. 取数规则集中在 VIEW 表，且每个视图一条规则
//   5. 渲染层不再有「跳过过滤」式的分支
const { launch } = require('./cdp.cjs');
const { spawn } = require('child_process');
const { seedFixture } = require('./fixture_db.cjs');
const path = require('path');

const PORT = parseInt(process.argv[2] || '8230', 10);
const ROOT = path.dirname(__dirname);

(async () => {
  // 测试专用存储：临时目录 + 相对日期种子夹具，不碰真实数据目录
  const storage = seedFixture(path.join(ROOT, 'tests', '_out', 'storage-' + PORT));
  const server = spawn(process.execPath, [path.join(ROOT, 'server.mjs'), String(PORT)], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CAP_STORAGE_DIR: storage }
  });
  server.stdout.on('data', () => {});
  await new Promise(r => setTimeout(r, 1200));

  let browser = null;
  const problems = [];
  try {
    browser = await launch();
    const { cdp } = browser;
    await browser.goto('http://127.0.0.1:' + PORT + '/');
    await cdp.waitFor('(function(){return document.querySelectorAll("#board .card").length>0})()', 15000);
    await new Promise(r => setTimeout(r, 400));

    const src = require('fs').readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');

    // 1. 状态层只有单一视图字段
    const stateFields = await cdp.evalJson(
      '(function(){return Object.keys(window.__S__||{}).length})()');
    // 页面在 IIFE 里，拿不到 S，改为静态检查源码
    const sDecl = src.match(/var S = \{[\s\S]*?\n  \};/);
    if (!sDecl) problems.push('找不到 S 对象声明');
    else {
      const body = sDecl[0];
      if (/\bseg\s*:/.test(body)) problems.push('S 里还有 seg 字段（视图状态应压成单一枚举）');
      if (/\bkpi\s*:/.test(body)) problems.push('S 里还有 kpi 字段（视图状态应压成单一枚举）');
      if (!/\bview\s*:/.test(body)) problems.push('S 里没有 view 字段');
    }

    // 2. setView 内无非法值兜底
    const sv = src.match(/function setView\(v\) \{[\s\S]*?\n  \}/);
    if (!sv) problems.push('找不到 setView');
    else if (/if\s*\(!VIEW\[/.test(sv[0]) || /v\s*=\s*'doing'/.test(sv[0])) {
      problems.push('setView 内还有「非法值兜底」守卫');
    }

    // 3. 不存在合法性判断函数
    const guardFns = src.match(/function\s+(kpiAllowed|allowed\w+|isValid\w+|checkValid\w+)\s*\(/g);
    if (guardFns) problems.push('仍存在合法性判断函数: ' + guardFns.join(', '));

    // 4. VIEW 表每条规则都存在
    const vm = src.match(/var VIEW = \{([\s\S]*?)\n  \};/);
    if (!vm) problems.push('找不到 VIEW 表');
    else {
      const need = ['doing', 'all', 'done', 'att', 'todo'];
      for (const k of need) {
        if (!new RegExp('\\b' + k + '\\s*:').test(vm[1])) problems.push('VIEW 表缺少视图: ' + k);
      }
    }

    // 5. 渲染层没有「跳过过滤」分支
    if (/function kpiMatch/.test(src)) problems.push('还存在 kpiMatch（旧的二维过滤函数）');
    const vm2 = src.match(/function viewMatch\(t\) \{[\s\S]*?\n  \}/);
    if (!vm2) problems.push('找不到 viewMatch');
    else if (/seg|完成.*return true/.test(vm2[0]) && !/VIEW\[/.test(vm2[0])) {
      problems.push('viewMatch 里有分支式规则（应查 VIEW 表）');
    }

    // 6. 弹窗状态层同样零守卫：单一枚举 S.sheet，不靠多个布尔拼装
    if (/\bdetailMode\s*:/.test(sDecl ? sDecl[0] : '')) {
      problems.push('S 里还有 detailMode（弹窗状态应压成单一枚举 sheet）');
    }
    if (/\bdrawerMode\s*:/.test(sDecl ? sDecl[0] : '')) {
      problems.push('S 里还有 drawerMode（弹窗状态应压成单一枚举 sheet）');
    }
    if (!/\bsheet\s*:/.test(sDecl ? sDecl[0] : '')) {
      problems.push('S 里没有 sheet 字段（弹窗状态应压成单一枚举）');
    }
    // 弹窗 kind 必须是有限枚举，不允许出现「按 id 是否为 null」这类间接判据
    const kinds = src.match(/kind:\s*'([a-zA-Z]+)'/g) || [];
    const kindSet = Array.from(new Set(kinds.map(k => k.match(/'([^']+)'/)[1])));
    const needKinds = ['taskDetail', 'taskForm', 'ghForm', 'repoDetail'];
    for (const k of needKinds) {
      if (!kindSet.includes(k)) problems.push('sheet.kind 缺少: ' + k);
    }
    // 底栏按钮必须由单一函数统一设定，不能散落各处
    const footCalls = (src.match(/\$?'(saveBtn|editBtn|copyBtn|repoAddBtn|repoCopyBtn|delBtn)'\)?\.style\.display/g) || []).length;
    const setFootDef = (src.match(/function setSheetFoot\(f\)/) || []).length;
    if (!setFootDef) problems.push('缺少 setSheetFoot（底栏按钮应由单一函数统一设定）');
    if (footCalls > 8) {
      problems.push('底栏按钮 display 被散落赋值 ' + footCalls + ' 处（应集中到 setSheetFoot）');
    }
    // 不应再有 className 整体覆盖弹窗（会丢掉 wide 等修饰类）
    const clsAssign = src.match(/\$\('(?:drawer|mask|aiDrawer|aiMask|machineModal|m2Mask|confirmModal|cMask)'\)\.className\s*=/g) || [];
    if (clsAssign.length) {
      problems.push('仍用 className 整体覆盖弹窗 class（会丢修饰类，应改 classList）: ' + clsAssign.length + ' 处');
    }
    // 不应再有旧的 centered 变体
    if (/'centered'/.test(src) || /\.drawer\.centered/.test(src)) {
      problems.push('仍残留 centered 变体（所有弹窗应统一居中形态）');
    }

    // 7. 运行时验证：视图表能覆盖所有可能的视图值
    const runtime = await cdp.evalJson(`(function(){
      // 从页面里读不到 IIFE 内的 VIEW，改为验证外部可观察的行为
      var out={};
      var seg=document.getElementById('segTabs');
      out.分段按钮数=seg?seg.querySelectorAll('button').length:0;
      out.KPI卡数=document.querySelectorAll('#summary .kpi').length;
      return out;
    })()`);
    if (runtime.分段按钮数 !== 3) problems.push('分段按钮数应为 3，实际 ' + runtime.分段按钮数);
    if (runtime.KPI卡数 !== 4) problems.push('KPI 卡数应为 4，实际 ' + runtime.KPI卡数);

    console.log('=== 守卫清零审计 ===');
    if (problems.length) {
      console.log('发现 ' + problems.length + ' 个问题:');
      problems.forEach(p => console.log('  ✗ ' + p));
      process.exitCode = 1;
    } else {
      console.log('✓ 视图状态层零守卫：单一枚举 + 查表取数 + 无合法性判断');
    }
  } catch (e) {
    console.error('失败: ' + e.message);
    process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
})();
