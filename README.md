# us-cycle-topics

基于 `Genkit + dotPrompt + PostgreSQL + Hugo + Node Scheduler` 的内容生产流水线。

该项目遵循根目录 `AGENTS.md` 约束：
- PG 作为唯一事实源（Source of Truth）
- 支持增量/全量渲染
- 生成后必须执行 Hugo build
- 调度任务具备锁、重试、错误落库、可观测日志

---

## 1. 架构总览

流水线分四层：

1. **Producer** (`apps/producer`)
   - 使用 Genkit + dotPrompt 生成结构化内容
   - 结构化校验后写入 PG
   - 入库记录 `prompt_version / model_version / raw_json`

2. **Store** (`PostgreSQL`)
   - 内容权威来源
   - 状态流转：`draft -> generated -> rendered -> built -> published`，失败为 `failed`

3. **Renderer** (`apps/renderer`)
   - 从 PG 拉取增量/全量内容
   - 生成 `hugo-site/content/posts/*.md`
   - 执行 `hugo build --minify`

4. **Scheduler/Publish** (`apps/scheduler`)
   - cron 定时调度
   - advisory lock 防并发重入
   - 重试/告警/发布（rsync，支持 dry-run）

---

## 2. 目录结构

```text
apps/
  common/
  producer/
  renderer/
  scheduler/
db/
  migrations/
docs/
hugo-site/
scripts/
AGENTS.md
README.md
docker-compose.yml
```

---

## 3. 环境要求

- Node.js 20+
- npm
- PostgreSQL 16+（或 Docker）
- Hugo
- rsync（发布用）

如果你本机 Docker 需要 sudo（你当前场景）：
- 使用 `sudo docker compose ...` 启停容器

---

## 4. 安装与初始化

1) 安装依赖

```bash
npm install
```

2) 配置环境变量

```bash
cp .env.example .env
```

3) 启动 PG

### 普通权限可用时
```bash
npm run pg:up
```

### 需要 sudo 时
```bash
sudo docker compose up -d postgres
```

4) Bootstrap（preflight + migrate）

```bash
npm run bootstrap
```

---

## 5. 常用命令

### 数据库

```bash
npm run migrate
npm run bootstrap
npm run pg:up
npm run pg:down
```

> 若需 sudo：手动改为 `sudo docker compose ...`

### 生产/渲染/调度

```bash
npm run producer # 默认由 AI 自动生成 topic/city/keyword
npm run producer -- --topic "Scrap Forklift" --city "Houston" --keyword "forklift scrap value houston"
npm run eval:run -- --dataset=scripts/eval-dataset.json
npm run renderer -- --mode=incremental
npm run pipeline -- --mode=incremental
npm run pipeline -- --mode=full
npm run scheduler
npm run review -- list --limit 20
npm run review -- stats
npm run review -- approve --id 123 --reviewer alice --notes "checked and approved"
npm run review -- reject --id 124 --reviewer alice --notes "needs rewrite"
```

### 诊断与验证

```bash
npm run preflight
npm run doctor
npm run typecheck
npm run build
```

### 发布相关

```bash
npm run publish:dry-run
```

### 一键冒烟

```bash
npm run smoke
```

### Prompt 评估集回归（Starter）

```bash
npm run eval:run -- --dataset=scripts/eval-dataset.json
```

---

## 6. 一键 Smoke 流程说明

`scripts/smoke.sh` 执行顺序：
1. preflight
2. migrate
3. 注入样例数据（`seed:sample`）
4. pipeline 增量执行（强制 rsync dry-run）

样例数据注入命令：

```bash
npm run seed:sample -- --count=3
```

也可用环境变量控制：

```bash
SMOKE_SEED_COUNT=5 npm run seed:sample
```

---

## 7. 关键环境变量

以 `.env.example` 为准，核心项如下：

- `DATABASE_URL`
- `GENKIT_MODEL`
- `GENKIT_BASEURL`（可选，用于 OpenAI-compatible base URL；启用后默认 provider 名为 `compat`）
- `GENKIT_PROMPT_VERSION`
- `PRODUCER_AUTO_INPUT_PROMPT_NAME`
- `PRODUCER_OUTLINE_PROMPT_NAME`
- `PRODUCER_PROMPT_NAME`
- `QUALITY_MIN_SCORE`
- `NEEDS_REVIEW_ALERT_THRESHOLD`
- `HUGO_CONTENT_DIR`
- `HUGO_COMMAND`
- `HUGO_BUILD_ARGS`
- `HUGO_WORKDIR`
- `HUGO_PUBLIC_DIR`
- `SCHEDULER_CRON`
- `PREFLIGHT_ON_RUN`
- `PREFLIGHT_ENSURE_HUGO_SCAFFOLD`
- `PUBLISH_METHOD` (`rsync` / `none`)
- `RSYNC_TARGET`
- `RSYNC_FLAGS`
- `RSYNC_DRY_RUN`
- `SMOKE_SEED_COUNT`
- `ALERT_WEBHOOK_URL`

模型路由规则：
- `GENKIT_MODEL` 必须显式包含 provider 前缀（例如 `googleai/gemini-2.5-flash`、`compat/gpt-4o-mini`）。
- Genkit 会按模型名前缀路由到对应 provider。
- 当设置 `GENKIT_BASEURL` 时，会额外注册 `compat` provider（`@genkit-ai/compat-oai`）。
- 若未设置 `GENKIT_BASEURL`，则仅注册 `googleai` provider。

### 配置模板（可直接复制）

#### Google GenAI（默认）

```env
GENKIT_MODEL=googleai/gemini-2.5-flash
GENKIT_BASEURL=
```

#### OpenAI-compatible（自定义 baseURL）

```env
GENKIT_BASEURL=https://your-openai-compatible-endpoint/v1
GENKIT_MODEL=compat/gpt-4o-mini
OPENAI_API_KEY=your_api_key_here
```

---

## 8. 发布状态与职责边界

- Renderer 只负责到 `built`
- Scheduler 在发布成功后推进 `published`
- `RSYNC_DRY_RUN=true` 时不会推进 `published`
- `QUALITY_MIN_SCORE` 以下但接近阈值的文章会进入 `needs_review`，需人工审核后回到 `generated` 或进入 `failed`
- 当 `needs_review` 队列数量超过 `NEEDS_REVIEW_ALERT_THRESHOLD` 时，scheduler 会触发告警并写入 `alert_logs`

这样保证了 Build/Publish 分层清晰，符合 `AGENTS.md` 约束。

---

## 9. 常见问题

### Q1: doctor 提示 DB 连接失败（ECONNREFUSED）
通常是 PostgreSQL 未启动，或端口/地址不对。

- 启动 PG（sudo 场景）：
```bash
sudo docker compose up -d postgres
```
- 再执行：
```bash
npm run doctor
```

### Q2: preflight 报 rsync 相关失败
- 若暂时不发布，设 `PUBLISH_METHOD=none`
- 若要发布，确保 `RSYNC_TARGET` 正确且可访问

### Q3: Hugo 目录不存在
已支持 scaffold 自动创建，确保 `PREFLIGHT_ENSURE_HUGO_SCAFFOLD=true`。

---

## 10. 开发规范

本项目实现和后续改造必须遵循：

- `AGENTS.md`（强约束，优先级最高）
- 小步迭代
- 修 bug 不夹带无关重构
- 关键策略变更需先确认
