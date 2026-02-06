---
title: "US Cycle Topics - 项目对话整理（仅项目部分）"
updated: 2026-02-06
source: "整理自历史对话，已移除人生/性格分析内容"
---

# 项目对话整理（技术与落地版）

> 本文只保留项目相关信息，并对可执行架构做细化。
> 已忽略人生、性格、心理分析类内容。

## 一、已确认方向（你的核心要求）

1. **架构分层**：
   - `Genkit` 负责结构化内容生成并入库。
   - `Node` 定时任务从数据库读取新内容/全量内容并生成 Hugo Markdown。
   - 该分层可最大化扩展性与兼容性。

2. **内容生产规范**：
   - 内容生成使用 `Genkit`。
   - Prompt 管理使用 `dotPrompt`。

3. **Hugo 内容生成机制**：
   - 使用 Node 任务连接 `PostgreSQL (PG)`。
   - 支持两种模式：
     - **增量生成**（仅最新变更）
     - **全量重生成**（用于模板变更、批量修复）

4. **构建流程**：
   - Markdown 生成完成后执行 `hugo build`（建议 `hugo --minify`）。

5. **协作方式**：
   - 当前聊天结论以“方向性意见”为主，细节不完整。
   - 后续需要与你进行**多轮次细节确认**再定实现。

---

## 二、建议的分层架构（落地版）

## 1) Content Producer（内容生产层）
- 输入：关键词、城市、主题、模板版本等。
- 执行：Genkit + dotPrompt 生成结构化内容。
- 输出：结构化 JSON 写入 PG。

## 2) Content Store（数据层）
- 数据库：PostgreSQL。
- 存储：结构化字段 + 原始 JSON（用于追溯、重渲染、版本升级）。
- 原则：**数据库是内容唯一事实源（Source of Truth）**。

## 3) Hugo Renderer（渲染层）
- Node 定时任务从 PG 拉取 `new/updated` 内容。
- 将结构化字段映射为 Hugo Front Matter + 正文 Markdown。
- 写入 `content/posts/*.md`。

## 4) Build & Publish（构建发布层）
- 执行 `hugo --minify`。
- 将 `public/` 发布到目标服务器/CDN。

---

## 三、数据模型（建议最小可用版）

可先用一张主表，后续再拆分：

### 表：`seo_articles`
- `id` (uuid, pk)
- `topic` (text)
- `city` (text)
- `slug` (text, unique)
- `title` (text)
- `description` (text)
- `content_md` (text)
- `tags` (jsonb)
- `raw_json` (jsonb)  // Genkit 原始结构化结果
- `prompt_version` (text)
- `model_version` (text)
- `status` (text)  // draft | generated | rendered | built | failed
- `last_error` (text)
- `created_at` (timestamp)
- `updated_at` (timestamp)
- `published_at` (timestamp, nullable)

### 增量索引建议
- `index(status, updated_at)`
- `index(city, topic)`
- `unique(slug)`

---

## 四、dotPrompt 与结构化输出约束

为了兼容后续扩展，建议 Prompt 输出固定结构：

```json
{
  "title": "...",
  "description": "...",
  "slug": "...",
  "tags": ["..."],
  "content": "markdown body...",
  "lastmod": "YYYY-MM-DD"
}
```

约束要点：
- 标题、描述、slug、正文分离。
- Front Matter 字段与正文字段分离。
- slug 稳定且可复现（避免重复生成多 URL）。
- 输出失败必须记录错误，不可静默跳过。

---

## 五、任务流（全量 / 增量）

### A. 增量流（默认）
1. Producer 生成并写入 PG（`status=generated`）。
2. Renderer 拉取 `generated` 或 `updated_at > watermark` 内容。
3. 生成/覆盖对应 `.md` 文件（`status=rendered`）。
4. 执行 Hugo build（成功后 `status=built`）。
5. 发布成功后标记 `published_at`。

### B. 全量流（重建）
1. 按条件筛选（或全部）记录。
2. 清理/重建目标 Markdown 目录。
3. 全量渲染并 build。
4. 发布并写回状态。

---

## 六、Hugo Front Matter 规范（建议）

```yaml
---
title: "..."
date: 2026-02-06
lastmod: 2026-02-06
description: "..."
slug: "..."
tags: ["...", "..."]
categories: ["..."]
draft: false
---
```

说明：
- `date` 与 `lastmod` 分离，便于重渲染场景。
- `slug` 与数据库一致，禁止渲染层二次改写。

---

## 七、Node 定时任务建议

- 调度方式：Cron（如每 15/30 分钟）
- 执行保护：
  - 任务锁（防止并发重入）
  - 重试机制（指数退避）
  - 错误落库（`last_error`）
- 幂等要求：
  - 同一 slug 重复执行结果一致
  - 失败可重跑，不产生重复文件与脏状态

---

## 八、当前共识 vs 待确认

### 已共识
- Hugo + Genkit + PG + Node 定时任务
- 数据与表现层分离
- 支持全量/增量生成
- Markdown 生成后执行 Hugo build

### 待你多轮确认（必须）
1. 调度频率（15 分钟、30 分钟、按小时）
2. 发布方式（本机构建后 rsync / Git push / CI 构建）
3. 内容质量阈值（最小字数、重复度、禁词）
4. 重建策略（是否允许覆盖历史 URL）
5. 失败告警策略（仅日志 / 邮件 / IM 通知）

---

## 九、MVP 实施顺序（建议）

1. 建 PG 表结构（含 status 流转字段）
2. 实现 Genkit + dotPrompt 生成并入库
3. 实现 Node Renderer（PG -> Hugo md）
4. 实现定时任务（增量）
5. 接入 Hugo build + 发布
6. 增加全量重建命令

---

## 十、后续协作约定

你提出方向，我负责把方向转成：
- 明确的数据结构
- 可执行的任务流
- 可回滚、可重跑的工程流程

下一步请你先确认第八部分“待确认”5项，我再基于确认结果给出第一版实施清单（按文件级别拆解）。