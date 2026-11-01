# Agent 工作台 · 架构说明

> 本文档是**可执行的架构约定**，不是愿景。每一条都对应代码里的具体位置。
> 改动架构前先读这里；改完架构同步更新这里。

## 一、这个项目是什么

一个单用户、多设备（3 台电脑）协同的**任务台账 + GitHub 同步记录看板**。
主要使用者是 AI agent（写入为主）和人（查看与修正为主）。

单文件页面（`public/index.html`）+ 零依赖 Node 服务（`server.mjs`）+ JSON 文件存储。
四张表：任务台账 / 机器登录态 / 登录账号 / GitHub 同步记录。

## 二、硬约束（决定了架构形态）

| 约束 | 来源 | 影响 |
|---|---|---|
| 单文件页面 | 部署形态就是单 HTML | **不能物理拆文件**，模块化只能靠文件内分层 |
| 无框架、无构建 | 零依赖 + 直接静态托管 | 纯 ES5 风格前端，IIFE 包裹 |
| tools-center 要求零依赖 | 仓库约定 | `server.mjs` 只用 Node 内置模块 |
| 四张表共用同一套字段名 | 前端一套业务代码 | 字段名集中在 `F.t / F.m / F.a / F.g` |

## 三、四层分层

```
┌─ 视图层 ── 只拼字符串，无副作用
│   cardHTML / repoCardHTML / aiTable / render*
│   ↓
├─ 业务层 ── 纯函数，可单测
│   kpiMatch / isStale / todoStat / aiExample
│   ↓
├─ 状态层 ── S 三分域（写入走 setter）✅ 已收口
│   S.data：四张表 + schema 选项 + ready
│   S.ui  ：搜索词 / 视图 / 管理模式 / 弹窗与导航栈 / GitHub 筛选·强度·日历
│   S.sel ：批量选择（管理模式里勾中的任务与记录）
│   ↓
└─ 数据层 ── db.*（有封装）+ Repo（仓储门面）✅ 已收口
    query / getSchema（读）｜Repo.<表>.update / create / remove → db.updateRecord / addRecord / deleteRecord
```

### 已达标的边界

- **数据层适配**：页面只依赖 5 个 db 方法（`query/getSchema/addRecord/updateRecord/deleteRecord`），由 `localDb()` 适配器转成本地 REST。页面里没有任何平台 SDK 残留，换存储后端只需改这一个适配器。
- **写库单一出口（v1.4.6）**：所有写入都走 `Repo.<表>.update / create / remove`（四张表 × 三个动作），`db.updateRecord / addRecord / deleteRecord` 只在 `Repo` 内出现 3 次。调用点的 `then / catch` 保持原样，所以错误提示与回滚位置不变。
- **状态三分域（v1.4.7）**：`S.data / S.ui / S.sel` 各自只用 setter 写；`audit_no_guards.cjs` 静态断言「源码剥掉注释后不允许出现 S 字段直接赋值」，防止以后又回到「随便改、忘记重绘」。
- **点击路由表（v1.4.8）**：全局委托不再是一长串 `if (closest(...))`，而是 `CLICK_ROUTES = [{ sel, stop, run }]` 数组——顺序即数组顺序，命中即 return；`stop` 显式标注是否 `stopPropagation`。整卡判定（`[data-open]` / `[data-repo-open]`）固定在数组末尾，顺序被改坏会被 `audit_repo_card` 与 `mutation_test` 抓到。
- **拖拽一职责一函数（v1.4.9）**：`bindDrag` 只负责装配，`bindColumnDrag` 只管列顺序、`bindCardDrag` 只管卡片排序与跨列移动；dragover 只改 DOM，**落库只在 dragend**；兜底列 `.col-orphan` 在两个 dragover 里都被拒收。
- **单一渲染入口**：`render()` 是唯一的全量刷新点，避免多处局部刷新导致状态漂移。
- **字段映射集中**：`F.t / F.m / F.g` 三个对象定义全部字段名，改字段名只动这一处。
- **视图状态：单一枚举，零守卫**。视图只有 5 个合法值（`doing` 进行中 / `all` 全部 / `done` 已完成 / `att` 需要关注 / `todo` 未勾待办），每个自带完整取数规则（`VIEW` 表），`setView(v)` 是唯一的状态修改入口。
  - 为什么不用「分段 × 过滤」两维：两个维度必然能组合出无意义组合（已完成 ∩ 需要关注 恒为空集），于是必须加守卫拦截非法组合——**守卫是补丁压补丁**，越多状态越难推理，迟早出现「显示激活但内容没变」的自相矛盾状态。
  - `att` / `todo` 的规则本身就限定在「进行中」内，它们不是叠加在分段上的过滤器，而是独立的完整视图。
  - **没有任何合法性判断**：`setView` 里没有「非法值兜底」，也没有 `kpiAllowed` 之类的函数——所有调用点都经过 `viewOfSeg` / `viewOfKpi` 映射（返回字面量），非法值不可能传入。
  - 副作用清理也放在源头而非渲染时兜底：例如删除电脑时**主动清理**指向它的 GitHub 筛选，而不是在 `renderGithub` 里加「筛选指向已删电脑就复位」的守卫。
  - `tests/audit_no_guards.cjs` 会审计这一点，防止守卫回流。
