#!/usr/bin/env node
// 资料库版「对齐校验」：检查各处对同一件事的说法是否一致。
//
// 用法（在仓库根目录）：
//   node library/tools/check.mjs
//
// 为什么需要它：
//   字段与枚举在这个项目里散落多处（server.mjs SCHEMAS / 4 个 CSV 表头 /
//   资料库版 HTML 内嵌的字段清单 / 提示词的数据形状 / README 的字段口径）。
//   本项目已经踩过两次契约漂移（databaseId↔db、账号语义），靠人记同步不可靠。
//   这个脚本把「对齐」变成可检查的东西：漂移了就报错，而不是等用户发现。
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LIB = path.resolve(HERE, '..');
const ROOT = path.resolve(LIB, '..');

const TABLES = ['tasks', 'machines', 'accounts', 'github'];
// 机器表账号字段是派生只读值，不进 CSV
const DERIVED = { machines: ['WorkBuddy账号', 'TRAE账号'] };

// ---------------------------------------------------------------- 读真源
function readSchemas() {
  const s = fs.readFileSync(path.join(ROOT, 'server.mjs'), 'utf8');
  const start = s.search(/const\s+SCHEMAS\s*=\s*\{/);
  if (start < 0) throw new Error('server.mjs 里找不到 const SCHEMAS = {');
  const open = s.indexOf('{', start);
  let depth = 0, i = open;
  for (; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}') { depth--; if (depth === 0) break; }
  }
  return new Function('return ' + s.slice(open, i + 1))();
}

const SCH = readSchemas();
const EXPECT = {};   // 表 -> 期望的 CSV 列
const ENUM = {};     // 字段名 -> 允许取值
for (const t of TABLES) {
  const drop = DERIVED[t] || [];
  EXPECT[t] = ['_id', ...SCH[t].properties.map(p => p.name).filter(n => !drop.includes(n))];
  for (const p of SCH[t].properties) {
    if (p.type === 'select' && p.config && p.config.options) {
      ENUM[p.name] = p.config.options.map(o => o.text);
    }
  }
}

const problems = [];
const notes = [];
function bad(msg) { problems.push(msg); }

// ---------------------------------------------------------------- ① CSV 表头 vs SCHEMAS
for (const t of TABLES) {
  const f = path.join(LIB, 'awb-' + t + '.csv');
  if (!fs.existsSync(f)) { bad('缺少 CSV 模板：library/awb-' + t + '.csv'); continue; }
  const head = fs.readFileSync(f, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)[0].split(',');
  const got = head.map(x => x.trim());
  const exp = EXPECT[t];
  const miss = exp.filter(x => !got.includes(x));
  const extra = got.filter(x => !exp.includes(x));
  if (miss.length) bad(`awb-${t}.csv 缺少列：${miss.join('、')}`);
  if (extra.length) bad(`awb-${t}.csv 多出列：${extra.join('、')}`);
  if (!miss.length && !extra.length) notes.push(`✓ awb-${t}.csv  ${exp.length} 列与 SCHEMAS 一致`);
}

// ---------------------------------------------------------------- ② 资料库版 HTML 是否过期
// HTML 内嵌了生成时的字段清单。主项目改了 SCHEMAS 却没重跑 build，这里会抓到。
const HTML_PATH = path.join(LIB, 'agent-workbench-资料库版.html');
if (!fs.existsSync(HTML_PATH)) {
  bad('缺少 library/agent-workbench-资料库版.html');
} else {
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  const m = html.match(/var FIELDS = (\{.*?\});\n/);
  if (!m) {
    bad('资料库版 HTML 里找不到内嵌的 FIELDS，可能不是本脚本生成的');
  } else {
    let inner;
    try { inner = JSON.parse(m[1]); } catch (e) { bad('资料库版 HTML 内嵌 FIELDS 解析失败'); }
    if (inner) {
      for (const t of TABLES) {
        const got = inner[t] || [];
        const exp = EXPECT[t];
        if (JSON.stringify(got) !== JSON.stringify(exp)) {
          bad(`资料库版 HTML 已过期：${t} 字段与 SCHEMAS 不一致\n     HTML 内嵌: ${got.join(', ')}\n     SCHEMAS  : ${exp.join(', ')}\n     → 跑 node library/tools/build.mjs 重新生成`);
        }
      }
      notes.push('✓ 资料库版 HTML 内嵌字段与 SCHEMAS 一致（未过期）');
    }
  }
  // 版本号是否与 package.json 一致
  const pkgV = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  const vm = html.match(/var SNAP = \{"schema".*?"version":"([^"]+)"/);
  if (vm && vm[1] !== pkgV) {
    bad(`资料库版 HTML 版本号 ${vm[1]} ≠ package.json ${pkgV} → 重跑 build.mjs`);
  } else if (vm) {
    notes.push(`✓ 版本号一致 v${pkgV}`);
  }
}

