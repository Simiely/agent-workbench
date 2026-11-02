# Agent 工作台 · agent-workbench

任务台账 / 机器登录态 / 登录账号 / GitHub 同步记录四表工作台。给 AI Agent 的日常开发做**台账 + 看板 + 交接**：左屏任务看板、右屏 GitHub 看板，中缝可拖，点小标题一键放大。

零依赖：Node 原生 HTTP 服务（无任何 npm 包）+ 单文件前端（`public/index.html` 含全部样式与逻辑）+ JSON 文件存储。符合 tools-center 平台接入约定（`manifest.json` + `server.mjs`）。

## 功能

- **任务看板**：按电脑分列、KPI 点击过滤（默认「进行中」）、卡面瘦身（标题/元数据/进度一句话/待办进度条）、**详情就地编辑**（点文字改标题/进度/交接/目录，点胶囊改状态/优先级，点待办直接勾选）、跨列拖拽改所属电脑、行内编辑、管理模式批量操作
- **登录账号**：一台电脑 × 一个平台可以登记多个账号，列头胶囊显示当前账号与账号数；点开面板可切换当前、新增、改名、删除，也能「清除登录态」（账号留着、当前置空）
- **GitHub 看板**：仓库聚合卡（未同步 = 本地有版本还没推、仓库级归档标签）、KPI 未同步筛选、仓库详情弹窗
- **开发强度**：多排方块格子热力（本周 1 排 / 本月 2 排 / 近3个月 3 排），格内写日期与更新数，字号随格子自适应；点开全年日历热力弹窗（按年切换、数字开关）
- **通用**：暖黑 / 暖白双主题（默认暖黑）、手机单页 + 底部 T-bar（栏顶不置顶，随页面上移）、弹窗栈导航（Esc 逐层退）、中缝拖拽记忆、双区独立折叠记忆
- **顶栏搜索**：一个框同时搜两个看板。任务侧匹配标题 / 进度 / 目录 / 交接 / 待办；GitHub 侧匹配仓库名 / 内容 / 版本 / 账号 / 电脑 / 同步状态——仓库名命中留整个仓库，记录命中只留那几条；KPI 是全量口径，不随搜索变动

## 本地跑

```bash
node server.mjs          # http://127.0.0.1:8151
node server.mjs 9000     # 指定端口
node server.mjs 8151 --reseed   # 重置为内置演示数据（先自动备份）
```

首次启动是**空壳**（四张表全空），数据落在仓库外的 `../agent-workbench-data/db.json`，每次写盘前自动备份到同目录 `.bak/`（保留最近 10 份）。

## 测试

```bash
python tests/run_all.py          # 全部：5 套件回归（298 项断言）+ e2e（10 项）+ 11 个体检脚本
python tests/run_all.py mk_v16   # 只跑单个套件
python tests/run_all.py --bless  # 重建断言基线快照
node tests/e2e_local.cjs 8159    # 只跑本地版 e2e
```

- **套件回归**：生成含断言的 HTML → headless Chromium 执行 → 读 `document.title` → 与 `tests/_baseline/*.json` 比对
- **体检脚本**：真实 server + 真实浏览器（CDP 零依赖客户端），覆盖写路径、弹窗形态/导航栈、边界情况、端到端旅程等
- **数据隔离**：测试一律走 `tests/fixture_db.cjs` 夹具（相对日期种子）+ `tests/_out/storage-<端口>` 临时目录，**永不读写真实数据**
- 需要 Chrome：优先环境变量 `CHROME_HEADLESS`，否则自动找 Playwright 缓存里的 `chromium_headless_shell`

## 接入 tools-center 平台

把整个目录放进平台的 `tools/` 下（或网页「+ 添加」/ zip 上传），`manifest.json` 已按 V2 格式声明：

