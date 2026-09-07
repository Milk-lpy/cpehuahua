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

## 第三批用户实机证据（2026-09-07）

用户通过“一键复制本次全部”提供了完整的 H168-383 ProbeReport。本节只记录不含设备
唯一标识和网络地址的字段形状；没有把用户粘贴的原始 XML 写入仓库。

这次结果确认：

- `device-signal`、`device-seccellinfo`、`device-nbrcellinfo`、
  `monitoring-traffic-statistics`、`device-information` 均返回 HTTP `200` 且
  Huawei error 为空；之前的 `crypto.subtle.importKey` 失败已经不再出现。
- 认证后的 endpoint 可以连续读取，说明当前 Surge WebView 的纯 JavaScript 加密
  fallback 与 H168 当前登录流程在这次设备上完成了可用验证；但 Session/Token
  轮换细节仍未单独验证。
- `/api/device/signal` 返回 `mode=12`，同时返回通用 `pci`、`cell_id`、`tac`、
  `bandInfo`、`nrearfcn` 和 NR 测量字段。该样本中 `bandInfo=N78`，并观察到
  `nrsrp=-70dBm`、`nrrsrq=-11.0dB`、`nrsinr=5dB`、`nrrssi=-47dBm`、
  `nrcqi0=15`、`nrrank=4`、`nrbler=0`。这些是本机样本事实，不代表所有位置或
  所有 H168 固件都会返回同样数值。
- 同一 signal 响应还返回 `nrulbandwidth`、`nrdlbandwidth`、`nrulmcs`、
  `nrdlmcs`、`nrtxpower`、`rrc_status` 和 `ims`。其中 MCS 与 TX power 是包含
  carrier/channel 描述的复合字符串，当前不能安全压成单个数值；原始字段保留，
  标准化数值仍保持 `null`。
- 其中 `nrdlbandwidth` 在本次样本中为 `100MHz`，标准化为 `radio.bandwidth` 及
  PCC 的 `bandwidth` 文本；这不推断上行带宽，也不把文本转换成数值。`rrc_status`
  标准化为 `radio.rrcStatus` 和 PCC 的原始字符串；数值 `1` 的固件语义尚未确认，
  因此 UI 只标记为“原始状态”，不解码成已连接/空闲等结论。
- `/api/device/seccellinfo` 返回一个 `nrseccell_list` 记录，`lteseccell_list`
  为空；本次确认其 H168 形状为 `ARFCN,Band,BW,PCI,RSRP,RSRQ,RSSI,SINR`。
- `/api/device/nbrcellinfo` 返回六个 NR 邻区记录，`nbrcell_ltelist` 为空；本次
  确认其形状为 `ARFCN,Band,PCI,RSRP,RSRQ,RSSI,SINR`，并保留 `N77/N78` 这类原始
  频段字符串，不替换成单一频段。
- `/api/monitoring/traffic-statistics` 返回当前连接时间、累计流量和当前上下行速率。
  当前速率单位仍需在更多实测中与用户路径吞吐量交叉确认，Bridge 的 `*8` 转换暂为
  可撤销的参考实现。
- `/api/device/information` 返回 `DeviceName=H168-383`、软件版本
  `4.4.0.1(H1008SP7C233)`、WebUI/参数版本和 `uptime=144` 等字段。设备序列号、
  ICCID、MAC、WAN IP 和 IPv6 只作为存在性证据，不在文档中记录原值。
- `/api/developermode/developer-mode`、`developer-item` 和 `/api/app/atport-status`
  均返回 HTTP `200`、Huawei error `100003`；这只能说明当前账号/固件对这些只读
  候选请求返回明确拒绝，不能推导温度、风扇或 AT 能力。
- `/api/net/cell-info` 返回 HTTP `200` 并包含 `cellinfo`、`lac`，但仍按 candidate
  endpoint 处理，不能替代 signal 的标准化来源。

本次用户输出也暴露了旧版脱敏规则的覆盖缺口：`SerialNumber`、`Iccid`、带后缀的
`MacAddress*`、`WifiMacAddr*`、`WanIPAddress` 和 `WanIPv6Address` 不能只靠旧的精确
key 集合识别。已在 core sanitizer 和 Surge bridge 同步增加这些标签/地址模式的脱敏，
并加入测试；升级 Module 后再收集的 Probe 才是可外发的脱敏结果。

## 第四批用户实机证据（2026-09-07）

用户在升级脱敏规则和 PWA 后再次提供完整 ProbeReport。本节只记录第二组动态样本的
结构和非敏感事实，不写入 Cell ID、TAC 原值、设备序列号、ICCID、MAC 或 WAN 地址。

这次结果确认：

