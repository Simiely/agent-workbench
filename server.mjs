// Agent 工作台 · tools-center 本地版
// 零依赖：静态托管 public/ + 四张表的 JSON 文件存储（tasks / machines / accounts / github）
// 数据独立存放：平台注入 CAP_STORAGE_DIR 时用它；本地直跑时落在仓库外的
// ../agent-workbench-data/（数据与代码分离，仓库永远不带数据）。
// 表结构与字段名和资料库版完全一致，前端业务代码零改动。
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = parseInt(process.argv[2] || process.env.PORT || "8151", 10);
const storageDir = process.env.CAP_STORAGE_DIR || path.join(__dirname, "..", "agent-workbench-data");
const dataFile = path.join(storageDir, "db.json");
const publicDir = path.join(__dirname, "public");
// --reseed：把四张表重置为内置演示数据（先备份旧文件）。
// 只想看效果时用：node server.mjs 8151 --reseed；日常使用不需要，首启即是空壳。
const RESEED = process.argv.includes("--reseed");

// 启动自检：存储目录必须可写。平台注入只读目录时，所有添加/保存都会 500 ——
// 启动日志与 /health 先把原因暴露出来，不用等到点添加才发现。
let storageOk = true, storageErr = "";
// 版本号单一事实来源是 package.json；/health 与页面顶栏都从这里拿
let APP_VERSION = "";
try { APP_VERSION = JSON.parse(fs.readFileSync(path.join(__dirname, "package.json"), "utf8")).version || ""; }
catch (e) { APP_VERSION = ""; }
try {
  fs.mkdirSync(storageDir, { recursive: true });
  const probe = path.join(storageDir, ".write-probe");
  fs.writeFileSync(probe, "ok");
  fs.unlinkSync(probe);
} catch (e) {
  storageOk = false;
  storageErr = e.message;
}

// 表结构：name/type/config 与资料库 SDK 的 getSchema 返回对齐，
// 前端 readOpts 从 config.options[].text 读下拉选项。
const SCHEMAS = {
  tasks: {
    label: "Agent 任务台账",
    properties: [
      { name: "任务标题", type: "text" },
      { name: "状态", type: "select", config: { options: [{ text: "进行中" }, { text: "已完成" }] } },
      { name: "优先级", type: "select", config: { options: [{ text: "P0" }, { text: "P1" }, { text: "P2" }] } },
      { name: "目录", type: "text" },
      { name: "进度", type: "text" },
      { name: "待办", type: "text" },
      { name: "交接内容", type: "text" },
      { name: "更新时间", type: "date" },
      { name: "所在电脑", type: "text" },
      { name: "排序", type: "number" },
    ],
  },
  machines: {
    label: "机器登录态",
    properties: [
      { name: "机器名", type: "text" },
      { name: "位置", type: "text" },
      { name: "WorkBuddy账号", type: "text" },
      { name: "TRAE账号", type: "text" },
      { name: "最后确认", type: "date" },
      { name: "排序", type: "number" },
    ],
  },
  // 登录账号：一台电脑 × 一个平台可以有多个账号，其中至多一条「当前」。
  // machines 表的 WorkBuddy账号 / TRAE账号 不再落盘，读接口按本表实时派生，
  // 老契约（直接写机器表的账号字段）由写入侧翻译成一次「设为当前」。
  accounts: {
    label: "登录账号",
    properties: [
      { name: "账号名", type: "text" },
      { name: "平台", type: "select", config: { options: [{ text: "WorkBuddy" }, { text: "TRAE" }] } },
      { name: "所属电脑", type: "text" },
      { name: "当前", type: "checkbox" },
      { name: "备注", type: "text" },
      { name: "最后确认", type: "date" },
      { name: "排序", type: "number" },
    ],
  },
  github: {
    label: "GitHub 同步记录",
    properties: [
      { name: "同步时间", type: "date" },
      { name: "电脑", type: "text" },
      { name: "GitHub账号", type: "text" },
      { name: "仓库", type: "text" },
      { name: "内容", type: "text" },
      { name: "同步版本", type: "text" },
      { name: "是否同步", type: "select", config: { options: [{ text: "已同步" }, { text: "未同步" }] } },
      { name: "仓库归档", type: "checkbox" },
      // 仓库级置顶：任意一条记录勾上即视为置顶（与「仓库归档」同一套口径，不另建表）
      { name: "仓库置顶", type: "checkbox" },
    ],
  },
};

/* ===================== 写入校验 ===================== */
// 契约里写了「必填 / 枚举」，就必须在服务端兑现。AI 写入不经过表单，
// 只靠前端校验等于没有校验：脏数据会直接落盘，看板再靠兜底列来收拾。
const REQUIRED = {
  // 只强制「身份 / 枚举」这类缺了就说不清是谁的字段；
  // 时间戳与可空的描述字段由 applyDefaults 补默认值，而不是直接拒写。
  tasks: ["任务标题", "状态", "优先级", "所在电脑"],
  machines: ["机器名"],
  accounts: ["账号名", "平台", "所属电脑"],
  github: ["电脑", "仓库"],
};
const ENUMS = {
  tasks: { 状态: ["进行中", "已完成"], 优先级: ["P0", "P1", "P2"] },
  accounts: { 平台: ["WorkBuddy", "TRAE"] },
  github: { 是否同步: ["已同步", "未同步"] },
};

