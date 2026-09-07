# CPE Huahua 架构（第一轮）

## 目标与约束

- iPhone Safari/PWA 是实时监控入口，H168 本地 API 不能依赖远端 Internet。
- Surge 是本地 HTTP Bridge：发现 `$network.v4.primaryRouter`，保存本地 Session，
  请求 H168，并向浏览器返回统一 JSON。
- V1 只读；禁止锁频、锁小区、改 APN、改 Wi-Fi、重启或任何配置写入。
- H168 是完整实现边界；H155 只有预留 Adapter；前端不得理解 Huawei XML。
- 未验证字段保持 `null`；能力状态分成 `unknown`、`observed`、`unsupported`。

## 分层

```text
apps/web
  Login 页面 → Dashboard / 控制页面
          │ 只消费统一 endpoint result / CpeSnapshot
packages/core
  types      CpeSnapshot、Cell、ProbeResult、Event
  xml        保留 raw 的 Huawei XML parser + error/key extraction
  auth       Cookie/CSRF/SessionID 状态机，最多一次重新认证
  adapters   CpeAdapter → H168Adapter / H155Adapter stub
  probe      端点目录、顺序采集器、脱敏结果
surge
  module + experimental bridge（本地 HTTP、登录、Probe、endpoint、network probe 和 live 回退）
```

## 数据流

```text
H168 XML + HTTP metadata
        │
        ├── rawXml（本地保留，不能上传）
        ├── parsed value / field paths / Huawei error
        └── Adapter normalize（缺失字段 = null）
                    │
             CpeSnapshot + capabilities
                    │
          DevicePollingSession / PollingEngine → EventEngine
```

Probe 结果同时保存 `rawXml` 和 `sanitizedRawXml`。UI 默认只显示后者；复制功能只
输出脱敏对象。H168 的复合 MCS/TX 文本若已被实机观察，会以 `radio.rawEvidence` 进入
规范化快照，但对应的单值数值字段仍保持 `null`。敏感信息包括密码、SessionID、Cookie、
CSRF/Token、IMEI、IMSI、手机号、MAC 和公网 IPv6。

## Adapter 契约

```ts
interface CpeAdapter {
  readonly id: "h168" | "h155";
  readonly probeEndpoints: readonly ProbeEndpoint[];
  identify(input: ParsedHuaweiXml | null): AdapterIdentification;
  normalize(input: AdapterInput): CpeSnapshot;
}
```

`H168Adapter` 负责 H168 的端点目录、可选字段映射和 cell-list 解析；它不把参考
项目中的字段当作无条件事实。`H155Adapter` 在 V1 返回 reserved 状态，未来新增
真实实现不会改变前端或事件输入类型。

## 认证边界

认证状态机内部管理 Cookie 和 token，外部结果只提供是否存在 Session/CSRF 的诊断
信息和脱敏 trace。密码只作为方法参数参与 PBKDF2/SHA/HMAC，不写日志、不传给远端
服务。浏览器只保存“记住密码并自动登录”的布尔偏好；用户显式选择后，密码才由本地
Surge `$persistentStore` 保存，用于自动恢复 H168 会话。

新流程优先：`SesTokInfo → challenge_login → 新 token → authentication_login`；
旧 `/api/webserver/token` 只是兼容 fallback。遇到 `125003`/CSRF 失效，实时请求
最多重认证一次，第二次仍失败就报告错误。请求集中调度由 core `PollingEngine` 和
PWA `DevicePollingSession` 承担。Bridge 提供 `/api/endpoint/<id>` 给端点级调度，同时
保留 `/api/live` 原子快照接口作为兼容性回退。端点级请求是否适合 H168 固件的
Cookie/Token 复用和实际负载，仍需实机验证。

## 采样调度

所有刷新由单一 `PollingEngine` 调度，组件不能各自设置 timer：

| 数据 | 初始建议 |
| --- | ---: |
| signal / SCell / Surge Internet probe / traffic | 1 秒 |
| monitoring/status | 2 秒 |
| neighbor | 3 秒 |
| PLMN | 10 秒 |
| device info | 登录后一次 |

此表是调度建议，不是 H168 字段支持声明。实际设备若返回慢或限流，Engine 需要按
响应耗时和错误码退避。

`packages/core/src/polling` 的 `PollingEngine` 按 endpoint 的 `intervalMs` 保存 due
time、串行读取并把最新结果交给 Adapter。Web 的 `DevicePollingSession` 使用它读取
`/api/endpoint/<id>`，保留最近 60 条快照；`/api/live` 不参与默认调度，仅保留给兼容
客户端和诊断回退。所有 endpoint 仍是只读 allowlist，未知路径不会转发到 H168。

## 关键架构决策

### ADR-001：本地 Bridge 优先

选择 iPhone → Surge → H168 的本地路径，而不是远端服务器代理。这样隧道/弱网时
只要 iPhone 到 H168 的 Wi-Fi 仍在，实时数据仍可读取；代价是 Surge 脚本承担
Cookie/CSRF/认证和本地解析，必须严格限制 MITM 主机和持久化数据。

### ADR-002：Adapter + 统一快照

选择 Adapter 输出统一 `CpeSnapshot`，而不是把 Huawei XML 传到前端。这样 H155
未来可以新增实现，EventEngine 和 UI 不需要重写；代价是新字段必须显式加入映射，
未知字段仍需通过 raw Probe 分析。

### ADR-003：Raw-first 诊断

每次 Probe 保存 HTTP 状态、Huawei error、延迟、原始 XML、解析值和字段路径。选择
保留原始证据是为了应对固件差异；代价是必须默认脱敏、限制本地存储，不能把 raw
响应发送到远端。

### ADR-004：集中轮询与可恢复状态

选择由 PollingEngine/DevicePollingSession 统一调度和生成 Snapshot，再由独立 EventEngine
消费。`NetworkQualityTracker` 使用连续失败/恢复阈值，避免一个丢包造成状态抖动；代价
是需要处理部分 endpoint 失败、旧值保留策略和时间戳一致性。完整用户路径探测目标
仍需真实网络环境确认。
