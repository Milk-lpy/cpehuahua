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
  Probe 页面 / 展示 view model
          │ 只消费统一 ProbeReport / CpeSnapshot
packages/core
  types      CpeSnapshot、Cell、ProbeResult、Event
  xml        保留 raw 的 Huawei XML parser + error/key extraction
  auth       Cookie/CSRF/SessionID 状态机，最多一次重新认证
  adapters   CpeAdapter → H168Adapter / H155Adapter stub
  probe      端点目录、顺序采集器、脱敏结果
surge
  module + experimental bridge（本地 HTTP、登录、一次性 Probe；轮询后续实现）
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
          EventEngine / PollingEngine（后续阶段）
```

Probe 结果同时保存 `rawXml` 和 `sanitizedRawXml`。UI 默认只显示后者；复制功能只
输出脱敏对象。敏感信息包括密码、SessionID、Cookie、CSRF/Token、IMEI、IMSI、手机号、
MAC 和公网 IPv6。

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
信息和脱敏 trace。密码只作为方法参数参与 PBKDF2/SHA/HMAC，禁止写日志、持久化或
传给远端服务。

新流程优先：`SesTokInfo → challenge_login → 新 token → authentication_login`；
旧 `/api/webserver/token` 只是兼容 fallback。遇到 `125003`/CSRF 失效，实时请求
最多重认证一次，第二次仍失败就报告错误。当前 Bridge 只做一次完整 Probe；实时
请求集中调度会在后续 PollingEngine 阶段接入。

## 采样调度（后续 Phase 5）

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

选择后续由一个 PollingEngine 统一调度和生成 Snapshot，再由独立 EventEngine 消费。
这样可以区分“蜂窝在线”和“Internet 在线”，并可靠计算恢复时长；代价是需要处理
部分 endpoint 失败、旧值保留策略和时间戳一致性。