function blank(v) {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return !v.trim();
  return false;
}

// 缺省值：时间戳与状态缺了就补一个合理默认，比 400 拒写更贴合实际写入习惯
function applyDefaults(dbKey, rec, isNew) {
  if (!isNew) return;
  const now = new Date().toISOString();
  if (dbKey === "tasks" && blank(rec["更新时间"])) rec["更新时间"] = now;
  if (dbKey === "github") {
    if (blank(rec["同步时间"])) rec["同步时间"] = now;
    if (blank(rec["是否同步"])) rec["是否同步"] = "已同步";
  }
}

// 返回中文错误文案；通过返回 null。
// isNew 校验全部必填；PATCH 只校验「这次真正传了的字段」（fields），
// 否则一条历史脏记录连改个位置都会被永久拒写。
function checkRecord(d, dbKey, rec, opts) {
  const isNew = !!(opts && opts.isNew);
  const selfId = opts && opts.selfId;
  const touched = opts && opts.fields;
  const inScope = (f) => isNew || (touched && touched.includes(f));
  const required = REQUIRED[dbKey] || [];
  for (const f of required) {
    if (!inScope(f)) continue;
    if (blank(rec[f])) return `${f}不能为空`;
  }
  const enums = ENUMS[dbKey] || {};
  for (const field of Object.keys(enums)) {
    if (!inScope(field) || blank(rec[field])) continue;
    if (!enums[field].includes(rec[field])) return `${field}只能是 ${enums[field].join(" / ")}`;
  }
  // 机器名必须唯一：重名会让「所在电脑」指向两台机，任务列与账号池都会错乱
  if (dbKey === "machines" && inScope("机器名")) {
    const name = String(rec["机器名"] || "").trim();
    const dup = (d.machines || []).some((m) => m._id !== selfId && String(m["机器名"] || "").trim() === name);
    if (dup) return "已经有同名电脑了";
  }
  return null;
}

/* ===================== 登录账号：派生、迁移与不变量 ===================== */
// 一台电脑 × 一个平台 = 一个账号池，池里至多一条「当前」。
// 机器表上的账号字段是派生值（只读），真相在 accounts 表。
const PLATFORMS = ["WorkBuddy", "TRAE"];
const MACHINE_NAME = "机器名";
const MACHINE_ACC_FIELD = { WorkBuddy: "WorkBuddy账号", TRAE: "TRAE账号" };
const ACC = { name: "账号名", plat: "平台", mach: "所属电脑", cur: "当前", note: "备注", at: "最后确认", order: "排序" };

function accOrder(a) {
  return typeof a[ACC.order] === "number" ? a[ACC.order] : 9999;
}

// 某台机某个平台的账号，按「排序」升序（没有排序的排后面，保持写入顺序）
function machineAccounts(d, machineName, platform) {
  return (d.accounts || [])
    .filter((a) => a[ACC.mach] === machineName && a[ACC.plat] === platform)
    .sort((x, y) => accOrder(x) - accOrder(y));
}

// 当前账号：只认显式的「当前」标记。一条都没标 = 未登录（账号仍留在池里，只是没在用）
function currentAccountOf(d, machineName, platform) {
  const list = machineAccounts(d, machineName, platform);
  return list.find((a) => a[ACC.cur] === true) || null;
}

function nextAccOrder(d, machineName, platform) {
  const list = machineAccounts(d, machineName, platform);
  let max = 0;
  for (const a of list) if (typeof a[ACC.order] === "number" && a[ACC.order] > max) max = a[ACC.order];
  return max + 1;
}

// 把同池的其他账号置为「非当前」
function markCurrent(d, machineName, platform, winnerId) {
  for (const a of machineAccounts(d, machineName, platform)) a[ACC.cur] = a._id === winnerId;
}

// 读接口派生：机器记录的账号字段 = 当前账号（不落盘）
function deriveMachine(d, m) {
  const out = { ...m };
  for (const p of PLATFORMS) {
    const cur = currentAccountOf(d, m["机器名"], p);
    out[MACHINE_ACC_FIELD[p]] = cur ? (cur[ACC.name] || "") : "";
  }
  return out;
}

// 老契约兼容：agent 直接写机器表的账号字段 = 把那个号设为当前（库里没有就补一条）
function applyMachineAccountWrite(d, machineName, properties) {
  if (!machineName) return;
  for (const p of PLATFORMS) {
    const f = MACHINE_ACC_FIELD[p];
    if (!(f in properties)) continue;
    const raw = unwrap(properties[f]);
    const v = String(raw == null ? "" : raw).trim();
    delete properties[f];
    const list = machineAccounts(d, machineName, p);
    if (!v || v === "未登录") {
      for (const a of list) a[ACC.cur] = false;
      continue;
    }
    let hit = list.find((a) => String(a[ACC.name] || "").trim() === v);
    if (!hit) {
      hit = {
        _id: newId(), [ACC.name]: v, [ACC.plat]: p, [ACC.mach]: machineName,
        [ACC.cur]: true, [ACC.note]: "", [ACC.at]: new Date().toISOString(),
        [ACC.order]: nextAccOrder(d, machineName, p),
      };
      d.accounts.push(hit);
    }
    markCurrent(d, machineName, p, hit._id);
  }
}

