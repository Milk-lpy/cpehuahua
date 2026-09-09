# H168-383 Findings

更新时间：2026-09-09

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

## 第五批实时错误证据（2026-09-07）

用户在 Dashboard 实时轮询时看到 `/api/device/seccellinfo` 返回 HTTP `200` + Huawei
`100003`，而该端点此前在 Probe 中成功返回过 NR 列表。这个差异不能直接证明 SCell
能力消失：Huawei 的 `100003` 既可能是请求权限/会话问题，也可能是当前固件对端点的
拒绝。Bridge 现仅在请求明确带密码时对运行时数据端点最多执行一次密码重认证；若重
认证后仍为 `100003`，继续原样报告错误，不把 SCell 列表伪造成空数组，也不对
Developer/AT 候选端点进行同样的循环重试。

## 第六批只读功能证据（2026-09-07 07:09）

新 Probe 首次确认了四个候选 GET 端点：月流量返回月下载、月上传、月/日使用时长、
当日用量和上次清零日期；WLAN host list 返回 2 个在线终端及名称、类型、频段、SSID
和接入时长；通知与短信计数返回收件箱 2、未读 0、容量 500 和存储未满。地址字段已被
脱敏，规范化后保持 `null`，Dashboard 不保存 IP/MAC。

同一报告中 `/api/monitoring/status` 在首次登录前返回 Huawei `125002`，但后续认证端点
均成功，证明该固件上的状态接口需要已绑定会话。端点清单现将它标记为认证读取，使
Probe/实时轮询在读取状态前完成登录；会话过期仍只进行一次密码支持的恢复，不循环重试。

## 第七批网络与终端控制读取证据（2026-09-07 12:55）

新 Probe 确认 `/api/net/net-mode` 返回 `NetworkMode=00`、`networkOption=2`、
`NetworkBand`、`LTEBand` 和 `LTEBandOption`，但没有返回 `NRBand`。因此 H168 的 5G
锁频不再复用通用 `NRBand` 字段，而改为先探测 `/api/net/lock-freq`；只有该 GET 成功
时 UI 才开放 LTE/NR Band 写入。`/api/net/net-mode-list` 同时确认模式 `00/08/03`，
以及 LTE B1/B3/B5/B7/B8/B20/B28/B32/B38/B40/B41/B42/B43/B71。

`/api/dialup/mobile-dataswitch` 返回 `dataswitch=1`，把移动数据读取提升为实机观察；
写入仍要求用户确认且必须重新读取状态。`/api/wlan/multi-macfilter-settings-ex` 返回
13 个 SSID 索引、空黑白名单和 `enable=0`。旧的单项 `/api/wlan/mac-filter` 写入口已
移除，改为读取 SSID 索引与当前黑名单后再向 `multi-macfilter-settings` 写回，并提供
解除黑名单；未取得 `/api/wlan/multi-basic-settings` 的名称到索引映射时不开放按钮。

13:41 的后续 Probe 已确认 `/api/net/lock-freq` 可读，LTE 与 NR 的 `lock_mode` 均为
`0`，表示采样时没有锁频。`/config/network/bandfreqlist.xml` 同时给出了这台设备用于
锁频的真实支持清单：LTE B1/B3/B5/B7/B8/B20/B28/B38/B40/B41/B42/B43/B71，NR
N1/N3/N5/N7/N8/N20/N28/N38/N40/N41/N71/N77/N78/N79。虽然 `net-mode-list` 的 LTE
掩码名称还包含 B32，但 B32 不在锁频配置清单内，因此只把它视为网络模式掩码能力，
不在锁频选择器中展示。
控制桥在 POST 前会再次读取这份能力清单；请求中若含设备未声明的 Band，会在本地拒绝，
不会把该 XML 发给路由器。

同批报告还确认 `/api/wlan/multi-basic-settings` 中在线 SSID `super_5GHz_1` 对应索引
`6`；过滤读取返回 `wifimacfilterstatus=2`（黑名单模式）、`enable=0` 且各索引列表为空。
终端控制现在可以用设备返回的 SSID 名称精确映射索引，不再猜测。以上均为 GET 读取
证据，`lock-freq` 和终端黑名单 POST 仍需用户实际操作后的回读验证。

本批还观察到两个 N78 100 MHz 载波（NRARFCN 627264 与 633984）。解析器保留两条
记录，即使 Band 与 PCI 相同也不按单一 N78 去重。脱敏器此前把
`wifimacfilterstatus`、`wifimacblacklist`、`wifimacwhitelist` 误判为 MAC 地址字段，
现只保留这些状态/容器，同时继续脱敏其中实际的 `WifiMacFilterMacN`。
本次导出还暴露了 Cell ID/TAC/LAC 的位置隐私风险；新版导出会一并脱敏这些字段，
本地实时标准化仍使用设备原始值，不影响切换检测。

## 第八批界面与控制边界整理（2026-09-09）

