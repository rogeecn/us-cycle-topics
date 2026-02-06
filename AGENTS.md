# AGENTS.md

> 本文件定义本项目后续工作的**统一行为约束**。  
> 任何实现、重构、扩展、自动化任务默认必须遵守。  
> 若与新需求冲突，必须先与项目负责人确认再调整。

---

## 1. 项目目标与边界

### 1.1 目标
构建一条可持续、可重建、可扩展的内容生产流水线：

1. `Genkit + dotPrompt` 生成结构化内容；
2. 结构化内容写入 `PostgreSQL`；
3. `Node` 定时任务从数据库读取增量/全量内容，生成 Hugo Markdown；
4. 生成后执行 `hugo build`（推荐 `hugo --minify`）；
5. 支持后续模板升级、批量重渲染和自动化发布。

### 1.2 非目标
- 不以“直接生成 Markdown 文件”作为唯一内容源。
- 不把聊天记录中的人生/性格分析内容纳入项目需求。
- 不在未确认细节前做大范围架构漂移。

---

## 2. 硬性架构约束（MUST）

### 2.1 分层职责（不可混淆）
- **Producer 层**：仅负责 AI 内容生成与入库。
- **Store 层**：PostgreSQL 作为唯一事实源（Source of Truth）。
- **Renderer 层**：仅负责从 DB 转换为 Hugo `.md`。
- **Build/Publish 层**：仅负责 Hugo 构建和发布。

### 2.2 数据与表现分离
- DB 存结构化内容 + 原始输出，不依赖反向解析 `.md`。
- Hugo Markdown 是“可再生产物”，不是权威数据源。

### 2.3 生成模式
- 必须同时支持：
  - **增量生成**（默认）
  - **全量重建**（模板/规则变化时）

---

## 3. Genkit 与 Prompt 约束

### 3.1 工具约束
- 内容生成必须使用 `Genkit`。
- Prompt 管理必须使用 `dotPrompt`。

### 3.2 输出约束
- 必须使用结构化输出（JSON Schema / Zod Schema）。
- 最低输出字段要求：
  - `title`
  - `description`
  - `slug`
  - `tags`
  - `content`
  - `lastmod`

### 3.3 可追溯性
- 入库时必须记录：
  - `prompt_version`
  - `model_version`
  - `raw_json`

---

## 4. PostgreSQL 约束

### 4.1 表设计原则
- 主业务表必须含有状态字段与错误字段。
- `slug` 必须唯一。
- 支持按 `status + updated_at` 做增量扫描。

### 4.2 状态流转（建议）
`draft -> generated -> rendered -> built -> published`  
失败统一进入 `failed`，并记录 `last_error`。

### 4.3 幂等性
- 同一记录重复渲染不能产生重复文件。
- 同一 slug 多次执行结果应可预测、可覆盖。

---

## 5. Renderer 与 Hugo 约束

### 5.1 Renderer 任务
- 从 PG 读取目标记录（增量或全量）。
- 统一模板生成 Front Matter + Markdown。
- 写入 `content/posts/*.md`。

### 5.2 Hugo 构建
- Markdown 生成后必须执行构建。
- 构建失败不得推进发布状态。

### 5.3 Front Matter 规范
至少包含：
- `title`
- `date`
- `lastmod`
- `description`
- `slug`
- `tags`
- `draft`

---

## 6. 定时任务与运行稳定性约束

### 6.1 调度
- 使用 Node 定时任务（cron/scheduler）。
- 调度频率可配置，不硬编码。

### 6.2 稳定性
必须具备：
- 任务锁（防并发重入）
- 重试机制（建议指数退避）
- 错误落库
- 可观测日志（开始/结束/耗时/成功数/失败数）

### 6.3 失败处理
- 失败记录不可静默丢弃。
- 支持失败重跑与补偿。

---

## 7. 工程实施行为约束（后续协作）

### 7.1 变更策略
- 小步迭代，优先 MVP。
- 修 bug 不夹带无关重构。
- 未经确认不得修改核心分层。

### 7.2 沟通策略
- 当前聊天结论视为“方向确认”，细节必须多轮确认。
- 对以下事项必须先确认再实现：
  1. 调度频率
  2. 发布方式（rsync / git push / CI）
  3. 内容质量阈值
  4. URL 覆盖策略
  5. 告警策略

### 7.3 交付标准（DoD）
每次功能完成至少满足：
1. 结构化内容可入库；
2. 可从 DB 生成 Hugo md；
3. 可触发 Hugo build；
4. 有清晰日志与错误记录；
5. 可重复执行且结果稳定。

---

## 8. 推荐目录（可按实际项目调整）

```text
/apps
  /producer      # Genkit + dotPrompt 生成与入库
  /renderer      # PG -> Hugo Markdown
  /scheduler     # 定时调度与任务编排
/db
  /migrations    # PG schema 迁移
/docs
  /architecture  # 架构与流程文档
/scripts
  build-and-publish.sh
```

---

## 9. 约束优先级

当出现冲突时按以下顺序执行：

1. 本文件（AGENTS.md）硬约束
2. 最新经你确认的需求澄清
3. 代码实现细节与临时脚本

---

## 10. 生效说明

本文件从创建时起立即生效，作为后续工作的默认行为准则。  
任何偏离必须在任务开始前显式说明并获得确认。