// 一次性迁移：机器表里的单值账号 → accounts 表一条「当前」
// 幂等：靠 db._meta.accountsMigrated 标记 + 同名同机同平台去重
function migrateAccounts(d) {
  d.accounts = Array.isArray(d.accounts) ? d.accounts : [];
  if (d._meta && d._meta.accountsMigrated) return false;
  let added = 0;
  for (const m of d.machines || []) {
    const machineName = String(m[MACHINE_NAME] || "").trim();
    // 没有机器名的脏记录不参与迁移，也不清字段：宁可留着旧值，也不能把账号删没
    if (!machineName) continue;
    for (const p of PLATFORMS) {
      const v = String(m[MACHINE_ACC_FIELD[p]] || "").trim();
      if (!v || v === "未登录") continue;
      if (machineAccounts(d, machineName, p).some((a) => String(a[ACC.name] || "").trim() === v)) continue;
      d.accounts.push({
        _id: newId(), [ACC.name]: v, [ACC.plat]: p, [ACC.mach]: machineName,
        [ACC.cur]: true, [ACC.note]: "", [ACC.at]: m["最后确认"] || "",
        [ACC.order]: nextAccOrder(d, machineName, p),
      });
      added++;
    }
    // 这台机已经搬进 accounts 表了，旧字段就地清掉，避免两份真相
    delete m[MACHINE_ACC_FIELD.WorkBuddy];
    delete m[MACHINE_ACC_FIELD.TRAE];
  }
  d._meta = { ...(d._meta || {}), accountsMigrated: new Date().toISOString() };
  return true;
}

// 账号池里没有「当前」时顺延第一条（删掉当前账号后不能让整台机变成未登录）
function ensureCurrent(d, machineName, platform) {
  const list = machineAccounts(d, machineName, platform);
  if (!list.length) return;
  if (list.some((a) => a[ACC.cur] === true)) return;
  list[0][ACC.cur] = true;
}

// 账号记录校验 + 建记录时的默认值（PATCH 只校验传入的字段，不动没传的）
function normalizeAccount(d, rec, opts) {
  const isNew = !!(opts && opts.isNew);
  const selfId = opts && opts.selfId;
  if (isNew || ACC.name in rec) {
    const name = String(rec[ACC.name] || "").trim();
    if (!name) return "账号名不能为空";
    rec[ACC.name] = name;
  }
  if (isNew || ACC.mach in rec) {
    const mach = String(rec[ACC.mach] || "").trim();
    if (!mach) return "所属电脑不能为空";
    rec[ACC.mach] = mach;
  }
  if (isNew || ACC.plat in rec) {
    const p = rec[ACC.plat];
    if (p !== "WorkBuddy" && p !== "TRAE") return "平台只能是 WorkBuddy / TRAE";
    rec[ACC.plat] = p;
  }
  if (ACC.name in rec && rec[ACC.mach] && rec[ACC.plat]) {
    const name = String(rec[ACC.name] || "").trim();
    const dup = machineAccounts(d, rec[ACC.mach], rec[ACC.plat])
      .some((a) => a._id !== selfId && String(a[ACC.name] || "").trim() === name);
    if (dup) return "这台电脑在这个平台下已有同名账号";
  }
  if (!isNew) return null;
  if (typeof rec[ACC.order] !== "number") rec[ACC.order] = nextAccOrder(d, rec[ACC.mach], rec[ACC.plat]);
  if (typeof rec[ACC.cur] !== "boolean") rec[ACC.cur] = false;
  if (!rec[ACC.note]) rec[ACC.note] = "";
  if (!rec[ACC.at]) rec[ACC.at] = new Date().toISOString();
  // 池里还没有「在用」的账号：新加的这条自动成为当前，否则录完还是显示未登录
  if (!machineAccounts(d, rec[ACC.mach], rec[ACC.plat]).some((a) => a[ACC.cur] === true)) rec[ACC.cur] = true;
  return null;
}