- **看板列宽自适应**：任务看板 `.board` 与 GitHub 看板 `.gh-list` 用**同一套机制**——`repeat(auto-fill, minmax(min(100%, 300px), 1fr))`。宽度够就并排显示更多列，放不下自动换到下一行；`min()` 里的 `100%` 保证列永不超过容器，因此**永不产生横向滚动条**。每列内部独立纵向滚动（`.col-body { overflow-y: auto }`），列头固定。
- **两套看板同一套「判定范围」机制**：点击判定属性都挂在**卡片容器**上，不挂标题文字。
  - 任务卡：`.card[data-open]` → 点卡片任意处打开任务详情
  - 仓库卡：`.repo-card[data-repo-open]` → 点卡片任意处打开仓库详情
  - 卡内按钮（复制链接 / 查看全部 / ＋记录同步 / ⋯ 菜单 / 编辑 / 复制交接）各走各的，**判定分支必须排在所有卡内按钮之后**——`closest()` 会向上找到最近的匹配祖先，卡内按钮没有该属性时会被容器抢走。
  - `tests/audit_repo_card.cjs` 专门审计这一点（15 项）。
- **弹窗状态：单一枚举，零守卫**。所有浮层共用一个 `#drawer` + `#mask`，状态是 `S.sheet = { kind, id, repo }`，`kind` 四个合法值：`taskDetail`（任务详情·就地可编辑）/ `taskForm`（任务表单）/ `ghForm`（同步记录表单）/ `repoDetail`（仓库详情·只读）。
  - **为什么只有一个浮层**：苹果规范明确「不要在弹窗上再叠弹窗」。所以「点详情 → 点编辑 → 点某条记录」全是**同一个弹窗换内容**，不是叠层。切换只改 `innerHTML`，位置与动画状态都不变。
  - **底栏按钮由单一函数决定**：`setSheetFoot({save, edit, copy, repoAdd, repoCopy, del})` 一次性设定，不再在各处零散地改 `style.display`（审计脚本会检查散落赋值数量）。
  - **不再用 `className` 整体覆盖**弹窗（会丢掉 `wide` 等修饰类），统一 `classList.add/remove('on')`。
  - `tests/audit_no_guards.cjs` 会审计这一点，防止守卫与散落赋值回流。

### 弹窗导航栈（可返回的钻取）

弹窗承载的是一条**视图路径**，不只是"当前这一屏"：

```
仓库详情  ──push──▶  某条记录的编辑表单
任务详情  ──push──▶  任务编辑表单
```

**问题**：早期版本只有"当前层"，一旦钻取就回不去 —— 用户反馈「GitHub 卡片打开后，编辑某一条，无法退回上一个窗口」。

**解法**：`S.sheetStack` 存历史层，`S.sheet` 是当前层。每层是一个完整描述 `{kind, id, repo}`，**能被纯渲染函数重建** —— 所以「返回」不需要重新查数据源，也不会丢上下文。

两种进入方式，语义清晰、无需守卫：

