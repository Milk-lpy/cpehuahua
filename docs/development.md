# Development Guide

## 当前阶段

仓库现在是 Phase 0-3 基础骨架和 Phase 4 的一次性 Bridge 原型。没有 H168-383
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
- `apps/web` 只消费统一结构，不直接解析 XML。
- `fixtures/h168/` 只能提交脱敏且带来源说明的 fixture。
- 真实响应先保存在被 `.gitignore` 忽略的 `fixtures/h168/live/`，分析完再生成脱敏
  fixture；不修改、重命名或删除原始抓包。
- `surge/` 中只允许读取类请求；登录所需的 `challenge_login`/
  `authentication_login` POST 只用于认证，不得加入配置写端点。

## 提交粒度

推荐使用：`docs:`、`test:`、`feat:`、`fix:`、`refactor:`。每个关键阶段完成后
运行测试、typecheck、build，并检查 `git diff` 是否包含无关文件。