function seed() {
  const daysAgo = (n, h = 10) => {
    const d = new Date(Date.now() - n * 86400000);
    d.setHours(h, 20, 0, 0);
    return d.toISOString();
  };
  return {
    machines: [
      { _id: "m1", "机器名": "台式机-家", "位置": "家", "最后确认": daysAgo(0), "排序": 1 },
      { _id: "m2", "机器名": "笔记本", "位置": "随身", "最后确认": daysAgo(1), "排序": 2 },
      { _id: "m3", "机器名": "N100-小主机", "位置": "客厅", "最后确认": daysAgo(6), "排序": 3 },
    ],
    // 演示「一台机多个号」：台式机-家 的 WorkBuddy 有主号 + 备用号，当前 = 主号
    accounts: [
      { _id: "a1", "账号名": "WB-主号", "平台": "WorkBuddy", "所属电脑": "台式机-家", "当前": true, "备注": "公司号", "最后确认": daysAgo(0), "排序": 1 },
      { _id: "a2", "账号名": "WB-备用号", "平台": "WorkBuddy", "所属电脑": "台式机-家", "当前": false, "备注": "个人号", "最后确认": daysAgo(20), "排序": 2 },
      { _id: "a3", "账号名": "TRAE-主号", "平台": "TRAE", "所属电脑": "台式机-家", "当前": true, "备注": "", "最后确认": daysAgo(0), "排序": 1 },
      { _id: "a4", "账号名": "WB-副号", "平台": "WorkBuddy", "所属电脑": "笔记本", "当前": true, "备注": "", "最后确认": daysAgo(1), "排序": 1 },
      { _id: "a5", "账号名": "TRAE-副号", "平台": "TRAE", "所属电脑": "笔记本", "当前": true, "备注": "", "最后确认": daysAgo(1), "排序": 1 },
      { _id: "a6", "账号名": "WB-主号", "平台": "WorkBuddy", "所属电脑": "N100-小主机", "当前": true, "备注": "", "最后确认": daysAgo(6), "排序": 1 },
    ],
    _meta: { accountsMigrated: daysAgo(0) },
    tasks: [
      { _id: "t1", "任务标题": "ae-tools v1.5.8 发布联调", "状态": "进行中", "优先级": "P1", "所在电脑": "台式机-家",
        "目录": "D:\\ae-tools", "进度": "CHANGELOG / panel README / 测试文件三件套已同步",
        "待办": "[x] 版本号对齐 v1.5.8\n[x] 测试文件更新\n[ ] MountainSpectrum 解耦「父层变换」与「控制点固定形状」\n[ ] 沙箱验证后推 remote",
        "交接内容": "解耦时先动 src/ 下的变换矩阵，控制点数组结构保持不变，回滚点见 CHANGELOG v1.5.7。",
        "更新时间": daysAgo(0, 9), "排序": 1 },
      { _id: "t2", "任务标题": "local-llm-playbook 部署方案评估", "状态": "进行中", "优先级": "P1", "所在电脑": "台式机-家",
        "目录": "D:\\local-llm-playbook", "进度": "候选模型对比表已建，待补权重评分",
        "待办": "[ ] Qwen3 / GLM 系列在 16GB VRAM 的实测\n[ ] hf-mirror 与 modelscope 下载脚本\n[ ] 定稿「一套主方案 + 参数级切换」",
        "交接内容": "阅读模式是逐篇处理（5000+ 字中文长文档），32K 上下文够用，不要整本书方案。",
        "更新时间": daysAgo(1, 15), "排序": 2 },
      { _id: "t3", "任务标题": "floorplan 编辑器 v0.3 做减法", "状态": "进行中", "优先级": "P2", "所在电脑": "笔记本",
        "目录": "D:\\home-inventory", "进度": "paint/fill/sample/split 已合并成多步流程",
        "待办": "[ ] 移除剩余低频工具\n[ ] 渲染端 floorplan.js 与模块源码对齐\n[ ] 作为子模块嵌入宿主",
        "交接内容": "产品可用性优先，必要时调整 home-inventory 宿主来适配模块，不要反过来。",
        "更新时间": daysAgo(2, 11), "排序": 1 },
      { _id: "t4", "任务标题": "LoginStateSwitcher 12 槽位维护", "状态": "进行中", "优先级": "P0", "所在电脑": "台式机-家",
        "目录": "C:\\tools\\LoginStateSwitcher", "进度": "MultiSwitch 切换正常，GitHub 已同步",
        "待办": "[ ] WorkBuddy 侧新增账号的槽位登记\n[ ] exe 重新打包",
        "交接内容": "",
        "更新时间": daysAgo(3, 20), "排序": 3 },
      { _id: "t5", "任务标题": "本地 AI 视频三线部署", "状态": "进行中", "优先级": "P2", "所在电脑": "台式机-家",
        "目录": "E:\\ai-video", "进度": "FlashVSR 升频跑通，SeedVR2 显存待调",
        "待办": "[ ] SeedVR2 在 16GB VRAM 的分段策略\n[ ] MiniMax H3 生成链路验证\n[ ] E 盘素材目录整理",
        "交接内容": "素材进 E:\\素材，产出统一落 E:\\产出，C 盘只放程序和模型。",
        "更新时间": daysAgo(5, 14), "排序": 4 },
      { _id: "t6", "任务标题": "知识库项目推 GitHub（四件套）", "状态": "已完成", "优先级": "P2", "所在电脑": "笔记本",
        "目录": "D:\\knowledge-base", "进度": "README / AGENTS / DEVELOPMENT / CHANGELOG 已齐",
        "待办": "[x] single-project 模板套用\n[x] 推送 Simiely/knowledge-base",
        "交接内容": "",
        "更新时间": daysAgo(4, 18), "排序": 2 },
      { _id: "t7", "任务标题": "HyperOS 4 定制 AOD", "状态": "已完成", "优先级": "P2", "所在电脑": "笔记本",
        "目录": "", "进度": "主题编辑器产出 mtz，已刷机预览",
        "待办": "[x] AOD 版式设计\n[x] 刷机验证",
        "交接内容": "字体渲染在深色下偏细，后续版本可以加粗一档。",
        "更新时间": daysAgo(9, 16), "排序": 3 },
      { _id: "t8", "任务标题": "Slay the Spire 2 存档备份", "状态": "已完成", "优先级": "P2", "所在电脑": "N100-小主机",
        "目录": "C:\\Saves\\StS2", "进度": "255 层进度已备份，自定义 profile 已留档",
        "待办": "[x] Goldberg/GSE 存档目录定位\n[x] 备份脚本",
        "交接内容": "",
        "更新时间": daysAgo(12, 21), "排序": 5 },
    ],
    github: [
      // 记录级状态 = 是否同步（本地做完还没推就是「未同步」）；仓库级 = 是否归档
      { _id: "g1", "同步时间": daysAgo(0, 9), "电脑": "台式机-家", "GitHub账号": "Simiely", "仓库": "Simiely/ae-tools", "内容": "v1.5.8 发布：CHANGELOG + panel README + 测试文件", "同步版本": "v1.5.8", "是否同步": "已同步", "仓库归档": false },
      { _id: "g2", "同步时间": daysAgo(1, 16), "电脑": "台式机-家", "GitHub账号": "Simiely", "仓库": "Simiely/ae-tools", "内容": "MountainSpectrum 控制点驱动重构", "同步版本": "v1.5.7", "是否同步": "已同步", "仓库归档": false },
      { _id: "g3", "同步时间": daysAgo(2, 11), "电脑": "台式机-家", "GitHub账号": "Simiely", "仓库": "Simiely/ae-tools", "内容": "低频工具合并，本地先攒着", "同步版本": "v1.5.6", "是否同步": "未同步", "仓库归档": false },
      { _id: "g4", "同步时间": daysAgo(3, 10), "电脑": "台式机-家", "GitHub账号": "Simiely", "仓库": "Simiely/LoginStateSwitcher", "内容": "MultiSwitch 12 槽位加密调整", "同步版本": "v2.3.0", "是否同步": "已同步", "仓库归档": false },
      { _id: "g5", "同步时间": daysAgo(4, 18), "电脑": "笔记本", "GitHub账号": "Simiely", "仓库": "Simiely/knowledge-base", "内容": "README 先行", "同步版本": "v0.1.0", "是否同步": "已同步", "仓库归档": false },
      { _id: "g6", "同步时间": daysAgo(6, 13), "电脑": "笔记本", "GitHub账号": "Simiely", "仓库": "Simiely/knowledge-base", "内容": "AGENTS / DEVELOPMENT / CHANGELOG 三件套完成，还没推", "同步版本": "v0.2.0", "是否同步": "未同步", "仓库归档": false },
      { _id: "g7", "同步时间": daysAgo(6, 15), "电脑": "台式机-家", "GitHub账号": "Simiely", "仓库": "Simiely/workbuddy-skills", "内容": "scenario-walkthrough v3 上架", "同步版本": "v3.0.0", "是否同步": "已同步", "仓库归档": false },
      { _id: "g8", "同步时间": daysAgo(8, 20), "电脑": "笔记本", "GitHub账号": "Simiely", "仓库": "Simiely/home-inventory", "内容": "floorplan 子模块嵌入改造", "同步版本": "v0.3.0", "是否同步": "已同步", "仓库归档": false },
      { _id: "g9", "同步时间": daysAgo(11, 14), "电脑": "笔记本", "GitHub账号": "Simiely", "仓库": "Simiely/home-inventory", "内容": "低频工具合并成多步流程，本地先攒着", "同步版本": "v0.3.1", "是否同步": "未同步", "仓库归档": false },
      { _id: "g10", "同步时间": daysAgo(13, 9), "电脑": "台式机-家", "GitHub账号": "Simiely", "仓库": "Simiely/tools-center", "内容": "tool.json V1 兼容映射验证", "同步版本": "v0.7.0", "是否同步": "已同步", "仓库归档": false },
      { _id: "g11", "同步时间": daysAgo(20, 15), "电脑": "台式机-家", "GitHub账号": "Simiely", "仓库": "Simiely/local-llm-playbook", "内容": "playbook 骨架", "同步版本": "v0.1.0", "是否同步": "已同步", "仓库归档": false },
      { _id: "g12", "同步时间": daysAgo(30, 16), "电脑": "笔记本", "GitHub账号": "Simiely", "仓库": "Simiely/hyperos-aod-theme", "内容": "AOD 定制主题定稿，项目结束归档", "同步版本": "v1.0", "是否同步": "已同步", "仓库归档": true },
    ],
  };
}