| mode | 行为 | 用在哪 |
|---|---|---|
| `root` | 清空栈（顶层，无上一层可返回） | 从看板点卡片、点「＋新增」 |
| `push` | 压栈（保留上一层，可返回） | 仓库详情→记录编辑、任务详情→编辑 |

**关键设计**：每个视图拆成「纯渲染函数」+「导航动作」两部分：
- `renderTaskDetail(t)` / `renderTaskForm(d, id)` / `renderGhForm(id, repo)` / `renderRepoDetail(repo)` —— 只管画内容
- `renderSheetLayer(layer)` —— 按 `kind` 分派到上面某个渲染函数，**返回布尔**（这一层的数据是否还在）
- `gotoSheet(layer, mode)` / `backSheet()` —— 唯一的导航入口

**失效层自动跳过**：如果某一层对应的记录被删了，`renderSheetLayer` 返回 false，`backSheet` 就继续往上退，直到退到有效的层或退空关窗。所以「删掉正要返回的那个对象」不会白屏。

**Esc 语义分层**：栈里还有上一层 → 退一层（不是关窗）；没有 → 关窗。确认框在最上层时 Esc 只关确认框。

**保存/删除后的去向**：若有上一层 → 退回上一层（用户立刻看到刚改的那条）；否则 → 关窗。

`tests/audit_sheet_nav.cjs` 审计全部钻取路径（27 项）。

### 弹窗形态规范（苹果 HIG + Apple Motion）

所有浮层——任务详情、任务表单、同步记录表单、仓库详情、AI 指南、添加电脑、确认框——**一律从屏幕正中央弹出**，没有侧边滑入。

| 要素 | 规格 | 依据 |
|---|---|---|
| 位置 | 面板中心 = 视口中心（几何判定，非 class 名） | HIG：modal presentation 从正中 |
| 进场 | scale 0.92 → 1 + opacity 0 → 1，**340ms**，spring 曲线 `cubic-bezier(.32,.72,0,1)` | HIG：92%→100% scale + opacity |
| 退场 | scale 1 → 0.92 + opacity 1 → 0，**200ms** | 进出不对称：出利落、进从容 |
| 曲线 | 进场用 spring，退场用 `cubic-bezier(.16,1,.3,1)` | Apple Motion |
| 玻璃 | 遮罩 `blur(14px) saturate(115%)` + 半透明深色 + 1px 半透明边框 + 柔和阴影 | 磨砂玻璃四件套 |
| 材质化 | blur 半径随 scale 同步动画（0 → 14px），不是单纯淡入 | "Materialize, don't just fade" |
| 降级 | `prefers-reduced-motion` → 只做 120ms opacity 交叉淡入；`prefers-reduced-transparency` → 关 blur 退回实体背景 | 无障碍 |

**进出不对称怎么实现的（无 JS 计时器）**：CSS `transition` 取**目标状态**上声明的值。所以 `.drawer` 基础态写 `--dur-out`、`.drawer.on` 写 `--dur-in`，同一个 class 切换自动获得不对称时长，中途反向也能从当前值接续（可中断）。这是纯 CSS 方案，比 JS 计时器可靠——不会因为标签页失焦而错乱。

**退场怎么做**：关闭时**移除 `.on` 而不是 `display:none`**，让 transition 自己走完；配合 `visibility 0s linear var(--dur-out)` 让元素在退场结束后才真正不可见，关闭状态下完全不产生 `backdrop-filter` 开销。

### 暖色皮肤与手机形态（v1.4.1）

**主题只换 token，不换逻辑**：`data-theme` 两套（`dark` 暖黑，默认 / `light` 暖白）。页面所有颜色都走 `:root` 变量，
所以换肤是改 13 个色值，不是改规则。

- **纸面分层**：页面底（`--bg`）→ 窗格（`--panel`）→ 列 / 仓库卡（`--panel-2`）→ 任务卡（`--panel`）。
  层级靠亮度差与阴影，不靠描边；只有「未识别电脑」兜底列保留虚线框（它需要被看成异常）。
- **实心按钮单独一对 token**（`--btn-bg` / `--btn-fg`）：暖黑下 `#E08362` 配白字只有 2.6:1，
  所以暖黑用「亮底深字」、暖白用「深陶土底 + 白字」。直接复用 `--accent` 会在其中一个主题上不可读。