- `device-basic-information`、`monitoring-status`、`net-current-plmn`、`device-signal`、
  `device-seccellinfo`、`device-nbrcellinfo`、`monitoring-traffic-statistics`、
  `device-information`、`SesTokInfo` 和 `state-login` 均返回 HTTP `200`；认证相关
  endpoint 继续可用，没有再次出现 `crypto.subtle.importKey` 传输错误。
- `device-signal` 再次返回 `mode=12`、`bandInfo=N78`、NR `100MHz` 和 `nrearfcn`，
  并继续返回 NR RSRP/RSRQ/SINR/RSSI、CQI、Rank、BLER、RRC、MCS 复合字符串和 TX
  power 复合字符串。第二组样本的 PCI、Cell ID、TAC、RSRP、SINR、CQI、Rank 等与
  第三批不同，确认这些字段不是被前端或 fixture 写死的动态值。
- `device-seccellinfo` 再次返回 1 条 `nrseccell_list` 记录、空的 LTE 列表。该记录的
  ARFCN、频段和 PCI 与当前 PCC 样本高度接近；当前只按设备原始列表保留，不去重，
  也不把它强行解释成“独立 SCell”，需要在切换/多载波样本中确认 endpoint 语义。
- `device-nbrcellinfo` 本次返回 9 条 NR 邻区、空的 LTE 列表，记录格式仍为
  `ARFCN,Band,PCI,RSRP,RSRQ,RSSI,SINR`。邻区数量与第三批不同，动态数组处理得到
  了实际验证。
- `monitoring-status` 的整体字段集合与前一轮一致；`CurrentWifiUser` 等运行时值会
  变化。`ConnectionStatus`、`ServiceStatus`、`CurrentNetworkType` 等数值代码仍不
  在没有官方语义/多样本结论时转换为布尔在线状态。
- `current-plmn` 继续返回中国电信、`Numeric=46011`、`Rat=12`、`State=0` 的同一
  结构；代码语义仍保持未确认。
- `monitoring-traffic-statistics` 继续返回当前/累计流量和上下行速率，速率单位仍需
  用用户路径测试交叉确认，规范化层不因第二组样本改变现有可撤销的 `*8` 参考转换。
- 本次 `device-information` 中序列号、ICCID、IMEI/IMSI、MAC、WAN IPv4/IPv6 等值在
  Probe 输出中均已被 `[REDACTED]` 替换，说明新版 core sanitizer、Surge bridge 和
  前端二次脱敏共同生效。软件版本、WebUI/参数版本和 uptime 仍作为非敏感设备信息
  保留。
- Developer mode、developer item、AT port status 仍返回 HTTP `200` + Huawei
  `100003`；这些候选能力继续保持拒绝/未支持状态，不提升温度、风扇或 AT 的支持结论。

这批结果使“第二组动态 H168 样本”和“多邻区动态数组”进入证据记录，但仍不代表所有
H168 固件、网络制式或多载波场景都具备相同字段。Event Engine 后续可以使用这些真实
样本验证 `PCI_CHANGED`、`CELL_CHANGED`、`LOW_SINR` 等事件，但不能从两次样本臆造
切换持续时间或 Internet outage。

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
6. 两组 H168 实机样本的 `seccellinfo` 都返回 1 条 NR 记录，且该记录与 PCC 的关键
   标识接近；在确认其真实语义前，前端应显示“设备报告的 SCell 列表”，不要自动去重
   或把数量解释为独立载波数量。

## 端点证据表

