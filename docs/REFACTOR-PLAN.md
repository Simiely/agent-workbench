# 重构执行手册 · 注意事项与问题解决

> 配套计划见本文第 1 节；执行每一步前先读「全局注意事项」，卡住时查第 4 节「症状 → 处理」。
> 目标：**每一步都能一次跑通**，出问题时 10 分钟内定位，且能干净回滚。

## 一、分步计划（闸门式推进）

| 步骤 | 目标 | 主要改动 | 完成判据 |
|---|---|---|---|
| 1 ✅ | GitHub 仓库卡置顶 + 排序 | `仓库置顶` 字段、`toggleRepoPin`、排序比较器 | 已上线 v1.4.5 |
| 2 ✅ | 写库收口（`Repo` 层） | 实测 30 处 `db.*` → 3 处（`Repo` 内） | 已上线 v1.4.6：Repo 外为 0，全量测试绿 |
| 3 ✅ | 状态收口（`S` 分域） | `S.data / S.ui / S.sel` + setter | 已上线 v1.4.7：`S.x =` 直改 0 处（体检加静态断言防回流） |
| 4 ✅ | 事件路由表 | 37 个点击分支 → 35 条 `CLICK_ROUTES` | 已上线 v1.4.8：4 个交互体检 + 变异测试全绿 |
| 5 ✅ | `bindDrag` 拆分 + 断言稳定 | 拆 `bindColumnDrag` / `bindCardDrag` / 持久化；V7c 改「卡片与详情口径一致」 | 已上线 v1.4.9：全量连跑 3 次全绿 |
| 6 ✅ | 场景走查 + 逐条修复（外部技能 `workbuddy-skills`） | 26 项能力 / 17 条链路 / 8 个问题 | 已上线 v1.5.0：F-01…F-08 全修，`audit_account_edit` 扩到 50 项 |

**每步固定流程（不许跳）**：
1. 备份：把要改的文件复制到 `_backup/<步骤号>/`（本机没有 git，**备份即回滚手段**）
2. 改前先量：`grep` 出所有调用点，列清单，避免"改一处漏两处"
3. 分批改：一次只碰一个子系统（任务 → 机器 → 账号 → GitHub），每批跑一次全量
4. 全量验证：5 套件 + e2e + 11 体检 + `audit_responsive`（见 2.1 命令）
5. 记账：CHANGELOG 追加、ARCHITECTURE 的「规模基线」表更新、版本号 +0.0.1
6. 清场：删临时脚本/截图；服务重启（版本号来自启动时读的 package.json）

## 二、全局注意事项（每次动手前扫一遍）

### 2.1 环境与命令（不按这个跑就是假绿）

```powershell
# 一次性环境（每条命令都要带，否则 node/浏览器都找不到）
$env:PATH = "C:\Users\Simiely\.cache\awb-node;" + $env:PATH
$env:CHROME_HEADLESS = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

# 全量（唯一可信入口）
python tests/run_all.py

# run_all 里没有的响应式体检：必须自己带端口，且该端口要有数据
node tests/audit_responsive.cjs 8151
```

- **`run_all.py` 只跑 5 套件 + e2e + 11 个体检**；`audit_responsive` 与 `audit_account_migrate` 需要手动跑，漏跑就等于没验
- 生成页默认视口 **748×484**（`--dump-dom`），所以手机断点是 **700**；**不要改成 760/800**，否则 `mk_v16` 的列数断言会被判成手机形态
- 后台起服务用独立端口（8151 给人看 / 8300 给脚本），避免和测试端口（8171–8182）冲突
- 启动服务的进程会缓存 `package.json` 版本号：**改版本号后必须重启**，否则顶栏还是旧版本

### 2.2 数据边界（越界一次就可能丢真实数据）

- 只读快照：`D:\Documents\Trae-CN\temp_20261101_02\_live-snapshot\db.json`（线上只读副本）
- 本地验收一律 `CAP_STORAGE_DIR=<快照副本目录>/run`；**绝不指向真实数据目录 `../agent-workbench-data`**
- 测试文件里只能出现 `tests/_out/storage-<端口>`；任何新增测试沿用 `tests/fixture_db.cjs`
- 动过数据后恢复：`Copy-Item _live-snapshot\db.json _live-snapshot\run\db.json -Force`（服务边跑边读，不用重启）