- **KPI 不再承载提示**：右上角小提示在窄瓦片里会和数字重叠，v1.4.1 起只在数据里保留语义，不画提示。

**手机形态（`@media (max-width: 700px)`）**：

| 机制 | 做法 | 为什么 |
|---|---|---|
| 单页 | `body[data-page]` + 隐藏另一栏 | 手机没有横向空间，分屏只会把两栏都压扁 |
| T-bar | 底部固定，中央凸起「AI 指南」 | 主操作（新建/管理/主题）收进「更多」，避免顶栏拥挤 |
| 遮罩层级 | T-bar `z-index:30`，低于遮罩 40/44 | 否则弹窗打开时还能点到切页（v1.4.1 实测复现并修复） |
| 列高 | `grid-auto-rows: max-content` + `align-content:start` | grid 容器有固定高度时默认把行拉满，卡片会超出列高、压到下一列 |
| 同步记录 | `grid-template-areas` 两行排 | 窄屏下「时间/版本/状态/内容」四列会把内容挤成省略号 |

**断点为什么是 700 而不是 760**：手机最宽约 430，700 已覆盖；测试用 `--dump-dom` 的默认视口是 748，
必须留在宽屏形态，否则 `mk_v16` 的列数/列内滚动断言会被判成移动端（这批断言本就该在桌面形态下测）。

### 任务详情：看得见就能改（v1.4.2）

早期是「点卡片 → 只读详情 → 点编辑 → 改表单 → 保存」，最常改的标题 / 进度 / 待办都要走三步。
v1.4.2 起详情本身可编辑，**表单保留给「一次改多个字段」**：

| 元素 | 交互 | 实现 |
|---|---|---|
| 标题 / 进度 / 交接 / 目录 | 点一下变输入框（单行 Enter、多行 ⌘/Ctrl+Enter 或失焦提交） | `startDtEdit()` |
| 状态 / 优先级 | 点一下弹小菜单 | `openDtMenu()` → `applyDtSet()` |
| 待办 | 点一行直接勾选 | 复用表单的 `toggleTodo()` |

所有就地保存都走 `saveTaskField()`：只提交「一个字段 + 更新时间」，改完重绘看板与详情，
**不关窗、不动导航栈**；失败则重新拉取并回滚。这与「表单保存」是两条路径，但写库语义一致（增量字段）。

### 两处缺口（已收敛）

1. ✅ **状态层（v1.4.7 已收口）**：`S` 拆成 `S.data / S.ui / S.sel` 三个域，字段只属于一个域；
   写入一律走 `setData / setUi / setSel`（复合状态另给 `setGhFilter` / `toggleGhExpanded`），
   源码里对 S 字段的直接赋值是 **0 处**，并由 `audit_no_guards.cjs` 的静态断言防回流。
2. ✅ **数据层（v1.4.6 已收口）**：原先 30 处写库调用散落在 20+ 函数里，各写各的副作用。
   现在统一走 `Repo.<表>.update / create / remove`，源码里只剩 3 处 `db.*`（全在 `Repo` 内）。
   调用点原有的 `then / catch / Promise.all` 语义原样保留，行为与 v1.4.5 一致。

**为什么有缺口也能用**：单人维护、功能边界稳定，改一个功能的平均触点 ≤3 处。
**什么时候必须补**：开始出现「加一个功能要碰 5 个地方 + 属性名撞车」时。v19 的删除电脑事故就是这个临界点的实证。
下一批待收口的是**事件路由**（55 个 `closest` 分支靠顺序）与 `bindDrag`（一步多职责），见第 4/5 步计划。

## 四、数据流

```
loadAllData()
  ├─ loadMachines()  → db.query(DB_MACHINE)  分页游标
  ├─ loadTasks()     → db.query(DATABASE_ID) 分页游标
  └─ loadGithub()    → db.query(DB_GITHUB)   分页游标
        ↓
render()
  ├─ renderSummary()   → #summary（任务 KPI）
  ├─ renderBoard()     → #board（按机器分列）
  ├─ renderGithub()    → #ghKpis（内联概览数字）+ #ghIntensity（开发强度）+ #ghList（仓库聚合卡）
  └─ renderAiGuide()   → AI 写入指南抽屉（按需）
        ↓
事件委托（document click → closest('[data-*]')）→ 具名业务函数
        ↓
Repo.<表>.update / create / remove（四张表 × 三个动作，README 里是 3 处 db.* 调用）
```

