# us-cycle-topics

基于 **Genkit + dotPrompt + SQLite + Node SSR + Scheduler** 的内容生产流水线。

## 当前架构（已去除 Hugo 功能实现）

- 结构化内容由 Producer 生成并写入 SQLite（唯一事实源）
- Node SSR 从数据库读取并渲染页面
- Producer 通过 HTTP API 触发，不再依赖手工命令
- 保留 Mainroad 主题样式资产（静态文件），但**不再保留 Hugo 渲染/构建/发布功能实现**

---

## 1. 分层说明

1. **Producer** (`apps/producer`)
   - Genkit + dotPrompt 生成结构化内容
   - 入库并完成质量门控（`generated / needs_review / failed`）

2. **Store** (`SQLite`)
   - 唯一事实源

3. **SSR Web** (`apps/ssr`)
   - 服务端渲染首页/详情页
   - 静态资源目录由 `STATIC_PUBLIC_DIR` 提供（默认 `./hugo-site/public`）
   - 暴露 `POST /api/producer/run`

4. **Scheduler** (`apps/scheduler`)
   - 定时执行 pipeline
   - 按质量阈值筛选并推进状态为 `published`
   - 任务锁、告警、预检

---

## 2. 目录结构

```text
apps/
  common/
  producer/
  scheduler/
  ssr/
db/
  migrations/
docs/
hugo-site/        # 仅保留 Mainroad 样式静态资源
scripts/
```

---

## 3. 环境要求

- Node.js 20+
- npm
- SQLite（`better-sqlite3`）

> 无需 Hugo 运行时依赖。

---

## 4. 安装与启动

```bash
npm install
cp .env.example .env
npm run bootstrap
npm run ssr
```

默认访问：`http://localhost:3000`

---

## 5. 常用命令

### 基础

```bash
npm run migrate
npm run bootstrap
npm run preflight
npm run doctor
npm run typecheck
npm test
```

### 内容生产

```bash
npm run producer
npm run producer -- --topic "Scrap Forklift" --city "Houston" --keyword "forklift scrap value houston"
npm run eval:run -- --dataset=scripts/eval-dataset.json
npm run seed:sample -- --count=3
```

### 运行与调度

```bash
npm run ssr
npm run pipeline -- --mode=incremental
npm run pipeline -- --mode=full
npm run scheduler
```

---

## 6. Producer API

### Endpoint

`POST /api/producer/run`

### Headers

- `Authorization: Bearer <PRODUCER_API_TOKEN>`
- `x-idempotency-key: <unique-key>`

### Body

```json
{
  "topic": "Industrial Scrap Metal Recycling",
  "city": "Chicago",
  "keyword": "industrial scrap metal recycling chicago",
  "language": "en"
}
```

`topic/city/keyword` 必填。

### curl 示例

```bash
curl -X POST "http://localhost:3000/api/producer/run" \
  -H "Authorization: Bearer dev-producer-token" \
  -H "x-idempotency-key: run-20260209-001" \
  -H "Content-Type: application/json" \
  -d '{
    "topic": "Industrial Scrap Metal Recycling",
    "city": "Chicago",
    "keyword": "industrial scrap metal recycling chicago"
  }'
```

---

## 7. 核心环境变量

以 `.env.example` 为准：

### 数据库与服务
- `SQLITE_DB_PATH`
- `SITE_BASE_URL`
- `STATIC_PUBLIC_DIR`
- `PRODUCER_API_TOKEN`
- `PRODUCER_REQUEST_IDEMPOTENCY_TTL_SECONDS`

### Genkit / Prompt
- `GENKIT_BASEURL`
- `GENKIT_PROMPT_VERSION`
- `PRODUCER_AUTO_INPUT_PROMPT_NAME`
- `PRODUCER_OUTLINE_PROMPT_NAME`
- `PRODUCER_PROMPT_NAME`

### 质量与调度
- `QUALITY_MIN_SCORE`
- `QUALITY_SOFT_REVIEW_THRESHOLD`
- `PRODUCER_MAX_REVISIONS`
- `NEEDS_REVIEW_ALERT_THRESHOLD`
- `SCHEDULER_CRON`
- `PREFLIGHT_ON_RUN`
- `RENDER_BATCH_SIZE`
- `RETRY_MAX_ATTEMPTS`
- `RETRY_BACKOFF_MS`
- `MAX_RENDER_LOCK_SECONDS`

### 告警
- `ALERT_WEBHOOK_URL`
- `ALERT_DAILY_HOUR_LOCAL`
- `ALERT_TIMEZONE`

---

## 8. 状态语义

- 内容生产后进入：`generated / needs_review / failed`
- Pipeline 负责将满足质量阈值的内容推进为 `published`
- `published` 为 SSR 对外可见状态

---

## 9. 验证

```bash
npm test
npm run typecheck
```

---

## 10. 常见问题

### Q1: Producer API 返回 401
检查 `Authorization` 与 `PRODUCER_API_TOKEN` 是否一致。

### Q2: Producer API 返回 400 missing x-idempotency-key
必须传 `x-idempotency-key`。

### Q3: preflight 失败
先执行：

```bash
npm run migrate
```

若仍失败，检查 `STATIC_PUBLIC_DIR` 下是否存在：
- `css/style.css`
- `js/menu.js`

---

## 11. 说明

`hugo-site/public` 仅作为 Mainroad 静态样式资源目录使用，不承载 Hugo 构建流程。