### 2.3 单文件前端的硬约束

- ES5 风格（`var`、字符串拼 DOM、事件委托），**不能引 import/构建**；新增代码不要用箭头函数/模板字符串
- 字段名只走 `F.t / F.m / F.a / F.g`；颜色只走 `:root` 变量；不要写死色值
- 弹层只有 `#drawer` + `#mask` 一套；`xl/wide` 修饰类只在 `renderSheetLayer` 入口 toggle、`closeDrawer` 移除
- **事件分支是"先匹配先执行"**：新增分支要查 `docs/DOM-ATTRIBUTES.md`，并把"更具体的"排在"更宽泛的"之前
  - 已知必守顺序：`[data-dt-*]` → `[data-edit]`；`[data-pin-repo]` / `[data-copy-repo]` / `[data-mb]` → **最后**才是 `[data-repo-open]`（整卡判定）
- 改 `class`/`id` 前全局搜旧的 `addEventListener`/`closest`，容器搬家必须迁绑定

### 2.4 服务端与契约（一改四处同步）

改字段/校验时，下面 5 处必须同时更新，少一处就是"AI 写进来的数据和页面看到的不一样"：

1. `server.mjs` 的 `SCHEMAS`
2. `server.mjs` 的 `REQUIRED / ENUMS`（如果参与校验）
3. `server.mjs` 的 `/api/contract.json`
4. `contract.md`
5. 页面里的 `AI_CONTRACT`（AI 指南弹窗内容）

- 新字段默认**不要**加进 `REQUIRED`：老数据没有它会直接被拒写
- 仓库级/机器级派生字段沿用「任一条为 true 即视为 true」的聚合口径，写侧要**整组一起写**，否则会出现半状态
- 校验的 PATCH 只校验"本次传入字段"（`fields`），不要改成全量校验（历史脏记录会被永久拒写）

### 2.5 测试基线的纪律

- 基线快照是**契约**：值变了 = 行为变了。`--bless` 前必须逐条看 diff，确认是预期变化
- **bless 会覆盖旧基线**：先备份 `tests/_baseline/<套件>.json` 再 bless
- 日期相关断言只放布尔不变量（月末/周一/当月天数），不要放具体日期
- 断言里不要依赖"第一张卡/最后一行"的排序（除非排序本身就是被测对象）；用集合比较
- 新增交互优先写进体检脚本（真实 server + 真实浏览器），不要只加 mock 断言

## 三、每一步的专有坑

### 第 2 步 · Repo 层
- **保持返回形状**：调用点普遍写成 `db.updateRecord(...).then(...).catch(...)`，Repo 方法也必须返回 Promise，且 `catch` 语义不变（否则错误提示会被吞）
- **增量字段**：Repo 只负责"带更新时间 / 统一提示 / 失败重拉"，不改变各调用点提交的字段集合；批量操作仍是 `Promise.all`
- **就地编辑 vs 表单保存**：两条路径必须共用同一入口，避免再次出现"批量带 updated、单条不带"的老问题
- 替换顺序：`tasks`（最多，先验）→ `machines` → `accounts` → `github`；每批后跑全量
- 验收命令：`grep -c "db.(updateRecord|addRecord|deleteRecord)" public/index.html` = 3（且全部在 Repo 内；改造前实测 30 处）

### 第 3 步 · S 分域
- **只改状态入口，不改渲染逻辑**：先加 setter，再逐段替换赋值，最后才删旧字段
- `S.aiMachine` 的初始化带 `localStorage`，拆分时保持"读不到就空串"的容错
- 拆完给 `audit_no_guards.cjs` 加一条静态断言：源码里不允许出现 `S\.\w+ =`（防回流）
- 典型回归信号：KPI 高亮与实际内容不一致（视图状态漂移）→ 先查 setter 是否漏调 `renderSummary/renderBoard`