## 五、字段契约

| 表 | 常量 | 关键字段 |
|---|---|---|
| 任务台账 | `DATABASE_ID` | 任务标题 / 状态 / 优先级 / 所在电脑 / 目录 / 进度 / 待办 / 交接内容 / 更新时间 / 排序 |
| 机器登录态 | `DB_MACHINE` | 机器名 / 位置 / WorkBuddy账号 / TRAE账号 / 最后确认 / 排序 |
| 登录账号 | `DB_ACC` | 账号名 / 平台 / 所属电脑 / 当前 / 备注 / 最后确认 / 排序 |
| GitHub 同步记录 | `DB_GITHUB` | 同步时间 / 电脑 / GitHub账号 / 仓库 / 内容 / 同步版本 / 是否同步 / 仓库归档 / 仓库置顶 |

**语义边界（易混，务必分清）**：
- `是否同步`（记录级，select）：已同步 = 已推到 GitHub；未同步 = 本地有版本还没推
- `仓库归档`（仓库级，checkbox）：该仓库是否已在 GitHub 归档。**任一条记录勾上即视为已归档**
- `仓库置顶`（仓库级，checkbox）：该仓库是否置顶。**任一条记录勾上即视为置顶**；排序 = 置顶优先 → 最近更新时间倒序，
  多条置顶之间也按更新时间。切换时把该仓库所有记录一起写（读侧用「或」聚合，写侧保持一致，避免出现半置顶）
- `WorkBuddy账号` / `TRAE账号`（机器表）：**派生只读**，值来自 accounts 表里该机该平台「当前」那条；存储里不落第二份。写入会被服务端翻译成「设为当前」
- `当前`（账号表）：同一台电脑 × 同一平台至多一条为 true；**全为 false 表示该平台当前没登录，但账号仍登记着**
- **一号多机会告警（v1.4.3）**：同一个账号名在多台电脑都是「当前」时，这些电脑列头的胶囊转告警色 + `!` 徽标，
  悬停标题指认对方机器；判定用 `accShared().curOthers`（别用 `others`，那只是「登记过」）
- **顶栏快捷指南的选择会记住**：`S.aiMachine` 与 `localStorage('awb.aiMachine')` 双向同步；
  机器被删/改名时自动退回第一台并纠正存储值

### 硬编码库 id 的处理

JS 侧一律用 `DATABASE_ID` / `DB_MACHINE` / `DB_ACC` / `DB_GITHUB` 四个常量。
页面里已无任何平台绑定标记，库 id 全部走常量。

## 六、扩展指南：改一个东西要碰几处

### 加一个任务字段

1. `F.t` 加字段名映射（1 处）
2. `public/index.html` 的抽屉表单加 `<input>`（1 处）
3. `collectTaskProps` 读值（1 处）
4. `AI_CONTRACT.dbs[].fields` 补字段说明（1 处，AI 靠它填表）
5. `server.mjs` 的 `SCHEMAS.tasks.properties` 补 schema（1 处，本地版）
6. `server.mjs` 的 `SCHEMAS` 里补字段

### 加一个视图 / 分区

1. 写渲染函数（拼字符串，无副作用）
2. 在 `render()` 里挂上调用
3. 事件委托加分支（注意与既有 `data-*` 的匹配顺序，见 `docs/DOM-ATTRIBUTES.md`）

### 加一个写操作

**先不要**直接调 `db.*`。正确做法是走 `Repo` 层的统一语义（增量字段 + 自动更新时间 + 错误提示），避免「批量带 updated、单条不带」这类不一致。

## 七、目录结构