- `runtime: node`，`entry: server.mjs`，`port: 8151`，`health: /health`
- `capabilities: ["storage"]` —— 数据目录由平台注入 `CAP_STORAGE_DIR`（随平台备份），本地直跑时落仓库外 `../agent-workbench-data/`
- API 请求前缀跟随页面路径：平台反代 `/tool/agent-workbench/` 下自动带前缀（不加前缀会打到平台根 404）；`/health` 会返回存储目录可写性与最近一次读库异常，便于平台侧排查
- 写入校验在服务端：必填字段为空、枚举值不在取值表内返回 `400` + 中文原因；`/api/backup` 提供备份列表与恢复（恢复前先备份当前库）

## 数据层

页面通过 `localDb()` 适配器访问本地 REST，五个方法：

| 页面调用 | 本地 REST |
|---|---|
| `getSchema({databaseId})` | `GET /api/schema?db=` |
| `query({databaseId})` | `GET /api/query?db=` |
| `addRecord({databaseId, properties})` | `POST /api/records`，body `{ db, properties }` |
| `updateRecord({databaseId, recordId, properties})` | `PATCH /api/records/:id`，body `{ db, properties }` |
| `deleteRecord({databaseId, recordId})` | `DELETE /api/records/:id?db=` |

> ⚠️ **两个名字别混**：左边 `databaseId` 是**页面适配器 `localDb()` 的入参名**（沿用平台 SDK 形状），
> 它在适配器内部转成 `db` 才发到网络上。直接打 REST 时（AI 写入、脚本调用）一律用 **`db`**——
> 四张表的 `?db=` 查询串、写库请求体的 `db` 字段都是它。传 `databaseId` 会被拒收（`400 unknown db`）。

- 四张表用语义化 key：`tasks` / `machines` / `accounts` / `github`
- **写入只走一层 `Repo`**：页面用 `Repo.<表>.update / create / remove`（如 `Repo.tasks.update(id, props)`），
  上面的 `addRecord / updateRecord / deleteRecord` 只出现在 `Repo` 内部（共 3 处），不在业务函数里散落
- `accounts` 是账号真相：一台电脑 × 一个平台可以多条，同池至多一条 `当前`
- 机器表的 `WorkBuddy账号` / `TRAE账号` 是**派生只读**（= 当前账号），存储里不留第二份
- 字段用 `{text}/{select}/{date}/{number}` 包裹值格式，schema 由服务端下发
- 页面里没有任何平台 SDK / 平台标记残留

## 目录

```
agent-workbench/
  manifest.json         # tools-center 接入声明
  server.mjs            # 零依赖 HTTP 服务：静态托管 + REST + JSON 存储
  package.json          # start / test / reseed 等脚本入口
  contract.md           # AI 写入契约（markdown 版）
  public/index.html     # ★ 页面（唯一真源，含全部样式与逻辑，直接改这里）
  docs/
    ARCHITECTURE.md     # 架构说明：分层、数据流、扩展指南、已知问题
    DOM-ATTRIBUTES.md   # DOM 属性登记表（新增 data-* 前必查）
  tests/
    run_all.py          # 统一入口
    mk_*.py             # 各功能套件
    audit_*.cjs         # 真实浏览器体检脚本（run_all 里跑 11 个）
    fixture_db.cjs      # 测试数据夹具（相对日期种子，与真实数据隔离）
    e2e_local.cjs       # 端到端（真实 server + 真实 fetch）
    cdp.cjs             # 零依赖 CDP 客户端
    _baseline/          # 断言基线快照
```

## 文档索引

| 想了解 |去看 |
|---|---|
| 架构 / 数据流 / 扩展指南 | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| DOM 属性契约 | [docs/DOM-ATTRIBUTES.md](docs/DOM-ATTRIBUTES.md) |
| AI 协作规则 | [AGENTS.md](AGENTS.md) |
| 重构计划 / 注意事项 / 排障 | [docs/REFACTOR-PLAN.md](docs/REFACTOR-PLAN.md) |
| 开发者视角（关键问题与方案） | [DEVELOPMENT.md](DEVELOPMENT.md) |
| 版本历史 | [CHANGELOG.md](CHANGELOG.md) |
| AI 写入契约 | [contract.md](contract.md) |

## 改代码的正确姿势

改 `public/index.html`（单文件，无生成步骤）→ `python tests/run_all.py` 全绿 → 更新 CHANGELOG / DEVELOPMENT → 发版。