// --reseed 只在进程启动后的第一次读库生效；否则每个请求都会重新播种，
// 演示模式下的任何录入（新增账号、改任务）都会被下一次读取抹掉。
let reseedPending = RESEED;
// 最近一次「读库异常」的原因：/health 会带出来，便于平台侧排查（损坏、权限）
let lastDbError = "";

function emptyDb() {
  const d = {};
  for (const k of Object.keys(SCHEMAS)) d[k] = [];
  return d;
}

function loadDb() {
  if (reseedPending) {
    reseedPending = false;
    const d = seed();
    for (const k of Object.keys(SCHEMAS)) if (!Array.isArray(d[k])) d[k] = [];
    saveDb(d);
    console.log("reseeded: " + Object.keys(SCHEMAS).map(k => k + "=" + d[k].length).join(", "));
    return d;
  }
  let raw;
  try {
    raw = fs.readFileSync(dataFile, "utf8");
  } catch (e) {
    // 「读不到」不等于「没有」：权限/占用这类错误如果当成空库，下一次写盘就把真数据覆盖了
    if (e.code !== "ENOENT") throw new Error("读取数据库失败（" + e.message + "）");
    // 首次启动 = 空壳：四张表全空，不预置任何演示数据（想看效果用 --reseed）
    const d0 = emptyDb();
    saveDb(d0);
    return d0;
  }
  let d;
  try {
    d = JSON.parse(raw);
  } catch (e) {
    // 解析失败：先把损坏原文完整留一份，再按空壳继续 —— 绝不就地覆盖
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const bad = path.join(storageDir, "db.corrupt-" + stamp + ".json");
    try { fs.writeFileSync(bad, raw); } catch (e2) { /* 留档失败不阻断启动 */ }
    lastDbError = "数据库 JSON 损坏，原文已另存为 " + path.basename(bad) + "，已按空库启动";
    console.error("⚠ " + lastDbError);
    const d1 = emptyDb();
    saveDb(d1);
    return d1;
  }
  for (const k of Object.keys(SCHEMAS)) if (!Array.isArray(d[k])) d[k] = [];
  // 老库首启：机器表的单值账号搬进 accounts 表（幂等，写盘一次）
  if (migrateAccounts(d)) saveDb(d);
  return d;
}

