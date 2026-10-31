// pack-platform.mjs - 平台版打包脚本（tools-center 部署包）
// 标准对齐 Simiely/workbuddy-credits-tool 的 pack-platform.mjs：
//   zip 根目录直接放 manifest.json + 运行时文件（无包裹层，平台 zip 上传自动识别 manifest）
//   命名 <id>-平台版-v<版本>.zip，版本号取 package.json
// 用法：node pack-platform.mjs [输出目录]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = process.argv[2] || "C:/Temp/agent-workbench-releases";
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const VER = pkg.version;
const ZIP_NAME = `agent-workbench-平台版-v${VER}.zip`;
const OUT = path.join(OUT_DIR, ZIP_NAME);
const STAGE = path.join(ROOT, ".tmp-platform-pack");

fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });

// 运行时文件（平台托管只需这些；tests/docs/design 不进包）
const rootFiles = [
  "server.mjs", "manifest.json", "package.json",
  "contract.md", "README.md", "CHANGELOG.md",
];
for (const f of rootFiles) {
  const s = path.join(ROOT, f);
  if (!fs.existsSync(s)) throw new Error("缺少文件: " + f);
  fs.copyFileSync(s, path.join(STAGE, f));
}
fs.cpSync(path.join(ROOT, "public"), path.join(STAGE, "public"), { recursive: true });

// 平台部署说明（自动生成，带当前版本号）
const readme = `# 平台版部署说明（tools-center 托管）

> Agent 工作台 · 平台版 v${VER}
> **平台版 = tools-center 统一宿主托管**：网页「+ 添加」→ zip 上传本包，平台自动识别 \`manifest.json\` 并托管进程。

## 接入要点
- 平台自动拉起 \`node server.mjs 8151\`（健康检查 \`/health\`，manifest 已声明）
- 三张表：任务台账 / 机器登录态 / GitHub 同步记录；打开 \`/tool/agent-workbench/\` 即用

## 数据目录
- 平台注入 \`CAP_STORAGE_DIR\` → 数据随平台存储目录托管（含自动备份，保留 10 份）
- 首次启动为**空壳**（三张表全空），直接在页面上录入即可
- 想看演示效果：把工具目录下启动命令临时加 \`--reseed\`，或本地跑 \`node server.mjs --reseed\`

## 本地直跑（脱离平台）
\`\`\`bash
node server.mjs            # http://127.0.0.1:8151
node server.mjs 9000       # 指定端口
\`\`\`
数据落在包外一层的 \`agent-workbench-data/db.json\`（与代码分离）。

## 升级
替换平台 \`tools/agent-workbench/\` 下代码 → 平台卡片「↻ 重启」。数据在存储目录，替换代码不影响。

## 文档
仓库内 \`README.md\`（功能与测试）/ \`CHANGELOG.md\`（版本历史）/ \`contract.md\`（AI 写入契约）。
`;
fs.writeFileSync(path.join(STAGE, "平台部署说明.md"), readme, "utf8");

if (fs.existsSync(OUT)) fs.rmSync(OUT);
fs.mkdirSync(OUT_DIR, { recursive: true });
// 与参考实现一致：python zipfile 打包（零依赖），zip 根 = STAGE
const py = [
  "import zipfile,os,sys",
  "root=os.path.abspath(sys.argv[1])",
  "out=sys.argv[2]",
  "z=zipfile.ZipFile(out,'w',zipfile.ZIP_DEFLATED)",
  "for r,_,fs in os.walk(root):",
  "    for f in fs:",
  "        p=os.path.join(r,f)",
  "        rel=os.path.relpath(p,root).replace(os.sep,'/')",
  "        z.write(p,rel)",
  "z.close()",
];
execFileSync("python", ["-c", py.join("\n"), STAGE, OUT], { stdio: "inherit", cwd: STAGE });
fs.rmSync(STAGE, { recursive: true, force: true });
console.log(`platform zip: ${OUT}`);
