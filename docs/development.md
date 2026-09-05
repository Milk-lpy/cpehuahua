# Development Guide

## 当前阶段

仓库现在已完成设备无关的 Phase 0-7 基础：研究、核心模型、解析/认证、Probe、集中
调度、网络质量、事件引擎，以及 Dashboard/PWA 壳。没有 H168-383
实机数据，不得把 fixture 或其他型号 mock 当作 H168 支持证据。

## 常用命令

```bash
npm install
npm test
npm run typecheck
npm run build
npm run lint
```

## 目录规则

- `packages/core` 放协议无 UI 的类型、解析、认证、Adapter 和 Probe 逻辑。
- `packages/core/src/polling` 放集中 endpoint 调度；`packages/core/src/network` 放
  用户路径质量窗口与 Internet 迟滞；`packages/core/src/event-engine` 只消费快照。
- `apps/web` 只消费统一结构，不直接解析 XML。
- `apps/web/src/live` 维护 `/api/live` 的本地历史与事件；`apps/web/src/dashboard`
  只负责展示，不自行请求 Huawei。
- `fixtures/h168/` 只能提交脱敏且带来源说明的 fixture。
- 真实响应先保存在被 `.gitignore` 忽略的 `fixtures/h168/live/`，分析完再生成脱敏
  fixture；不修改、重命名或删除原始抓包。
- `surge/` 中只允许读取类请求；登录所需的 `challenge_login`/
  `authentication_login` POST 只用于认证，不得加入配置写端点。

## 当前未完成边界

- H168-383 实机端点、字段、登录 Token 轮换和限流行为尚未在本仓库验证。
- Bridge `/api/live` 当前每次返回一个完整快照；端点级 1/2/3/10 秒节流需要实机后
  决定，不能只按 fixture 宣称完成。
- Internet 质量指标的稳定探测目标尚未确定；因此 `internetOnline`、Ping、Loss、
  Jitter 在 Bridge 规范化快照中仍可能为 `null`。

## 提交粒度

推荐使用：`docs:`、`test:`、`feat:`、`fix:`、`refactor:`。每个关键阶段完成后
运行测试、typecheck、build，并检查 `git diff` 是否包含无关文件。
