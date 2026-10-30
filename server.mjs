// Agent 工作台 · tools-center 本地版
// 零依赖：静态托管 public/ + 三张表的 JSON 文件存储（tasks / machines / github）
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
// --reseed：把三张表重置为内置演示数据（先备份旧文件）。
// 只想看效果时用：node server.mjs 8151 --reseed；日常使用不需要，首启即是空壳。
const RESEED = process.argv.includes("--reseed");

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
    ],
  },
};

function seed() {
  const daysAgo = (n, h = 10) => {
    const d = new Date(Date.now() - n * 86400000);
    d.setHours(h, 20, 0, 0);
    return d.toISOString();
  };
  return {
    machines: [
      { _id: "m1", "机器名": "台式机-家", "位置": "家", "WorkBuddy账号": "WB-主号", "TRAE账号": "TRAE-主号", "最后确认": daysAgo(0), "排序": 1 },
      { _id: "m2", "机器名": "笔记本", "位置": "随身", "WorkBuddy账号": "WB-副号", "TRAE账号": "TRAE-副号", "最后确认": daysAgo(1), "排序": 2 },
      { _id: "m3", "机器名": "N100-小主机", "位置": "客厅", "WorkBuddy账号": "WB-主号", "TRAE账号": "", "最后确认": daysAgo(6), "排序": 3 },
    ],
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

function loadDb() {
  if (RESEED) {
    const d = seed();
    saveDb(d);
    console.log("reseeded: " + Object.keys(d).map(k => k + "=" + d[k].length).join(", "));
    return d;
  }
  try {
    const d = JSON.parse(fs.readFileSync(dataFile, "utf8"));
    for (const k of Object.keys(SCHEMAS)) if (!Array.isArray(d[k])) d[k] = [];
    return d;
  } catch {
    // 首次启动 = 空壳：三张表全空，不预置任何演示数据（想看效果用 --reseed）
    const d = {};
    for (const k of Object.keys(SCHEMAS)) d[k] = [];
    saveDb(d);
    return d;
  }
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

function serveStatic(res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === "/" || rel === "") rel = "/index.html";
  const abs = path.normalize(path.join(publicDir, rel));
  if (!abs.startsWith(publicDir)) { res.writeHead(403); return res.end("forbidden"); }
  let data;
  try { data = fs.readFileSync(abs); } catch { res.writeHead(404); return res.end("not found"); }
  res.writeHead(200, { "Content-Type": MIME[path.extname(abs)] || "application/octet-stream" });
  res.end(data);
}

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, "http://localhost");
    const p = u.pathname;
    if (process.env.AWB_LOG !== "0") console.log(`[${new Date().toISOString().slice(11,19)}] ${req.method} ${p}${u.search}`);
    const dbKey = u.searchParams.get("db") || "";

    if (p === "/health") return json(res, { ok: true, tool: "agent-workbench" });

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
      fs.copyFileSync(path.join(dir, pick), dataFile);
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
          { name: "进度", type: "text", required: true, desc: "一句话写当前进展" },
          { name: "待办", type: "text", required: false, desc: "一行一条，[x] 已完成 / [ ] 未完成" },
          { name: "交接内容", type: "text", required: false, desc: "给下一个接手的 agent" },
          { name: "更新时间", type: "date", required: true, desc: "ISO 8601" },
          { name: "排序", type: "number", required: false, desc: "同列内顺序，小的在前" },
        ],
        machines: [
          { name: "机器名", type: "text", required: true, desc: "唯一标识" },
          { name: "位置", type: "text", required: false, desc: "家 / 随身" },
          { name: "WorkBuddy账号", type: "text", required: false },
          { name: "TRAE账号", type: "text", required: false },
          { name: "最后确认", type: "date", required: false },
          { name: "排序", type: "number", required: false },
        ],
        github: [
          { name: "同步时间", type: "date", required: true },
          { name: "电脑", type: "text", required: true },
          { name: "GitHub账号", type: "text", required: false },
          { name: "仓库", type: "text", required: true, desc: "owner/repo" },
          { name: "内容", type: "text", required: true },
          { name: "同步版本", type: "text", required: false },
          { name: "是否同步", type: "select", required: true, options: ["已同步", "未同步"], desc: "未同步 = 本地有版本还没推" },
          { name: "仓库归档", type: "checkbox", required: false, desc: "仓库级归档标记" },
        ],
      };
      const live = loadDb();
      return json(res, {
        databases: {
          tasks: { databaseId: "tasks", title: "任务台账", fields: fields.tasks },
          machines: { databaseId: "machines", title: "机器登录态", fields: fields.machines },
          github: { databaseId: "github", title: "GitHub 同步记录", fields: fields.github },
        },
        // 实时机器清单：写「所在电脑」时只能用这里的名字
        machines: (live.machines || []).map((m) => ({
          机器名: m["机器名"] || "",
          位置: m["位置"] || "",
          WorkBuddy账号: m["WorkBuddy账号"] || "",
          TRAE账号: m["TRAE账号"] || "",
        })),
        rules: [
          "写任务前先读机器表，「所在电脑」必须是已登记的机器名",
          "枚举值严格照抄：状态=进行中/已完成，优先级=P0/P1/P2，是否同步=已同步/未同步",
          "待办只认行首的 [ ] 与 [x]",
          "每次写入都带「更新时间」",
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
      return json(res, { results: loadDb()[dbKey] || [], hasMore: false, nextCursor: null });
    }

    if (p === "/api/records" && req.method === "POST") {
      const body = await readJson(req);
      if (!SCHEMAS[body.db]) return json(res, { error: "unknown db" }, 400);
      const d = loadDb();
      const rec = { _id: newId() };
      for (const [k, v] of Object.entries(body.properties || {})) rec[k] = unwrap(v);
      d[body.db].push(rec);
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
        for (const [k, v] of Object.entries(patch.properties || {})) bucket[i][k] = unwrap(v);
      } else {
        d[key] = bucket.filter((r) => r._id !== id);
      }
      saveDb(d);
      return json(res, {});
    }

    if (p.startsWith("/api/")) return json(res, { error: "not found" }, 404);
    return serveStatic(res, p);
  } catch (e) {
    return json(res, { error: e.message }, 500);
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`agent-workbench running on http://127.0.0.1:${port}`);
  console.log(`storage: ${dataFile}`);
});
