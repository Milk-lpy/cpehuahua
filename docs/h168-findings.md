# H168-383 Findings

更新时间：2026-09-07

## 当前结论

```yaml
target_device: H168-383
live_device_tested_in_this_repo: true
all_field_support_claims: false
raw_h168_capture_present: false
```

本文件中的 `reference-claimed` 只表示可靠项目 README/变更记录的声明，
`reference-shape` 只表示其他设备或 mock 里出现过的协议形状；两者都不能替代
用户的 H168-383 实机返回数据。

## 首次用户实机证据（2026-09-07）

用户通过 iPhone Safari → Surge Bridge → H168 Wi-Fi 成功打开：

```text
https://cpe-bridge.example.com/api/probe
```

截图中的 ProbeReport 首个 endpoint 提供了以下可确认事实：

- `adapterId` 为 `h168`
- Surge 发现 IPv4 默认网关 `192.168.8.1`
- `/api/device/basic_information` 返回 HTTP `200`，Probe status 为 `ok`
- `huaweiError` 为 `null`，解析错误为 `null`
- 请求延迟记录为 `81 ms`
- 返回的 `devicename` 为 `H168-383`
- 返回的英文/中文设备名均为 `5G CPE Ultra 6`
- 首个 endpoint 的完整 XML 和 parsed 字段已经通过 Bridge 脱敏返回到浏览器

这确认了：Surge MITM、远程 `bridge.js`、默认网关发现、H168 身份门和
`basic_information` 读取链路已经在用户设备上实际跑通。

这条截图没有包含其余 endpoint 卡片的完整结果，因此暂不据此确认
`signal`、SCell、邻区、流量、登录 token 轮换或任何扩展字段的支持状态。
完整结果仍应使用 Probe 页面的 `Copy Sanitized Result` 逐个提交；不要发送密码、
Session、Token 或未脱敏 RAW XML。

## 第二批用户实机证据（2026-09-07）

用户从 H168-383 读取到以下实际结果。这里记录的是 endpoint、状态和字段证据，
没有把包含网络地址的原始 XML 纳入仓库：

- `/api/device/basic_information`：HTTP `200`、Probe status `ok`、延迟 `23 ms`、
  Huawei error 为空。观察到 `devicename=H168-383`、`spreadname_en=5G CPE Ultra 6`、
  `spreadname_zh=5G CPE Ultra 6`，以及 `classify`、`multimode`、
  `restore_default_status`、`sim_save_pin_enable`。
- `/api/monitoring/status`：HTTP `200`、Probe status `ok`、延迟 `19 ms`、
  Huawei error 为空。实际返回了 `ConnectionStatus`、`CurrentNetworkType`、
  `CurrentNetworkTypeEx`、`CurrentServiceDomain`、`ServiceStatus`、`SignalIcon`、
  `SignalIconNr`、`SimStatus`、`WifiStatus`、`CurrentWifiUser`、`TotalWifiUser`、
  `EndcStatus` 等字段；其中数值代码的含义仍未在 H168-383 上逐项确认，不据此
  推导 Cellular/Internet online 或 RSRP。
- `/api/net/current-plmn`：HTTP `200`、Probe status `ok`、延迟 `36 ms`、
  Huawei error 为空。观察到 `FullName=中国电信`、`ShortName=中国电信`、
  `Numeric=46011`、`Rat=12`、`State=0`；`Rat` 和 `State` 的具体代码含义仍待确认。
- `/api/device/signal`：本次没有读到 H168 响应。Probe 的 transport error 是
  `undefined is not an object (evaluating 'crypto.subtle.importKey')`，说明认证在
  Surge WebView 的 Web Crypto 调用处中止；这不是 H168 返回的 Huawei error，也不能
  作为 signal 字段不支持的证据。

本批证据把前三个 endpoint 的 endpoint-level capability 从 `unknown` 提升为
`observed`，但不提升任何 RSRP、SINR、Band、PCI、Cell ID、CA 或在线状态字段的
supported 结论。加密 fallback 已加入代码并通过离线测试向量；仍需下一次真实 Probe
确认 H168 challenge/authentication 是否成功，以及返回的实际 signal/SCell/neighbor
数据。

## 已知差异

1. 用户指定的 `lvcdy/huawei-lte-api-go` 当前仓库实际上是 Rust crate（`Cargo.toml`
   的 package name 为 `huawei-lte-api`），不是 Go 项目。
2. 该仓库的 `Cargo.toml` 和 README 声明 MIT，但 checkout 的 `LICENSE` 文件是
   LGPL-3.0，许可证状态不一致；本项目不复制其代码。
3. 该仓库 README 明确列出的 H168-383 实测端点包含 `device/signal`、
   `device/information`、`monitoring/status`、`traffic-statistics`、
   `current-plmn`、`basic_information` 等，但没有把 `seccellinfo`/
   `nbrcellinfo` 列入 H168 实测成功清单；后两者目前只能作为待探测的 Brovi
   补充端点。
