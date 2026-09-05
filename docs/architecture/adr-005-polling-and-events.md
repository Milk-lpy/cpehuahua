# ADR-005：集中轮询与独立事件分析

## Status

Accepted for the current implementation; endpoint-level runtime integration remains
subject to real H168 and Surge validation.

## Context

高铁场景需要把不同频率的读取合并成连续快照，并区分 Cellular 与 Internet。React
组件各自设置 timer 会导致请求重复、时间戳不一致，也会把认证并发问题带进 Surge。

## Options

| 方案 | 优点 | 代价 |
| --- | --- | --- |
| 每个组件自行刷新 | 最快开始 | 重复请求、无法统一时间线、容易并发认证 |
| 一个固定 1 秒请求 | 简单 | 低频 endpoint 被过度读取，无法表达设备差异 |
| 中央调度器 + 独立 EventEngine | 频率集中、可测试、事件与 UI 解耦 | 需要保存最新 endpoint 结果并处理部分失败 |

## Decision

采用 `PollingEngine` 保存每个 endpoint 的 due time，读取串行化，按 endpoint 的
`intervalMs` 调度，并将最新结果交给 Adapter 生成 `CpeSnapshot`。`EventEngine` 只
消费快照，不知道 Huawei XML、HTTP 或 Surge。

当前 PWA 的 `/api/live` 是一个原子快照接口，因此由 `LivePollingSession` 以可配置
间隔集中请求，并在浏览器本地保留最近 60 条快照；当 Surge 暴露端点级读取接口后，
可以直接接入 core `PollingEngine`，不改变 Dashboard 或事件类型。

## Consequences

- Cellular/Internet 状态可以独立进入事件时间线。
- 连续失败/恢复阈值由 `NetworkQualityTracker` 处理，不因一个丢包抖动。
- 事件引擎只在值已存在且发生明确转变时触发；`null` 不会被解释成 0 或 Down。
- 当前未验证的 H168 capability 仍保持 `unknown`，fixture 不会改变能力状态。

## Revisit trigger

实机确认 Surge 请求耗时、限流行为和 `/api/live` 的实际负载后，决定是否切换到端点
级 Bridge 路由或加入缓存/退避；不得仅凭 fixture 调整为“已支持”。
