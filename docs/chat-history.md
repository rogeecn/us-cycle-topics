---
title: "US Cycle Topics - 项目对话整理（当前架构）"
updated: 2026-02-09
source: "基于已落地代码与确认需求重写"
---

# 项目对话整理（技术与落地版）

> 本文只保留项目相关信息，并与当前代码实现保持一致。

## 一、已确认方向（当前生效）

1. **架构分层**
   - `Genkit + dotPrompt` 负责结构化内容生成。
   - 结构化内容写入 `SQLite`（唯一事实源）。
   - `Node SSR` 直接从 DB 渲染页面。
   - `Node Scheduler` 推进内容状态并执行告警。

2. **触发方式**
   - Producer 主触发方式为 API：`POST /api/producer/run`。
   - 支持外部定时请求触发，不再依赖手工运行命令作为主路径。

3. **前端样式策略**
   - 保留 Mainroad 样式静态资产（CSS/JS/图片）。
   - 不再保留 Hugo 渲染、构建、发布实现。

---

## 二、当前落地架构（代码已实现）

### 1) Producer（内容生产层）
- 输入：topic/city/keyword/language。
- 执行：Genkit + dotPrompt。
- 输出：结构化结果 + 质量报告写入 SQLite。

### 2) Store（数据层）
- 数据库：SQLite。
- 原则：数据库是唯一事实源。
- 内容状态：`draft | generated | needs_review | published | failed`（历史兼容字段保留）。

### 3) SSR（渲染层）
- 首页、列表、详情页由 Node SSR 提供。
- SEO 基础字段输出：title/description/canonical。
- 静态资产从 `STATIC_PUBLIC_DIR` 读取（默认 `./hugo-site/public`）。

### 4) Scheduler（编排层）
- 增量/全量扫描可发布内容。
- 根据质量阈值推进状态到 `published`。
- 内置任务锁、重试、告警与审计日志。

---

## 三、数据模型（当前实现要点）

主表：`seo_articles`
- 关键字段：
  - `slug`（唯一）
  - `title / description / content / tags`
  - `quality_report`
  - `status`
  - `last_error`
  - `prompt_version / model_version / raw_json`

配套表：
- `pipeline_runs`（调度审计）
- `pipeline_locks`（并发锁）
- `alert_logs`（告警记录）
- `producer_trigger_requests`（API 幂等）

---

## 四、任务流（当前）

### 增量流（默认）
1. Producer 生成并写入 SQLite（`generated` / `needs_review` / `failed`）。
2. Scheduler 按质量阈值筛选可发布记录。
3. 推进为 `published`。
4. SSR 页面对外可见。

### 全量流（重处理）
1. 按全量规则扫描历史记录。
2. 重新应用质量阈值与状态推进。
3. 结果由 SSR 即时读取。

---

## 五、运行与验收要点

### 运行关键点
- API 鉴权：`Authorization: Bearer <PRODUCER_API_TOKEN>`
- API 幂等：`x-idempotency-key`
- 预检必须通过：
  - SQLite 表结构
  - Mainroad 静态资源可读（`css/style.css`, `js/menu.js`）

### 交付标准（当前）
1. 结构化内容可入库。
2. 可从 DB 在 SSR 页面展示。
3. 调度可推进状态。
4. 日志与错误记录可观测。
5. 可重复执行且结果稳定。

---

## 六、仍需持续确认的策略项

1. 调度频率（分钟级 / 小时级）
2. 对外发布拓扑（单机 / 反代 / CDN）
3. 内容质量阈值（评分门槛）
4. URL 覆盖与历史版本策略
5. 告警分级与通知渠道

---

## 七、结论

项目已从“DB -> Markdown -> Hugo build”转为“DB -> Node SSR”，并保留 Mainroad 样式资产。  
后续迭代应继续遵循：**SQLite 事实源 + Node SSR + API 触发 + Scheduler 编排**。