```
agent-workbench/
├─ manifest.json          tools-center 接入声明（V2）
├─ server.mjs             本地版后端：静态托管 + REST + JSON 存储（零依赖）
├─ contract.md            AI 写入契约（markdown 版）
├─ public/
│  └─ index.html            ★ 页面（唯一真源，直接改这里）
├─ design/
│  ├─ redesign-mockup.html  UI 重构原型（旧）
│  └─ ui-v3-warm.html       暖色原型 v3（无边框全屏 + 居家暖色，待落地）
├─ docs/
│  ├─ ARCHITECTURE.md       本文件
│  └─ DOM-ATTRIBUTES.md     DOM 属性登记表（改前必查）
└─ tests/
   ├─ run_all.py            统一入口：套件回归 + 本地版 e2e + 11 个审计脚本
   ├─ mk_*.py               各功能套件（生成含断言的 HTML）
   ├─ e2e_local.cjs         端到端（真实 server + 真实 fetch）
   ├─ cdp.cjs               零依赖 CDP 客户端
   ├─ audit_view_state.cjs  视图状态一致性体检
   ├─ audit_no_guards.cjs   守卫清零审计
   ├─ audit_write_paths.cjs 真实写路径体检
   ├─ audit_edge_cases.cjs  边界情况体检
   ├─ audit_sheet.cjs       弹窗形态审计（居中 + 动效 + 玻璃）
   ├─ audit_sheet_nav.cjs   弹窗导航栈体检（钻取可返回 + 失效层跳过）
   ├─ audit_repo_card.cjs   仓库卡交互体检（整卡判定 + 卡内按钮不抢）
   ├─ audit_gh_header.cjs   GitHub 看板头部体检（KPI 内联位置 + 开发强度滚动）
   ├─ audit_journey.cjs     端到端旅程体检（完整操作链路连贯）
   ├─ audit_platform_proxy.cjs 平台反代前缀体检（挂 /tool/… 下 API 不 404）
   ├─ audit_account_edit.cjs   机器菜单 + 账号面板体检（共享名单 / 改名 / 解绑）
   ├─ mutation_test.cjs     变异测试（验证审计脚本本身可信，需手动跑）
   └─ _baseline/            断言基线快照（回归比对用）
```

## 八、开发与测试

### 改代码的姿势

页面是单文件，没有生成步骤：

```
改 public/index.html  →  跑 python tests/run_all.py
```

### 测试

```bash
cd agent-workbench

# 全部（5 套件回归 + 本地版 e2e）
python tests/run_all.py

# 单套件
python tests/run_all.py mk_v16

# 重建基线快照（确认是有意的行为变更后）
python tests/run_all.py --bless

# 只跑本地版 e2e
node tests/e2e_local.cjs 8159
```

**回归判定机制**：每次运行把断言结果与 `tests/_baseline/*.json` 比对。
出现差异 → FAIL 并列出变化的具体键。这比手写 200 条期望值更可靠，且能直接告诉你「哪里变了」。

**e2e 覆盖**：真实 `node server.mjs` + 真实 `fetch` + 真实浏览器，验证「读渲染 → UI 新增 → REST 写库 → 落盘 → 重新渲染」全链路。

**视图状态体检**：`tests/audit_view_state.cjs` 穷举所有 UI 操作序列，检查三条不变量——KPI 高亮 ⟺ 内容真被过滤、分段高亮唯一、空看板必须给出原因说明与清除入口。它专治「点了没反应」这类状态自相矛盾的问题。

**弹窗形态审计**：`tests/audit_sheet.cjs` 验证所有浮层都从正中弹出（几何判定）、磨砂玻璃生效、动效令牌不对称、底栏按钮与内容态一致、浅色主题下仍可读。

**守卫清零审计**：`tests/audit_no_guards.cjs` 静态扫源码，确保视图状态层与弹窗状态层都没有「补丁式守卫」回流。

**GitHub 看板头部体检**：`tests/audit_gh_header.cjs` 验证头部三块：4 个概览数字确实内联在「选择电脑」右侧同一行且样式低调（字号 ≤ 15px、无卡片底色与实线边框）、「未同步」数字搬家后点击筛选功能没丢；开发强度 = 横向柱状图（横轴日期旧→新、零更新日灰柱、近7/30/90 天切换、每根柱有悬停提示）+ 面板高度与任务看板 KPI 四方块对齐；点面板打开全年日历热力弹窗（53 周 365 格、月/星期标签与图例齐全、弹窗自动加宽且无横向滚动、格子悬停有 tooltip、Esc 关闭后恢复标准宽），24 项。

