# ADR-006：端点级 Bridge 调度与本地快照

## 状态

已接受，等待 H168-383 实机验证。

## 背景

`/api/live` 每次请求会触发一组完整的 Huawei 读取。它适合作为 Probe 后的原子回退，
但不适合作为长期 1 秒轮询的唯一实现：邻区、PLMN 和登录后一次的设备信息不应和
Signal 使用相同频率请求。

## 决策

- Surge 只暴露 `/api/endpoint/<id>`、`/api/probe` 和 `/api/live` 三类专用路径。
- endpoint id 必须来自 Bridge 内部只读 allowlist；未知 id 直接返回 404，不拼接任意
  用户输入的 H168 URL。
- Web 由一个 `DevicePollingSession` 持有 core `PollingEngine`，按 endpoint 的
  `intervalMs` 调度，并把最新结果交给 Adapter，再交给 `EventEngine`。
- H168 登录只通过 Bridge 进行。`Remember Session` 开启时，端点请求之间复用 Surge
  本地的 Cookie/CSRF；Session 失效时，客户端最多额外用内存中的密码重试一次。
- `/api/live` 保留为兼容客户端和实机诊断回退，不是默认 Dashboard 调度路径。
- 浏览器只在 `localStorage` 保存有界的规范化快照、历史和事件，不保存密码、Session、
  Token 或 RAW XML。

## 取舍与未决事项

- 端点级调度减少了无必要读取，但跨多个 Surge script 执行复用 Session 的行为必须在
  真实 H168 固件上确认；默认安装建议开启 `Remember Session`。
- 端点响应仍需顺序读取，避免 Cookie/Token 并发竞态。后续只有在实机确认限流和脚本
  运行时行为后，才考虑安全的并行化。
- Internet 侧 Ping/HTTP 探测尚未选定稳定目标，因此网络质量字段继续允许为 `null`。