// ---------------------------------------------------------------- ③ 文档里的枚举 vs SCHEMAS
// 解析 markdown 表格形如：| `状态` | 进行中 / 已完成 |
function parseEnumTable(text) {
  // 兼容 2 列（| `字段` | 取值 |）与 4 列（| `字段` | 类型 | 必填 | 取值 |）两种表格：
  // 字段名取反引号包裹的首列；取值取「含有 / 且切开后 ≥2 项」的那一列。
  const out = {};
  for (const line of text.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').slice(1, -1).map(x => x.trim());
    if (cells.length < 2) continue;
    const fm = cells[0].match(/^`([^`]+)`$/);
    if (!fm) continue;
    const field = fm[1].trim();
    for (let i = 1; i < cells.length; i++) {
      const cell = cells[i].replace(/[`*]/g, '');
      if (!cell.includes('/') && !cell.includes('／')) continue;
      const vals = cell.split(/[/／]/).map(x => x.trim()).filter(Boolean);
      if (vals.length >= 2) { out[field] = vals; break; }
    }
  }
  return out;
}
const DOC_ENUM_FILES = ['README.md', '接数据源提示词.md', '数据字典.md'];
for (const name of DOC_ENUM_FILES) {
  const f = path.join(LIB, name);
  if (!fs.existsSync(f)) continue;
  const table = parseEnumTable(fs.readFileSync(f, 'utf8'));
  for (const [field, vals] of Object.entries(table)) {
    if (!(field in ENUM)) continue;         // 不是枚举字段，跳过
    const exp = ENUM[field];
    if (JSON.stringify(vals) !== JSON.stringify(exp)) {
      bad(`${name} 里 ${field} 的取值 [${vals.join(' / ')}] ≠ SCHEMAS [${exp.join(' / ')}]`);
    } else {
      notes.push(`✓ ${name} 中 ${field} 枚举与 SCHEMAS 一致`);
    }
  }
}

// ---------------------------------------------------------------- ④ 提示词的数据形状 vs CSV 表头
// 解析形如：- tasks：_id / 任务标题 / 状态 / ...
const promptF = path.join(LIB, '接数据源提示词.md');
if (fs.existsSync(promptF)) {
  const text = fs.readFileSync(promptF, 'utf8');
  for (const t of TABLES) {
    const m = text.match(new RegExp('^[-*]\\s*' + t + '[：:]\\s*(.+)$', 'm'));
    if (!m) { bad(`接数据源提示词.md 缺少 ${t} 的数据形状描述`); continue; }
    const listed = m[1].split(/[/／]/).map(x => x.trim().replace(/[`*]/g, '')).filter(Boolean);
    const exp = EXPECT[t];
    const miss = exp.filter(x => !listed.includes(x));
    const extra = listed.filter(x => !exp.includes(x));
    if (miss.length) bad(`接数据源提示词.md 的 ${t} 漏了字段：${miss.join('、')}`);
    if (extra.length) bad(`接数据源提示词.md 的 ${t} 多出字段：${extra.join('、')}`);
    if (!miss.length && !extra.length) notes.push(`✓ 接数据源提示词.md 的 ${t} 数据形状与 CSV 一致`);
  }
  // 显式提醒派生字段不要建列（这是踩过的坑）
  if (/WorkBuddy账号|TRAE账号/.test(text) && !/派生/.test(text)) {
    bad('接数据源提示词.md 提到了 WorkBuddy账号/TRAE账号 但没说明它们是派生只读');
  }
}

// ---------------------------------------------------------------- 输出
console.log('资料库版 · 对齐校验\n');
for (const n of notes) console.log('  ' + n);
if (problems.length) {
  console.log('\n✗ 发现 ' + problems.length + ' 处不一致：\n');
  problems.forEach((p, i) => console.log('  ' + (i + 1) + '. ' + p));
  console.log('\n常见修法：改了 server.mjs / public/index.html 后跑 node library/tools/build.mjs');
  process.exit(1);
}
console.log('\n✅ 全部对齐（' + notes.length + ' 项）');