| Endpoint | 来源状态 | 当前处理 |
| --- | --- | --- |
| `/api/device/basic_information` | `live-observed` H168-383 实机 HTTP 200 | Probe 默认读取；已观察设备身份和基础 key，其他值仍以实际响应为准 |
| `/api/monitoring/status` | `live-observed` H168-383 实机 HTTP 200 | Probe 默认读取；保留实际 key，不从状态代码或 `SignalIcon` 猜蜂窝状态 |
| `/api/net/current-plmn` | `live-observed` H168-383 实机 HTTP 200 | Probe 默认读取；保留 `FullName`/`Numeric`/`Rat`/`State` 原始值，代码含义待确认 |
| `/api/device/signal` | `live-observed` H168-383 实机 HTTP 200 | 已观察 `mode=12`、通用 PCI/Cell/TAC、NR 测量和复合 MCS/TX 字段；复合值不压成单值 |
| `/api/monitoring/traffic-statistics` | `live-observed` H168-383 实机 HTTP 200 | 已观察当前/累计流量和速率；单位与用户路径吞吐仍待交叉确认 |
| `/api/device/seccellinfo` | `live-observed` H168-383 实机 HTTP 200 | 已观察一个 NR SCell 记录和空 LTE 列表，继续保留动态数组 |
| `/api/device/nbrcellinfo` | `live-observed` H168-383 实机 HTTP 200 | 已观察六个 NR 邻区记录和空 LTE 列表，继续保留动态数组 |
| `/api/webserver/SesTokInfo` | `live-observed` H168-383 实机 HTTP 200 | 本次返回成功；Cookie/Token 轮换细节仍待专门验证 |
| `/api/user/challenge_login` | `reference` cpemanager 新登录流程 | 只实现登录 POST，不作为 Dashboard 数据 |
| `/api/user/authentication_login` | `reference` cpemanager 新登录流程 | 只实现登录 POST，不作为 Dashboard 数据 |
| `/api/developermode/developer-mode` | `live-observed` H168-383 HTTP 200 + Huawei `100003` | 当前账号/固件拒绝；只读候选，结果不标准化 |
| `/api/developermode/developer-item` | `live-observed` H168-383 HTTP 200 + Huawei `100003` | 当前账号/固件拒绝；只读候选，结果不标准化 |
| `/api/app/atport-status` | `live-observed` H168-383 HTTP 200 + Huawei `100003` | 当前账号/固件拒绝；仅 GET 探测，禁止加入任何 POST |
| `/api/device/information` | `live-observed` H168-383 实机 HTTP 200 | 已观察设备/软件/运行时间字段；敏感字段只保留脱敏值 |
| `/api/user/state-login` | `live-observed` H168-383 实机 HTTP 200 | 已观察登录状态响应字段；不把账号状态码猜成在线状态 |
| `/api/net/cell-info` | `live-observed` H168-383 实机 HTTP 200 | 已观察 `cellinfo`/`lac`，仍按 candidate 处理 |

## 字段状态

以下字段在这次 H168-383 实机返回中仍没有可用读取证据，因此在 `CpeSnapshot` 中预留但
保持 `null` 或 `unknown`：

```text
temperatureC fanRpm cpuUsagePct memoryUsagePct qci fiveQi dlAmbr ulAmbr
```

以下字段已经在本次 `/api/device/signal` 返回中出现，并允许在 live Adapter 中标记为
`observed`：

```text
rsrp rsrq sinr rssi pci cellId tac band arfcn cqi mimoRank bler
```

`dlMcs`、`ulMcs`、`txPower` 的原始 key 也已观察到，但 H168 返回的是复合字符串而不是
单个数值。为避免伪造“主载波”或丢掉其他 carrier/channel，当前标准数值字段仍为
`null`，完整字符串在 Probe 的 parsed/raw 证据和 live 快照的 `radio.rawEvidence` 中
保留；Dashboard 只将其标为设备原始字段，不将其当作单一数值。

```text
nrulbandwidth nrdlbandwidth rrc_status nrulmcs nrdlmcs nrtxpower
```

本次样本中的 `nrdlbandwidth=100MHz` 已进入 `radio.bandwidth` 和小区详情；
`rrc_status` 已进入 `radio.rrcStatus`，但仍按原始字符串展示，未加入未经确认的
状态码解释。

`CapabilityMatrix` 只有在 `AdapterInput.source="live"` 时才会把 endpoint/字段从
`unknown` 改为 `observed`；fixture 测试不会制造能力证据。

## 待实机确认

- `mode=12` 与 `workmode=NR-5GC` 在更多 H168 样本中的对应关系，以及 mode 变化时
  generic `pci`/`cell_id`/`tac` 是否始终属于 NR
- 复合 `nrulmcs`/`nrdlmcs`/`nrtxpower` 的 carrier/channel 语法，以及是否应扩展
  标准模型为结构化数组而不是单个数值
- `/api/monitoring/traffic-statistics` 的速率单位与 iPhone/Surge 用户路径吞吐量的
  交叉验证
- `SesTokInfo` 每次调用是否轮换 `SesInfo`/`TokInfo`，以及 Cookie 是否只从响应 body
  设置还是同时通过 `Set-Cookie` 设置
- `challenge_login` 与 `authentication_login` 是否都要求 `loginflag=2`
- 监控 API 是否在蜂窝在线但 Internet 不可达时仍返回成功；InternetOnline 必须由
  iPhone/Surge 侧连续探测判断
- `ConnectionStatus=901`、`ServiceStatus=2`、`CurrentNetworkType=20`、`Rat=12` 等
  数值代码的官方/多样本语义；在此之前 CellularOnline 继续保持 `null`
- 邻区和 SCell 在切换、LTE-only、NSA 和多载波场景下的列表数量与空值约定
- `nrseccell_list` 与 PCC 的关系：当前两组样本都出现相近的单条记录，需用明确 CA
  场景确认是否为 PCC 镜像、当前辅载波或设备端的统一 cell 列表

收到用户脱敏 Probe 输出后，按 endpoint 逐项更新本表，并保留“原始 key → 标准字段”
的证据；在更新前不扩大 supported 字段集合。