### 第 4 步 · 事件路由表
- 用 `docs/DOM-ATTRIBUTES.md` 的分支顺序表做迁移清单，表里没有的属性先登记再用
- 每条路由必须保留原来的 `e.stopPropagation()` 语义（有 stop 的标 `stop:true`）
- 保留"整卡判定放最后"这一条；顺序错了表现是"点卡片里的按钮没反应/弹了详情"
- 改完先跑 `audit_repo_card` / `audit_account_edit` / `audit_journey`，再跑 `mutation_test`（检查"换顺序必须报警"）

### 第 5 步 · bindDrag 拆分
- 投放目标判定：列拖按同行/跨行分别用 `clientX/clientY`；卡片拖不允许投放进 `.col-orphan`
- 顺序持久化只在 `dragend` 做；搜索态只允许跨列移动、不保存卡片顺序（保留现有提示）
- 拆完连跑 3 次全量，确认没有"偶发绿"；顺手把 `mk_v16` 的"版本区"断言改成对所有仓库卡取交集

## 四、症状 → 处理（排障手册）

| 症状 | 先查什么 | 处理 |
|---|---|---|
| 页面白屏 / 点了没反应 | 用 Edge `--dump-dom` 看 `<title>`；用 CDP `Runtime.evaluate` 看报错 | 语法错误优先看最近一次改动的大括号/引号；改前备份直接回滚 |
| 服务起不来 / 端口占用 | `Get-NetTCPConnection -LocalPort 8151` | 换端口起；或结束占用该端口的 node 进程 |
| 测试超时（等待条件） | 是不是忘了起带数据的服务（`audit_responsive`） | 指向 8151 并确认 `/api/query?db=tasks` 有数据 |
| 测试"偶尔红一条" | 是否依赖首卡/首行顺序、是否依赖当前时间 | 改成集合比较或布尔不变量；连续跑 3 次确认 |
| bless 后发现改错 | `tests/_baseline` 是否已备份 | 用备份覆盖回去，再重新确认 diff |
| 测试把数据写脏 | 快照恢复到 `run/db.json` | `Copy-Item _live-snapshot\db.json ...run\db.json -Force` |
| 保存报 400 | 响应体里的中文原因；`/health` 的 `db.error` | 对照 `REQUIRED/ENUMS`；别急着放宽校验，先看是不是调用点漏传字段 |
| 弹窗宽度残留（超宽） | `#drawer` 上是否还挂着 `xl` | 回 `renderSheetLayer` 入口的 toggle + `closeDrawer` 的移除 |
| 点卡内按钮却打开详情 | `closest()` 命中了容器属性 | 把该按钮分支排到 `[data-repo-open]`/`[data-open]` 之前 |
| 账号/仓库出现"半状态" | 聚合字段是否只写了一条记录 | 整组一起写（`Promise.all`），读侧仍用「或」聚合 |
| 顶栏/卡片挤在一起 | 宽度采样（见下） | 先给最小宽度与换行策略，再按档位隐藏次要元素；禁止让搜索框无限收缩 |
| 改了字段但页面看不到 | 五处契约是否同步（见 2.4） | 补 `SCHEMAS` / `contract.json` / `contract.md` / `AI_CONTRACT` |
| 版本号没变 | 服务是否重启 | 重启服务（版本在启动时读 `package.json`） |

**宽度回归自查**（每次动 CSS 后跑一遍）：在 390/480/640/700/720/760/820/900/960/1024/1100/1180/1200/1280/1366/1440 逐一检查
`document.body.scrollWidth > innerWidth`、顶栏子项是否重叠、搜索框宽度是否 <180px。

## 五、回滚与收尾

- 回滚：把 `_backup/<步骤>/index.html`、`server.mjs` 覆盖回去 → 重启服务 → 全量测试
- 收尾：删临时脚本（`tests/_out/*.cjs`、临时 png）、更新 CHANGELOG/ARCHITECTURE/AGENTS、版本 +1
- 对外口径：线上仍是旧版，部署另行确认；本地验收永不动线上