**端到端旅程体检**：`tests/audit_journey.cjs` 模拟用户完整操作链路（仓库卡→详情→编辑→返回→换一条再编辑→关闭 / 任务卡→详情→编辑→返回→复制交接 / 跨面板切换不串状态 / 快速连点不错乱 / 管理模式与弹窗互不干扰），18 项。审计单点容易漏掉「单步都对、串起来错」的情况 —— 旅程测试专门补这个。

**变异测试（审计脚本自身的可信度验证）**：`tests/mutation_test.cjs` 故意往源码里注入 10 种 bug（返回箭头该藏没藏、backSheet 弹错层、返回时不重绘、整卡判定被卡内按钮抢走、复制链接按钮消失、弹窗不居中、动效退化、磨砂玻璃失效、守卫回流、XSS 漏转义…），逐一验证对应审计脚本**必须报警**，然后还原源码。

```bash
node tests/mutation_test.cjs   # 期望：10 项被捕获 / 0 项漏网
```

**这个测试会临时改写 `public/index.html`**，所以**刻意不放进 `run_all.py`**（避免与其它审计并发时互相干扰）。它的意义是：审计脚本自己也可能是假阳性 —— 只有证明「注入 bug 一定会被抓到」，才能相信「没报警 = 没问题」。

> 编写变异测试时踩过的坑：一开始 3 个变异「没被抓住」，排查后发现**是变异本身无效**（改了基础态但 `.on` 状态没改、改到了 `-webkit-` 前缀那行而不是标准属性行）。这提醒了一件事：**审计没报警 ≠ 审计失灵，也可能是变异没打中要害** —— 但无论哪种，都必须查清。

### 数据重置

```bash
node server.mjs 8151 --reseed   # 重置四张表为内置种子数据（先自动备份）
```

本地数据与代码分离：平台注入 `CAP_STORAGE_DIR` 时用它；本地直跑落在仓库外的 `../agent-workbench-data/db.json`（仓库永远不带数据）。每次写盘前自动备份到同目录 `.bak/`（保留 10 份）。首次启动是空壳（四张表全空），演示数据用 `--reseed` 按需生成。测试（audit_*.cjs / e2e_local.cjs）一律走 `tests/fixture_db.cjs` 夹具 + `tests/_out/storage-<端口>` 临时目录，不碰真实数据。

老库升级：首次读库时把机器表的单值账号搬进 `accounts` 表（一条 = 当前），并清掉机器表上的旧字段；靠 `db._meta.accountsMigrated` 保证只跑一次，误操作可从 `.bak/` 回滚。

## 九、已知问题与后续计划

