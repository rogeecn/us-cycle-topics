# TODO Plan — SQLite + Node SSR + Mainroad 1:1（核心页）

> 状态：**待你确认后开始开发**  
> 分支（已约定，未创建）：`feature/sqlite-node-ssr-mainroad`

## 0. 约束与目标

### 已确认需求
1. 数据库改为 SQLite。
2. 后端 Node.js 服务端渲染（SSR）；前端仅静态资源，不引入 Vue/CSR 渲染机制。
3. 将 `npm run producer` 集成为 API，可通过定时请求触发。
4. 主题按 Hugo Mainroad 做 **核心页 1:1**（首页/列表/详情/分页/SEO meta）。
5. 先评估并确认，再在新功能分支开发。
6. 开发计划需落地到文件管理。
7. 采用 TDD 开发模式。

### 开发暂停点（必须遵守）
- 在你明确回复“开始开发”前，不进行功能实现改动（仅保留本 TODO 文件）。

---

## 1. TDD 执行规约（全程）

每个功能项按 **Red → Green → Refactor** 执行：

- **Red**：先写失败测试（单元/集成），明确输入输出与边界。
- **Green**：只写最小实现使测试通过，不夹带重构。
- **Refactor**：在测试保护下做小幅整理，保持行为不变。

质量门禁（每个子任务完成都要过）：
- 测试通过（新增与既有相关测试）。
- `npm run typecheck` 通过。
- 关键路径日志与错误处理可观测。

---

## 2. 里程碑 TODO（文件化追踪）

## P0 — 基础切换（SQLite + 测试底座）
- [x] P0-1 建立测试基线（确定测试框架、测试脚本、最小示例）。
- [x] P0-2 数据访问层从 `pg` 迁移到 SQLite（连接、事务、锁、仓储接口保持语义一致）。
- [x] P0-3 迁移脚本改为 SQLite 版本（含 schema_migrations 与索引）。
- [x] P0-4 preflight/bootstrap 改造为 SQLite 检查流程。
- [x] P0-5 为 repository 核心状态流转补齐测试（generated/published/failed）。

## P1 — Node SSR 运行时替换（保留内容生产链路）
- [x] P1-1 新增 Node SSR 服务骨架（路由、模板渲染、静态资源托管）。
- [x] P1-2 实现核心页 1:1：首页/列表页/详情页/分页。
- [x] P1-3 对齐 Mainroad 核心结构与 SEO meta（title/description/canonical/open graph 基本项）。
- [ ] P1-4 渲染查询与缓存策略（列表与详情读路径）。
- [x] P1-5 SSR 路由层测试（状态码、分页、slug 命中/未命中）。

## P2 — Producer API 化 + 调度触发改造
- [ ] P2-1 新增 `POST /api/producer/run`（支持手动参数与自动输入两种模式）。
- [ ] P2-2 增加接口鉴权与幂等保护（防重复触发）。
- [ ] P2-3 将原命令触发路径改为可复用服务调用（CLI 仅保留兼容壳或下线）。
- [ ] P2-4 增加 API 集成测试（成功、参数错误、重复触发、失败回滚）。
- [ ] P2-5 更新运行文档与运维触发说明（crontab/curl 示例）。

---

## 3. 验收标准（DoD）

- [ ] SQLite 成为唯一运行数据库。
- [ ] SSR 核心页达到 Mainroad 视觉与信息结构 1:1（核心范围内）。
- [ ] Producer 可通过 API 触发，不依赖手工命令执行。
- [ ] 全部新增测试通过，且类型检查通过。
- [ ] 变更在新分支完成并可演示。

---

## 4. 风险与前置提醒

- SQLite 适合单实例优先上线；若未来多实例并发写入，需要额外锁策略或再迁移到 PostgreSQL。
- “核心页 1:1”不包含全站边角页；若扩大到全站，排期会明显增加。

---

## 5. 执行开关

- 当前：`PAUSED (waiting_for_confirmation)`
- 触发词：你回复 **“开始开发”** 后，我再创建分支并按本文件执行。