根据用户提供的九张移动端界面截图，生产界面已整理为概览、控制、锁频、参数、短信、
设置六个主页面，并保留独立的“设备日志”详情页。登录页把“记住密码”和“自动登录”
拆成两个独立选项；只有成功认证后才进入概览并启动实时轮询。Probe 页面继续从生产
导航隐藏，但 `/api/probe` 诊断接口仍保留，便于后续补充脱敏实机证据。

本轮只把已有 H168 读取证据或通用 Huawei 协议中可以安全回读的操作接入控制层：移动
数据、网络模式、LTE/NR Band 锁定与自动解锁、网络重连、流量清零、短信、终端黑名单、
设备重启，以及“先 GET、保留 `ui_download`、POST 后再 GET”的自动升级开关。自动
模式下锁频 UI 会清空并禁用 Band 勾选，避免把界面残留选项误认为设备已锁定。

新增的 WLAN、VPN、LED、定时重启、双 WAN 和高级 WLAN 候选均先做只读能力探测；
没有 H168 安全写入形状时保持只读或不可用。尤其 `/api/timerule/timerule` 在旧 Huawei
WebUI 中属于上网/家长控制时间规则，不能作为定时重启接口，因此已从定时重启候选和
重认证白名单中移除；定时重启只探测 `/api/diagnosis/time_reboot`。当前开发主机无法
直连用户的 H168，所以上述 POST 仍必须由用户升级 Surge Module 后在 iPhone 本地逐项
操作，并以设备回读结果判定成功，仓库不把 host fixture 或 UI 成功提示算作实机验证。

首页载波卡的 SCC 只来自 `/api/device/seccellinfo`；`/api/device/nbrcellinfo` 只进入
锁频页的邻区列表，不会替代或补造 SCC。设备日志可记录轮询样本间的状态、Cell ID、
PCI 和信号变化；单次 Probe 的 endpoint 延迟不是 CPE 切网时长，1 秒信号轮询最多只能
给出约 1 秒粒度的切换时间区间。

## 已知差异

1. 用户指定的 `lvcdy/huawei-lte-api-go` 当前仓库实际上是 Rust crate（`Cargo.toml`
   的 package name 为 `huawei-lte-api`），不是 Go 项目。
2. 该仓库的 `Cargo.toml` 和 README 声明 MIT，但 checkout 的 `LICENSE` 文件是
   LGPL-3.0，许可证状态不一致；本项目不复制其代码。
3. 该仓库 README 明确列出的 H168-383 实测端点包含 `device/signal`、
   `device/information`、`monitoring/status`、`traffic-statistics`、
   `current-plmn`、`basic_information` 等，但没有把 `seccellinfo`/
   `nbrcellinfo` 列入 H168 实测成功清单；不过本项目随后已从用户设备取得两者的
   成功响应，因此上游清单只作为历史差异，不再限制本项目的 `live-observed` 状态。
4. `cpemanager` 的最新登录修复是依据新 Huawei HAR，并在 handoff 中明确写着仍需
   用真实 Huawei 设备验证 `125003` 是否消失；所以本项目不会把该流程写成已实机
   确认。
5. `MarvenAPPS/5g-cpe-signal-monitor` 当前 README 的测试设备是 H155-381、H153-381
   和 D-Link，不是 H168-383；其 MCS/CQI/MIMO/Tx Power 样例不能直接标为 H168 支持。
6. 较早两组 H168 样本的 `seccellinfo` 各返回 1 条 NR 记录，最新样本返回
   NRARFCN 627264 与 633984 两条 N78 记录。原始 SCell 数组按设备响应完整保留，
   不根据 PCC、Band 或 PCI 自行去重，也不把邻区补成 SCC。

## 端点证据表