4. `cpemanager` 的最新登录修复是依据新 Huawei HAR，并在 handoff 中明确写着仍需
   用真实 Huawei 设备验证 `125003` 是否消失；所以本项目不会把该流程写成已实机
   确认。
5. `MarvenAPPS/5g-cpe-signal-monitor` 当前 README 的测试设备是 H155-381、H153-381
   和 D-Link，不是 H168-383；其 MCS/CQI/MIMO/Tx Power 样例不能直接标为 H168 支持。

## 端点证据表

| Endpoint | 来源状态 | 当前处理 |
| --- | --- | --- |
| `/api/device/basic_information` | `live-observed` H168-383 实机 HTTP 200 | Probe 默认读取；已观察设备身份和基础 key，其他值仍以实际响应为准 |
| `/api/monitoring/status` | `live-observed` H168-383 实机 HTTP 200 | Probe 默认读取；保留实际 key，不从状态代码或 `SignalIcon` 猜蜂窝状态 |
| `/api/net/current-plmn` | `live-observed` H168-383 实机 HTTP 200 | Probe 默认读取；保留 `FullName`/`Numeric`/`Rat`/`State` 原始值，代码含义待确认 |
| `/api/device/signal` | `reference-claimed` H168 登录后可读 | Probe 默认读取；字段缺失为 `null` |
| `/api/monitoring/traffic-statistics` | `reference-claimed` H168 登录后可读 | Probe 默认读取；不替代 iPhone 侧 Internet 状态 |
| `/api/device/seccellinfo` | `reference-shape` Brovi 5G 补充端点 | Probe 默认读取但 capability 初始 `unknown` |
| `/api/device/nbrcellinfo` | `reference-shape` Brovi 5G 补充端点 | Probe 默认读取但 capability 初始 `unknown` |
| `/api/webserver/SesTokInfo` | `reference` cpemanager 新登录流程 | 认证状态机优先尝试；必须实机确认 |
| `/api/user/challenge_login` | `reference` cpemanager 新登录流程 | 只实现登录 POST，不作为 Dashboard 数据 |
| `/api/user/authentication_login` | `reference` cpemanager 新登录流程 | 只实现登录 POST，不作为 Dashboard 数据 |
| `/api/developermode/developer-mode` | `reference-shape` lvcdy 补充端点 | 只读候选，结果不标准化 |
| `/api/developermode/developer-item` | `reference-shape` lvcdy 补充端点 | 只读候选，结果不标准化 |
| `/api/app/atport-status` | `reference-shape` lvcdy 补充端点 | 仅 GET 探测，禁止加入任何 POST |
| `/api/device/information` | `reference-claimed` H168 登录后可读 | 作为设备扩展诊断，敏感字段默认脱敏 |

## 字段状态

以下字段在当前仓库没有 H168-383 实机返回证据，因此在 `CpeSnapshot` 中预留但
保持 `null` 或 `unknown`：

```text
temperatureC fanRpm cpuUsagePct memoryUsagePct qci fiveQi dlAmbr ulAmbr
mimoRank cqi dlMcs ulMcs bler txPower
```

`rsrp/rsrq/sinr/rssi/pci/cellId/band/arfcn` 有通用 Huawei/5G 参考形状，Adapter
只在对应响应 key 实际出现时映射；缺失、空字符串和未知格式不会填 0，也不会用
另一个 RAT 的数值代替。`CapabilityMatrix` 只有在 `AdapterInput.source="live"` 时
才会把 endpoint/字段从 `unknown` 改为 `observed`；fixture 测试不会制造能力证据。

## 待实机确认

- H168 当前固件对 `/api/device/seccellinfo`、`/api/device/nbrcellinfo` 的 HTTP 状态、
  Huawei error code、顶层 key 和 CSV 列顺序
- `/api/device/signal` 是否使用标准 `mode`/`nr*` 字段，还是存在 H168/Brovi 专用名称
- `mode=12`（cpemanager 的 SA 参考形状）与 `mode=101/102`（其他实现使用的形状）在
  H168 当前固件上的实际含义，以及 generic `pci`/`cell_id` 是否属于 NR
- `SesTokInfo` 每次调用是否轮换 `SesInfo`/`TokInfo`，以及 Cookie 是否只从响应 body
  设置还是同时通过 `Set-Cookie` 设置
- `challenge_login` 与 `authentication_login` 是否都要求 `loginflag=2`
- 监控 API 是否在蜂窝在线但 Internet 不可达时仍返回成功；InternetOnline 必须由
  iPhone/Surge 侧连续探测判断
- 邻区和 SCell 刷新频率、列表数量和空值约定

收到用户脱敏 Probe 输出后，按 endpoint 逐项更新本表，并保留“原始 key → 标准字段”
的证据；在更新前不扩大 supported 字段集合。
