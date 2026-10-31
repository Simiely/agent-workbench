# Agent 工作台 · 数据写入契约

> 这份契约就是给 AI 看的：照着写就不会被看板拒收。
> 页面内也有同一份（顶栏「🤖 指南」按钮，可一键复制），本地版还提供 `GET /api/contract` 与 `GET /api/contract.json`。

## 任务台账（databaseId: oHFF5fIATWOsVWJqkwX4qm）

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| 任务标题 | text | 是 | 动宾短句，一眼看懂要做什么 |
| 状态 | select | 是 | 进行中 / 已完成（取值：进行中,已完成） |
| 优先级 | select | 是 | P0 最急 → P2 不急，只能这三个大写值（取值：P0,P1,P2） |
| 所在电脑 | text | 是 | 必须与机器表里的「机器名」完全一致，否则任务会落到「未识别电脑」列 |
| 目录 | text | 否 | 绝对路径，如 D:\home-inventory |
| 进度 | text | 是 | 一句话写当前进展，不要写日志 |
| 待办 | text | 否 | 一行一条；[x] 表示已完成，[ ] 表示未完成 |
| 交接内容 | text | 否 | 给下一个接手的 agent 看：背景、约束、回滚点 |
| 更新时间 | date | 是 | ISO 8601，如 2026-10-30T04:00:00Z（每次写入都更新） |
| 排序 | number | 否 | 同列内的顺序，小的在前 |

## 机器登录态（databaseId: WhBJD7Gp2SpTWOevS1xHnm）

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| 机器名 | text | 是 | 唯一标识，任务的「所在电脑」引用它 |
| 位置 | text | 否 | 家 / 随身 等位置标签 |
| WorkBuddy账号 | text | 否 | **派生只读** = 该机当前的 WorkBuddy 账号；写它等于「把那个号设为当前」 |
| TRAE账号 | text | 否 | **派生只读** = 该机当前的 TRAE 账号；写它等于「把那个号设为当前」 |
| 最后确认 | date | 否 | 最近一次确认登录态的时间 |
| 排序 | number | 否 | 看板列的顺序，小的在前 |

## 登录账号（databaseId: accounts）

一台电脑 × 一个平台 = 一个账号池，池里可以有多条，**至多一条「当前」**。

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| 账号名 | text | 是 | 如 坤坤 / 小黄；同一台电脑同一平台内不重名 |
| 平台 | select | 是 | 只能是 WorkBuddy / TRAE（取值：WorkBuddy,TRAE） |
| 所属电脑 | text | 是 | 必须与机器表的「机器名」完全一致 |
| 当前 | checkbox | 否 | 同一台机同一平台至多一条为 true；全为 false = 该机这个平台当前没登录 |
| 备注 | text | 否 | 公司号 / 个人号 之类 |
| 最后确认 | date | 否 | 最近一次确认或切换的时间 |
| 排序 | number | 否 | 面板里的顺序，小的在前 |

## GitHub 同步记录（databaseId: VTqYVRFriNPfKMcBqPQhOL）

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| 同步时间 | date | 是 | 这次同步的时间（未同步的版本填该版本完成时间） |
| 电脑 | text | 是 | 机器名，同任务表的「所在电脑」 |
| GitHub账号 | text | 否 | 如 Simiely |
| 仓库 | text | 是 | owner/repo，如 Simiely/ae-tools |
| 内容 | text | 是 | 这次同步了什么，一句话 |
| 同步版本 | text | 否 | 如 v1.5.8；多个用逗号分隔 |
| 是否同步 | select | 是 | 已同步 = 已推到 GitHub；未同步 = 本地有版本还没推（取值：已同步,未同步） |
| 仓库归档 | checkbox | 否 | 该仓库是否已在 GitHub 归档（仓库级属性，任一条记录勾上即视为已归档） |

## 写入约定

- 写任务前先读机器表，「所在电脑」必须是已登记的机器名；没有就先登记电脑，否则任务会落进「未识别电脑」兜底列
- **当前已登记的电脑（实时）**：`GET /api/query?db=machines`，或 `GET /api/contract.json` 的 `machines` 字段——「所在电脑」只能填这里出现的名字
- **一台电脑可以有多个账号**：多号写进 `accounts` 表，用「当前」标记唯一在用的那条；同一台机同一平台写了第二条「当前」会被服务端覆盖
- 机器表的 `WorkBuddy账号` / `TRAE账号` 是派生只读值，读它拿当前账号；往它写 = 把那个号设为当前（库里没有会自动补一条），写空串 = 清除登录态（账号不删）
- 枚举值严格照抄：状态=进行中/已完成，优先级=P0/P1/P2，是否同步=已同步/未同步，平台=WorkBuddy/TRAE；旧的「结果」字段已不存在
- 待办只认行首的 [ ] 与 [x]，不要用 - [ ] 或 ● 之类
- 每次写入都带上「更新时间」，否则卡片会被判为「久未动」
- 一份记录 = 一件事：一个任务 = 一个可交付的活；一个同步记录 = 一个版本的一次同步；一个账号 = 一台机上的一次登录

## 示例 payload

任务（新增）：

```json
{
  "databaseId": "oHFF5fIATWOsVWJqkwX4qm",
  "properties": {
    "任务标题": { "text": "合并 floorplan 低频工具" },
    "状态": { "select": "进行中" },
    "优先级": { "select": "P1" },
    "所在电脑": { "text": "台式机-家" },
    "目录": { "text": "D:\\home-inventory" },
    "进度": { "text": "paint/fill/sample/split 已合并成多步流程" },
    "待办": { "text": "[x] 移除剩余低频工具\n[ ] 渲染端与模块源码对齐" },
    "交接内容": { "text": "产品可用性优先，必要时调整宿主来适配模块" },
    "更新时间": { "date": "2026-10-30T04:00:00Z" }
  }
}
```

给「台式机-家」再加一个 WorkBuddy 账号（本地版）：

```json
{
  "db": "accounts",
  "properties": {
    "账号名": { "text": "小黄" },
    "平台": { "select": "WorkBuddy" },
    "所属电脑": { "text": "台式机-家" },
    "当前": { "checkbox": false },
    "备注": { "text": "个人号" },
    "最后确认": { "date": "2026-10-31T00:00:00Z" }
  }
}
```

## 本地版 API（tools-center 版）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | /api/contract | 本文件的 markdown 原文 |
| GET | /api/contract.json | 机器可读：字段名 / 类型 / 选项 / 必填 |
| GET | /api/schema?db=&#124;tasks&#124;machines&#124;accounts&#124;github | 单表结构 |
| GET | /api/query?db=… | 读记录 |
| POST | /api/records | 新增（{ db, properties }） |
| PATCH | /api/records/:id | 增量更新（{ db, properties }，只传要改的字段） |
| DELETE | /api/records/:id?db=… | 删除 |