| Endpoint | 来源状态 | 当前处理 |
| --- | --- | --- |
| `/api/device/basic_information` | `live-observed` H168-383 实机 HTTP 200 | Probe 默认读取；已观察设备身份和基础 key，其他值仍以实际响应为准 |
| `/api/monitoring/status` | `live-observed` H168-383 实机 HTTP 200 | Probe 默认读取；`ConnectionStatus=901` 依据多份 HiLink 实现映射为已连接，其他未知/过渡代码仍保持 null |
| `/api/net/current-plmn` | `live-observed` H168-383 实机 HTTP 200 | Probe 默认读取；保留 `FullName`/`Numeric`/`Rat`/`State` 原始值，代码含义待确认 |
| `/api/device/signal` | `live-observed` H168-383 实机 HTTP 200 | 已观察 `mode=12`、通用 PCI/Cell/TAC、NR 测量和复合 MCS/TX 字段；复合值不压成单值 |
| `/api/monitoring/traffic-statistics` | `live-observed` H168-383 实机 HTTP 200 | 已观察当前/累计流量和速率；单位与用户路径吞吐仍待交叉确认 |
| `/api/device/seccellinfo` | `live-observed` H168-383 实机 HTTP 200 | 已观察 1 条与 2 条 NR SCell 的动态样本及空 LTE 列表；按设备响应完整保留 |
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
| `/api/monitoring/month_statistics` | `live-observed` H168-383 实机 HTTP 200 | 已标准化月/日流量、使用时长和清零日期；60 秒只读轮询 |
| `/api/wlan/host-list` | `live-observed` H168-383 实机 HTTP 200 | 已标准化在线终端名称/类型/频段/SSID/时长；IP/MAC 脱敏后为 null |
| `/api/monitoring/check-notifications` | `live-observed` H168-383 实机 HTTP 200 | 已标准化未读和存储已满状态；10 秒只读轮询 |
| `/api/sms/sms-count` | `live-observed` H168-383 实机 HTTP 200 | 已标准化邮箱计数/容量；短信内容操作进入待实机回读的有界控制层 |
| `/api/net/net-mode` | `live-observed` H168-383 实机 HTTP 200 | 已观察模式、LTE 掩码和 networkOption；该固件不返回 NRBand |
| `/api/net/net-mode-list` | `live-observed` H168-383 实机 HTTP 200 | 已观察模式 00/08/03 和设备支持的 LTE Band 集合 |
| `/api/dialup/mobile-dataswitch` | `live-observed` H168-383 实机 HTTP 200 | 已观察移动数据读取状态；写入仍待用户操作后的回读证据 |
| `/api/wlan/multi-macfilter-settings-ex` | `live-observed` H168-383 实机 HTTP 200 | 已观察 13 个 SSID 索引、空黑白名单和 enable=0；写入尚未验证 |
| `/api/net/lock-freq` | `live-observed` H168-383 实机 HTTP 200 | 已确认 LTE/NR lock_mode=0；写入仍需操作后的回读证据 |
| `/config/network/bandfreqlist.xml` | `live-observed` H168-383 实机 HTTP 200 | 锁频选择器采用设备返回的 LTE/NR support band list；不把仅出现在模式掩码中的 B32 当作可锁频能力 |
| `/api/wlan/multi-basic-settings` | `live-observed` H168-383 实机 HTTP 200 | 已确认在线 SSID `super_5GHz_1` 映射到索引 6，用于终端过滤写入目标 |

## 有界控制阶段（待实机回读）

2026-09-07 起新增严格白名单 `/api/control`。协议形状参考持续维护的 HiLink 实现，
但以下写入尚未收到这台 H168-383 的成功响应和读回证据，因此 UI 会原样显示 Huawei
错误，不把“请求已发出”冒充成“设置已生效”：

| 功能 | Endpoint | 当前证据 |
| --- | --- | --- |
| 短信列表/发送/已读/删除 | `/api/sms/sms-list`、`send-sms`、`set-read`、`delete-sms` | HiLink 参考形状；H168 仅 `sms-count` 已实测 |
| 移动数据 | `/api/dialup/mobile-dataswitch` | H168 GET 已实测；POST 后仍需回读 |
| 网络模式和 Band | `/api/net/net-mode`、`/api/net/lock-freq` | 两个 GET 均已实测；lock-freq POST 仍待操作回读 |
| 终端断网/恢复 | `/api/wlan/multi-basic-settings`、`multi-macfilter-settings-ex`、`multi-macfilter-settings` | SSID 索引和过滤 GET 已实测；按索引保留现有黑名单并提供撤销，POST 待回读 |
| 设备重启 | `/api/device/control` + `Control=1` | 多个 HiLink 实现一致，当前 H168 未验证 |
| 网络重连 | `/api/net/reconnect` + `ReconnectAction=1` | 通用 Huawei 参考形状；连接中断后无法用同一请求证明链路恢复 |
| 流量清零 | `/api/monitoring/clear-traffic` + `ClearTraffic=1` | 旧 Huawei WebUI 参考形状；POST 后读取当前/月流量，不把读取成功等同于计数一定归零 |
| 自动升级 | `/api/online-update/autoupdate-config` | 仅当 GET 成功时开放；保留 `ui_download` 并在 POST 后回读 `auto_update` |

没有开放任意 endpoint/XML 透传，也没有开放恢复出厂、升级、关机、AT/开发者模式。
终端限速和重命名、锁 PCI/锁小区、完整 WLAN/APN 控制需要新的 H168 实机读取证据。

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
- `ServiceStatus=2`、`CurrentNetworkType=20`、`Rat=12` 等其余数值代码的官方/多样本
  语义；未确认代码不参与在线状态推断
- 邻区和 SCell 在切换、LTE-only、NSA 和多载波场景下的列表数量与空值约定
- `nrseccell_list` 与 PCC 的关系：当前两组样本都出现相近的单条记录，需用明确 CA
  场景确认是否为 PCC 镜像、当前辅载波或设备端的统一 cell 列表

收到用户脱敏 Probe 输出后，按 endpoint 逐项更新本表，并保留“原始 key → 标准字段”
的证据；在更新前不扩大 supported 字段集合。