| 级别 | 问题 | 计划 |
|---|---|---|
| P0 | ~~测试住在临时目录~~ | ✅ 已搬进 `tests/`，含统一 runner 与基线比对 |
| P0 | ~~库 id 硬编码 9 处~~ | ✅ 已收敛为常量引用（仅剩 2 处 HTML 静态标记） |
| P0 | ~~损坏库被静默当空库覆盖~~ | ✅ 解析失败先另存 `db.corrupt-<时间>.json`，`/health` 暴露原因 |
| P0 | ~~写入无校验（AI 脏数据直接落盘）~~ | ✅ 服务端校验必填/枚举/机器名唯一，时间戳与状态补默认值 |
| P1 | ~~写库无仓储层：实测 **30 处** `db.update/add/delete` 调用~~ | ✅ v1.4.6 引入 `Repo` 门面，收敛为 3 处 `db.*` + 30 处 `Repo.<表>.*` |
| P1 | ~~`S` 无边界：**17 个字段 / 59 处 `S.x =` 直接赋值**~~ | ✅ v1.4.7 拆 `S.data / S.ui / S.sel`，写入走 setter，直改归零 |
| P1 | ~~电脑改名/删除只搬服务端，客户端不重拉账号池 → 胶囊「未登录」、共享池幽灵登记、GitHub 筛选残留旧名~~ | ✅ v1.5.0 改名/删机后重拉账号；筛选指向旧名则清空；筛选下拉改为「机器表 ∪ 记录」 |
| P1 | ~~改名被服务端拒绝后，内存里已改的任务名不回滚（整列任务跑到别的电脑）~~ | ✅ v1.5.0 `updateMachineFields` 返回成功标志，失败即还原 |
| P1 | ~~批量更新/删除部分失败仍按「全部成功」提示，且本地已按全量改写~~ | ✅ v1.5.0 统计失败数，有失败就重拉并如实提示 |
| P2 | ~~顺序持久化 / schema 加载失败只 console，用户无感知~~ | ✅ v1.5.0 补 toast（失败条数 / 下拉为空原因） |
| P1 | ~~无架构文档~~ | ✅ 本文件 |
| P2 | 测试断言绑死日历日期（隔天假红） | ✅ 已改为相对日期 + 不随日期漂移的布尔断言 |
| P2 | ~~`bindDrag` 实测 **104 行**承担 5 件事~~ | ✅ v1.4.9 拆成 `bindColumnDrag` / `bindCardDrag` / 顺序持久化（最长函数降到 68 行） |
| P2 | ~~事件委托集中在单个监听器：**55 个 `closest()` 分支**，顺序敏感~~ | ✅ v1.4.8 改成有序 `CLICK_ROUTES` 路由表（35 条路由），整卡判定固定在最后 |
| P2 | ~~`canDraft` 108 行且名不副实~~ | ✅ 实际只剩一行判断，文档数字已校正 |
| P2 | ~~三个抽屉共用单 mask + `S.drawerMode`~~ | ✅ 已统一为单浮层 + `S.sheet` 单一枚举 |
| P3 | ~~无障碍缺口：任务卡/仓库卡用 div 承接点击（不可聚焦）、toast 无 `aria-live`、图标按钮缺 `aria-label`~~ | ✅ v1.5.2：卡片加 `tabindex/role/aria-label` + Enter/Space 打开；toast 加 `role=status`；图标按钮补 label；18 个 label 补 `for`；新增 `audit_a11y`（10 项）守护 |
| P3 | 无障碍剩余：拖拽无键盘替代（列/卡排序）、弹窗关闭后焦点不回填、`Esc` 之外无焦点陷阱 | 下一批：拖拽提供「上移/下移」菜单项；关闭时把焦点还给触发元素 |
| P3 | 单文件物理体量：`index.html` **5081 行**（CSS 1140 / JS 3762，170 个顶层函数） | 硬约束「零构建/单文件」下不拆文件，只维持分节注释与依赖方向 |

### 规模基线（v1.5.2 实测，供后续改动对比）

| 指标 | 数值 | 参考阈值（仅作参照，不是硬指标） |
|---|---|---|
| 单文件行数 | 5081（CSS 1140 + JS 3762，另有 HTML 骨架） | 常见 lint 推荐 300–500 行/文件（本条受「单文件产物」硬约束） |
| 顶层函数 | 170（含 `Repo` 4 个、状态 setter 5 个、拖拽 3 个） | — |
| 最长函数 | `renderIntensitySheet` / `paintAccPanel` 68 行，其余渲染函数 45–65 行 | Godlint 建议 30 行/函数；SonarQube 更关注圈复杂度（默认 15） |
| 直接写库调用 | 3（全在 `Repo` 内）＋30 处 `Repo.<表>.*` 调用点 | ✅ 已达标（原 30 处直接调 `db.*`） |
| 状态直接赋值 | 0（全部走 setter；体检有静态断言防回流） | ✅ 已达标（原 42 处直接赋值 + 6 处嵌套写） |
| 事件委托分支 | 35 条路由（其余 22 处 `closest()` 都在单容器小处理器里） | ✅ 已达标（原 37 个顺序敏感分支挤在一个监听器里） |

### 明确不做的

- **不引入框架 / 构建工具**：单文件产物 + 零依赖是硬约束，引入构建只会让发布链路复杂化，收益为零。
- **不提前抽象重复代码**：40 段重复里大多是「模式相似但语义不同」的骨架。Google 的提醒是过早 DRY 会把两套会分叉的需求绑在一起——抽之前先确认它们会不会分叉。
