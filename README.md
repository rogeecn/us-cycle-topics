# us-cycle-topics

基于 **Genkit + dotPrompt + SQLite + Node SSR + Scheduler** 的内容生产流水线。

当前主链路：
- 结构化内容由 Producer 生成并写入 SQLite（唯一事实源）
- Node SSR 从数据库读取并渲染页面
- 前端仅静态资源（复用 Mainroad 样式），不使用 Vue/CSR
- Producer 通过 HTTP API 触发，不再依赖手工执行命令

---

## 1. 架构总览

流水线分层：

1. **Producer** (`apps/producer`)
   - 使用 Genkit + dotPrompt 生成结构化内容
   - 写入 SQLite
   - 入库记录 `prompt_version / model_version / raw_json`
   - 质量门控后进入 `generated / needs_review / failed`

2. **Store** (`SQLite`)
   - 作为唯一事实源
   - 状态流转：`draft -> generated -> rendered -> built -> published`（失败为 `failed`）

3. **SSR Web** (`apps/ssr`)
   - 首页/详情页服务端渲染
   - 主列表分页渲染
   - 暴露 `POST /api/producer/run` 触发生产

4. **Scheduler/Pipeline** (`apps/scheduler`)
   - 定时调度 pipeline
   - 任务锁防并发重入
   - 告警/发布（rsync，支持 dry-run）

5. **Renderer** (`apps/renderer`)
   - 仍保留 DB->Markdown->Hugo 构建链路代码用于兼容阶段
   - 当前对外主访问路径是 Node SSR

---

## 2. 目录结构

```text
apps/
  common/
  producer/
  renderer/
  scheduler/
  ssr/
db/
  migrations/
docs/
hugo-site/
scripts/
AGENTS.md
README.md
```

---

## 3. 环境要求

- Node.js 20+
- npm
- SQLite（由 `better-sqlite3` 驱动，无需单独服务）
- Hugo（用于保留兼容链路与静态资源）
- rsync（若启用发布）

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

3) 运行 bootstrap（preflight + migrate）

```bash
npm run bootstrap
```

4) 启动 SSR 服务

```bash
npm run ssr
```

默认地址：`http://localhost:3000`

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

### Producer / 评估

```bash
npm run producer
npm run producer -- --topic "Scrap Forklift" --city "Houston" --keyword "forklift scrap value houston"
npm run eval:run -- --dataset=scripts/eval-dataset.json
npm run seed:sample -- --count=3
```

### SSR / Pipeline / 调度

```bash
npm run ssr
npm run pipeline -- --mode=incremental
npm run pipeline -- --mode=full
npm run scheduler
```

### 发布

```bash
npm run publish:dry-run
```

---

## 6. Producer API（替代手工命令触发）

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

## 7. 关键环境变量

以 `.env.example` 为准，核心项如下：

### 数据库与服务
- `SQLITE_DB_PATH`
- `SITE_BASE_URL`
- `PRODUCER_API_TOKEN`
- `PRODUCER_REQUEST_IDEMPOTENCY_TTL_SECONDS`

### Genkit / Prompt
- `GENKIT_BASEURL`
- `GENKIT_PROMPT_VERSION`
- `PRODUCER_AUTO_INPUT_PROMPT_NAME`
- `PRODUCER_OUTLINE_PROMPT_NAME`
- `PRODUCER_PROMPT_NAME`

### 质量门控
- `QUALITY_MIN_SCORE`
- `QUALITY_SOFT_REVIEW_THRESHOLD`
- `PRODUCER_MAX_REVISIONS`
- `NEEDS_REVIEW_ALERT_THRESHOLD`

### 调度与发布
- `SCHEDULER_CRON`
- `PREFLIGHT_ON_RUN`
- `PREFLIGHT_ENSURE_HUGO_SCAFFOLD`
- `RETRY_MAX_ATTEMPTS`
- `RETRY_BACKOFF_MS`
- `MAX_RENDER_LOCK_SECONDS`
- `PUBLISH_METHOD` (`rsync` / `none`)
- `RSYNC_TARGET`
- `RSYNC_FLAGS`
- `RSYNC_DRY_RUN`

### 兼容参数（保留）
- `HUGO_CONTENT_DIR`
- `HUGO_COMMAND`
- `HUGO_BUILD_ARGS`
- `HUGO_WORKDIR`
- `HUGO_PUBLIC_DIR`
- `HUGO_THEME`

---

## 8. 状态与发布语义

- 内容生产后先进入质量分层：`generated / needs_review / failed`
- `rendered` / `built` / `published` 由 pipeline 与发布逻辑推进
- 仅当 `PUBLISH_METHOD=rsync` 且 `RSYNC_DRY_RUN=false` 时推进 `published`

---

## 9. 测试与验证

```bash
npm test
npm run typecheck
```

当前已覆盖：
- repository 状态流转
- SSR 数据路由基础
- producer API 鉴权与参数校验

---

## 10. 常见问题

### Q1: Producer API 返回 401
检查 `Authorization` 是否与 `PRODUCER_API_TOKEN` 一致。

### Q2: Producer API 返回 400 missing x-idempotency-key
必须传 `x-idempotency-key`，用于幂等去重。

### Q3: preflight 报表缺失
先执行：

```bash
npm run migrate
```

或直接：

```bash
npm run bootstrap
```

### Q4: 页面样式异常
确认 `hugo-site/public/css/style.css` 与 `hugo-site/public/js/menu.js` 存在。

---

## 11. 开发规范

- 遵循根目录 `AGENTS.md`
- 小步迭代
- 修 bug 不夹带无关重构
- 关键策略变更先确认