function backupDb() {
  // 每次写盘前先留一份快照（保留最近 10 份），误删可回滚
  try {
    if (!fs.existsSync(dataFile)) return;
    const dir = path.join(storageDir, ".bak");
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    fs.copyFileSync(dataFile, path.join(dir, `db-${stamp}.json`));
    const files = fs.readdirSync(dir).filter((f) => f.startsWith("db-") && f.endsWith(".json")).sort();
    while (files.length > 10) { try { fs.unlinkSync(path.join(dir, files.shift())); } catch (e) {} }
  } catch (e) { /* 备份失败不阻断写入 */ }
}

function saveDb(d) {
  backupDb();
  fs.mkdirSync(storageDir, { recursive: true });
  const tmp = dataFile + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(d, null, 2));
  fs.renameSync(tmp, dataFile);
}

function newId() {
  return crypto.randomBytes(6).toString("hex");
}

// 前端写过来的是 { text: x } / { select: x } / { date: x } / { number: x } 包裹值，取第一个键
function unwrap(v) {
  return v && typeof v === "object" && !Array.isArray(v) ? Object.values(v)[0] : v;
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function json(res, obj, code = 200) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (c) => {
      body += c;
      if (body.length > 1e6) { reject(new Error("body too large")); req.destroy(); }
    });
    req.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch (e) { reject(new Error("bad json")); }
    });
    req.on("error", reject);
  });
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === "/" || rel === "") rel = "/index.html";
  const abs = path.normalize(path.join(publicDir, rel));
  if (!abs.startsWith(publicDir)) { res.writeHead(403); return res.end("forbidden"); }
  let st;
  try {
    st = fs.statSync(abs);
    if (!st.isFile()) throw new Error("not a file");
  } catch (e) { res.writeHead(404); return res.end("not found"); }
  // 页面是单个 200KB 大文件：带上 ETag 走协商缓存，刷新时命中 304 就不用重新传一遍
  const etag = 'W/"' + st.size.toString(16) + "-" + Math.floor(st.mtimeMs).toString(16) + '"';
  const headers = {
    "Content-Type": MIME[path.extname(abs)] || "application/octet-stream",
    "Cache-Control": "no-cache",
    "ETag": etag,
    "Last-Modified": st.mtime.toUTCString(),
  };
  if (req.headers["if-none-match"] === etag) { res.writeHead(304, headers); return res.end(); }
  let data;
  try { data = fs.readFileSync(abs); } catch (e) { res.writeHead(404); return res.end("not found"); }
  res.writeHead(200, headers);
  res.end(data);
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, "http://localhost");
    const p = u.pathname;
    if (process.env.AWB_LOG !== "0") console.log(`[${new Date().toISOString().slice(11,19)}] ${req.method} ${p}${u.search}`);
    const dbKey = u.searchParams.get("db") || "";

    if (p === "/health") return json(res, { ok: true, tool: "agent-workbench", version: APP_VERSION,
      storage: { ok: storageOk, dir: storageDir, error: storageErr || undefined },
      db: { error: lastDbError || undefined } });

    // 备份：列出 / 恢复（误删可回滚）
    if (p === "/api/backup" && req.method === "GET") {
      const dir = path.join(storageDir, ".bak");
      let files = [];
      try { files = fs.readdirSync(dir).filter((f) => f.startsWith("db-") && f.endsWith(".json")).sort().reverse(); } catch (e) {}
      return json(res, { backups: files, storageDir });
    }
    if (p === "/api/backup" && req.method === "POST") {
      const file = u.searchParams.get("file") || "";
      const dir = path.join(storageDir, ".bak");
      let files = [];
      try { files = fs.readdirSync(dir).filter((f) => f.startsWith("db-") && f.endsWith(".json")).sort().reverse(); } catch (e) {}
      const pick = file && files.includes(file) ? file : files[0];
      if (!pick) return json(res, { error: "没有可用备份" }, 404);
      const src = path.join(dir, pick);
      // 恢复前先把「当前库」备份一份：否则一键回滚会把现在的数据直接冲掉
      backupDb();
      let parsed;
      try { parsed = JSON.parse(fs.readFileSync(src, "utf8")); }
      catch (e) { return json(res, { error: "备份文件不是合法 JSON：" + pick }, 400); }
      const broken = Object.keys(SCHEMAS).filter((k) => !Array.isArray(parsed[k]));
      if (broken.length) return json(res, { error: "备份文件缺表：" + broken.join("/") }, 400);
      fs.copyFileSync(src, dataFile);
      return json(res, { ok: true, restored: pick });
    }

    // AI 写入契约：agent 可直接拉取（markdown / json 两种）
    if (p === "/api/contract") {
      try {
        const md = fs.readFileSync(path.join(__dirname, "contract.md"), "utf8");
        res.writeHead(200, { "Content-Type": "text/markdown; charset=utf-8" });
        return res.end(md);
      } catch (e) {
        return json(res, { error: "contract.md 未找到" }, 404);
      }
    }
    if (p === "/api/contract.json") {
      const fields = {
        tasks: [
          { name: "任务标题", type: "text", required: true, desc: "动宾短句，一眼看懂要做什么" },
          { name: "状态", type: "select", required: true, options: ["进行中", "已完成"], desc: "进行中 / 已完成" },
          { name: "优先级", type: "select", required: true, options: ["P0", "P1", "P2"], desc: "P0 最急 → P2 不急" },
          { name: "所在电脑", type: "text", required: true, desc: "必须与机器表「机器名」完全一致，否则落入未识别电脑列" },
          { name: "目录", type: "text", required: false, desc: "绝对路径" },
          { name: "进度", type: "text", required: false, desc: "一句话写当前进展；留空则卡片不显示进度行" },
          { name: "待办", type: "text", required: false, desc: "一行一条，[x] 已完成 / [ ] 未完成" },
          { name: "交接内容", type: "text", required: false, desc: "给下一个接手的 agent" },
          { name: "更新时间", type: "date", required: false, desc: "ISO 8601；省略时服务端自动补当前时间" },
          { name: "排序", type: "number", required: false, desc: "同列内顺序，小的在前" },
        ],
        machines: [
          { name: "机器名", type: "text", required: true, desc: "唯一标识" },
          { name: "位置", type: "text", required: false, desc: "家 / 随身" },
          { name: "WorkBuddy账号", type: "text", required: false, desc: "派生只读 = 该机当前 WorkBuddy 账号；写入等于「设为当前」" },
          { name: "TRAE账号", type: "text", required: false, desc: "派生只读 = 该机当前 TRAE 账号；写入等于「设为当前」" },
          { name: "最后确认", type: "date", required: false },
          { name: "排序", type: "number", required: false },
        ],
        accounts: [
          { name: "账号名", type: "text", required: true, desc: "如 坤坤 / 小黄" },
          { name: "平台", type: "select", required: true, options: ["WorkBuddy", "TRAE"], desc: "一个账号只属于一个平台" },
          { name: "所属电脑", type: "text", required: true, desc: "必须与机器表「机器名」一致" },
          { name: "当前", type: "checkbox", required: false, desc: "同一台电脑同一平台至多一条为 true" },
          { name: "备注", type: "text", required: false, desc: "公司号 / 个人号 之类" },
          { name: "最后确认", type: "date", required: false, desc: "最近一次确认或切换的时间" },
          { name: "排序", type: "number", required: false, desc: "面板内顺序，小的在前" },
        ],
        github: [
          { name: "同步时间", type: "date", required: false, desc: "省略时服务端补当前时间" },
          { name: "电脑", type: "text", required: true },
          { name: "GitHub账号", type: "text", required: false },
          { name: "仓库", type: "text", required: true, desc: "owner/repo" },
          { name: "内容", type: "text", required: false },
          { name: "同步版本", type: "text", required: false },
          { name: "是否同步", type: "select", required: false, options: ["已同步", "未同步"], desc: "缺省「已同步」；未同步 = 本地有版本还没推" },
          { name: "仓库归档", type: "checkbox", required: false, desc: "仓库级归档标记" },
          { name: "仓库置顶", type: "checkbox", required: false, desc: "仓库级置顶：任一条记录勾上即置顶；置顶卡按更新时间排序排在最前" },
        ],
      };
      const live = loadDb();
      return json(res, {
        databases: {
          tasks: { databaseId: "tasks", title: "任务台账", fields: fields.tasks },
          machines: { databaseId: "machines", title: "机器登录态", fields: fields.machines },
          accounts: { databaseId: "accounts", title: "登录账号", fields: fields.accounts },
          github: { databaseId: "github", title: "GitHub 同步记录", fields: fields.github },
        },
        // 实时机器清单：写「所在电脑」时只能用这里的名字
        machines: (live.machines || []).map((m) => {
          const d = deriveMachine(live, m);
          return {
            机器名: d["机器名"] || "",
            位置: d["位置"] || "",
            WorkBuddy账号: d["WorkBuddy账号"] || "",
            TRAE账号: d["TRAE账号"] || "",
            账号数: (live.accounts || []).filter((a) => a["所属电脑"] === m["机器名"]).length,
          };
        }),
        rules: [
          "写任务前先读机器表，「所在电脑」必须是已登记的机器名",
          "枚举值严格照抄：状态=进行中/已完成，优先级=P0/P1/P2，是否同步=已同步/未同步",
          "待办只认行首的 [ ] 与 [x]",
          "每次写入都带「更新时间」",
          "机器表上的 WorkBuddy账号 / TRAE账号 是派生值（当前账号）；要登记多个账号，往 accounts 表加行，并用「当前」标记唯一在用的那条",
        ],
        schema: SCHEMAS,
      });
    }

    if (p === "/api/schema") {
      const s = SCHEMAS[dbKey];
      return json(res, { label: s ? s.label : "", properties: s ? s.properties : [] });
    }

    if (p === "/api/query") {
      if (!SCHEMAS[dbKey]) return json(res, { error: "unknown db" }, 400);
      // 全量返回（个人工具量级够用）；分页字段保留 SDK 形状
      const d = loadDb();
      let rows = d[dbKey] || [];
      // 机器表的账号字段按 accounts 表实时派生，库里不存第二份真相
      if (dbKey === "machines") rows = rows.map((m) => deriveMachine(d, m));
      return json(res, { results: rows, hasMore: false, nextCursor: null });
    }

    if (p === "/api/records" && req.method === "POST") {
      const body = await readJson(req);
      if (!SCHEMAS[body.db]) return json(res, { error: "unknown db" }, 400);
      const d = loadDb();
      const props = body.properties || {};
      // 老契约：agent 直接往机器表写账号字段 → 翻译成账号表的一次「设为当前」
      if (body.db === "machines") {
        applyMachineAccountWrite(d, String(unwrap(props["机器名"]) || "").trim(), props);
      }
      const rec = { _id: newId() };
      for (const [k, v] of Object.entries(props)) rec[k] = unwrap(v);
      // 身份字段统一去空白：否则「台式机-家 」与「台式机-家」会被当成两台机 / 两列
      if (body.db === "machines" && typeof rec["机器名"] === "string") rec["机器名"] = rec["机器名"].trim();
      if (body.db === "tasks" && typeof rec["所在电脑"] === "string") rec["所在电脑"] = rec["所在电脑"].trim();
      applyDefaults(body.db, rec, true);
      const err = checkRecord(d, body.db, rec, { isNew: true });
      if (err) return json(res, { error: err }, 400);
      if (body.db === "accounts") {
        const aerr = normalizeAccount(d, rec, { isNew: true });
        if (aerr) return json(res, { error: aerr }, 400);
      }
      d[body.db].push(rec);
      if (body.db === "accounts" && rec[ACC.cur] === true) {
        markCurrent(d, rec[ACC.mach], rec[ACC.plat], rec._id);
      }
      saveDb(d);
      return json(res, { id: rec._id });
    }

    const mRec = p.match(/^\/api\/records\/([^/]+)$/);
    if (mRec && (req.method === "PATCH" || req.method === "DELETE")) {
      const id = decodeURIComponent(mRec[1]);
      let key = dbKey, patch = null;
      if (req.method === "PATCH") {
        patch = await readJson(req);
        key = String(patch.db || "");
      }
      if (!SCHEMAS[key]) return json(res, { error: "unknown db" }, 400);
      const d = loadDb();
      const bucket = d[key] || [];
      const i = bucket.findIndex((r) => r._id === id);
      if (i < 0) return json(res, { error: "record not found" }, 404);

      if (req.method === "PATCH") {
        const props = patch.properties || {};
        if (key === "machines") {
          const oldName = String(bucket[i]["机器名"] || "").trim();
          const newName = ("机器名" in props) ? String(unwrap(props["机器名"]) || "").trim() : oldName;
          // 电脑改名：账号池跟着搬，否则账号会认错电脑变成孤儿
          if (newName && newName !== oldName) {
            for (const a of d.accounts || []) if (a[ACC.mach] === oldName) a[ACC.mach] = newName;
          }
          applyMachineAccountWrite(d, newName || oldName, props);
        }
        if (key === "accounts") {
          const prevMach = bucket[i][ACC.mach], prevPlat = bucket[i][ACC.plat];
          for (const [k, v] of Object.entries(props)) bucket[i][k] = unwrap(v);
          const err = normalizeAccount(d, bucket[i], { selfId: id });
          if (err) return json(res, { error: err }, 400);
          if (bucket[i][ACC.cur] === true) markCurrent(d, bucket[i][ACC.mach], bucket[i][ACC.plat], id);
          if (prevMach !== bucket[i][ACC.mach] || prevPlat !== bucket[i][ACC.plat]) {
            ensureCurrent(d, prevMach, prevPlat);
          }
        } else {
          for (const [k, v] of Object.entries(props)) bucket[i][k] = unwrap(v);
        }
        const verr = checkRecord(d, key, bucket[i], { selfId: id, fields: Object.keys(props) });
        if (verr) return json(res, { error: verr }, 400);
        saveDb(d);
        return json(res, {});
      }

      if (key === "accounts") {
        const gone = bucket[i];
        d[key] = bucket.filter((r) => r._id !== id);
        // 删掉的是当前账号：同池顺延第一条，整机不该因此变成未登录
        ensureCurrent(d, gone[ACC.mach], gone[ACC.plat]);
      } else if (key === "machines") {
        const gone = bucket[i];
        // 删电脑连带删掉它的账号，避免账号表留孤儿
        d.accounts = (d.accounts || []).filter((a) => a[ACC.mach] !== gone["机器名"]);
        d[key] = bucket.filter((r) => r._id !== id);
      } else {
        d[key] = bucket.filter((r) => r._id !== id);
      }
      saveDb(d);
      return json(res, {});
    }

    if (p.startsWith("/api/")) return json(res, { error: "not found" }, 404);
    return serveStatic(req, res, p);
  } catch (e) {
    return json(res, { error: e.message }, 500);
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`agent-workbench running on http://127.0.0.1:${port}`);
  console.log(`storage: ${dataFile}`);
  if (!storageOk) console.error(`⚠ 存储目录不可写（${storageErr}）：添加/保存会失败。请检查目录权限或换 CAP_STORAGE_DIR。`);
});
