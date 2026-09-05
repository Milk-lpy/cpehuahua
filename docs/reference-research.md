# 参考项目研究记录

更新时间：2026-09-05

本记录只收集协议、端点、字段和行为依据，不把参考仓库的代码直接复制进
cpehuahua。仓库快照以研究时 checkout 的 commit 为准；GitHub 页面和上游项目会
继续变化，实机数据优先级更高。

## 参考项目与许可证

| 项目 | 研究 commit | 许可证状态 | 对本项目的用途 |
| --- | --- | --- | --- |
| [lvcdy/huawei-lte-api-go](https://github.com/lvcdy/huawei-lte-api-go) | `428d94f95f1205adcccf1f25f80ec61974fa9494` | 仓库 `LICENSE` 文件内容为 LGPL-3.0；但当前 crate 的 `Cargo.toml` 声明 MIT，README 末尾也写 MIT，存在许可证冲突 | 最重要的 H168 相关行为、通用 Huawei API、5G 补充端点和 `125003`/Cookie 线索；只读研究，不复制实现 |
| [yuan-666/cpemanager](https://github.com/yuan-666/cpemanager) | `09f3c5c00d951639b640eec8310e6f0f52738e77` | checkout 中没有发现 `LICENSE` 文件，`pyproject.toml` 也没有声明项目许可证；视为未明确授权复制 | 新登录流程、端点登记、字段/CSV 解析思路；只做 clean reimplementation |
| [MarvenAPPS/5g-cpe-signal-monitor](https://github.com/MarvenAPPS/5g-cpe-signal-monitor)（原链接会重定向） | `036757e0bdbafd52c5646f377520b2fe4c09d184` | GPL-3.0 | 只参考 PCC/SCell/邻区的展示组织和可选字段处理；不复制 GPL 前端或 Python 实现 |
| [Salamek/huawei-lte-api](https://github.com/Salamek/huawei-lte-api) | `f416c63d2a01d7e1d743a2d039ae2d1ff6b71df5` | LGPL-3.0 | 通用 HiLink API、旧版 Session/CSRF、错误码和 XML 体系 |
| [Salamek/huawei-lte-api-ts](https://github.com/Salamek/huawei-lte-api-ts) | `24c2f9b1eaaaf07644db644acda8eee54f0e5b08` | LGPL-3.0（`package.json` 与 `LICENSE`） | 仅参考 TypeScript API 分组和旧版浏览器实现；它没有 H168 新登录验证 |

## H168 相关端点证据

### 上游明确声称在 H168-383 上实测的端点

`lvcdy/huawei-lte-api-go` README 的 H168 段落声称以下端点在 H168-383 上成功：

- 未登录：`/api/device/basic_information`、`/api/monitoring/status`、
  `/api/monitoring/check-notifications`、`/api/user/state-login`、
  `/api/net/current-plmn`
- 登录后：`/api/device/information`、`/api/device/signal`、
  `/api/monitoring/traffic-statistics`，以及 `monitoring`、`system`、`wlan`、
  `net` 等组中的若干只读端点
- README 同时记录 `device/signal` 和 `device/information` 在未登录时会返回需要登录
  的错误

这是“上游声明”，不是本项目对用户设备的验证。README 的 H168 实测清单没有把
`/api/device/seccellinfo` 和 `/api/device/nbrcellinfo` 单独列为 H168 实测成功；这
两个端点在同一仓库中作为 Brovi 5G 补充端点存在。因此本项目把它们列为 Probe
候选，直到 H168 实机返回成功后才把 capability 标为 `observed`。

### cpemanager 的端点和字段线索

`cpemanager` 当前端点登记包含：

```text
/api/net/current-plmn
/api/device/nbrcellinfo
/api/device/seccellinfo
/api/device/signal
/api/monitoring/traffic-statistics
/api/monitoring/status
/api/device/basic_information
/api/webserver/token
/api/webserver/SesTokInfo
/api/user/challenge_login
/api/user/authentication_login
```

其 `seccellinfo`/`nbrcellinfo` 解析器把响应中的以下字符串当作逗号和分号分隔的
cell list：

- SCell：`nrseccell_list`、`lteseccell_list`，参考顺序为
  `ARFCN,Band,BW,PCI,RSRP,RSRQ,RSSI,SINR`
- Neighbor：`nbrcell_nrlist`、`nbrcell_ltelist`，参考顺序为
  `ARFCN,Band,PCI,RSRP,RSRQ,RSSI,SINR`

这些是解析协议的参考形状，不等于 H168-383 固件一定返回相同字段。Probe 必须
保留完整 raw XML 和未过滤的 parsed keys。

`cpemanager` 的 API reference 还记录了 `device/signal` 的常见字段，例如
`nrrsrp`/`nrrsrq`/`nrsinr`、`nrearfcn`、`nrrank`、`nrcqi0`、`nrdlmcs`、
`nrulmcs`、`nrbler`、`nrtxpower`，并给出 `mode=12` 的 SA 参考响应，其中 generic
`pci`、`cell_id`、`bandInfo` 代表 NR。它是字段映射和兼容性输入，不是本项目的
H168 实机证据；H168 Adapter 只在实际 response key 出现时读取，仍保留 unknown/null
边界。

## 登录流程研究结论

参考项目之间存在版本差异，不能简单拼接：

1. `Salamek/huawei-lte-api`、`huawei-lte-api-ts` 和当前
   `lvcdy/huawei-lte-api-go` 源码主要展示旧的 `/api/user/login` 路径，使用
   `password_type`、CSRF 派生 SHA-256 密码，有些设备再使用 RSA 公钥。
2. `cpemanager` 的最新变更记录专门说明：新 Huawei HAR 优先使用
   `/api/webserver/SesTokInfo`，并为 `challenge_login` 和
   `authentication_login` 分别获取 token，以规避 `challenge_login` 的
   `125003`。
3. `cpemanager` 当前实现的只读/认证顺序为：

   ```text
   初始页面或状态请求
     → GET /api/webserver/SesTokInfo
     → 保存响应中的 SesInfo 为 SessionID、TokInfo 为 CSRF token
     → POST /api/user/challenge_login
          username + firstnonce + mode=1 + loginflag=2
     → 解析 salt、iterations、servernonce
     → 重新获取 token
     → PBKDF2-HMAC-SHA256(password, salt, iterations)
          → cpemanager-specific HMAC Client Key / Stored Key / signature / clientproof
     → POST /api/user/authentication_login
          clientproof + finalnonce + loginflag=2
     → 保留 SessionID Cookie 和新 token
   ```

4. 如果 `SesTokInfo` 不可用，cpemanager 保留旧 `/api/webserver/token` fallback。
   本项目状态机也保留这个 fallback，但不会把 fallback 成功等同于 H168 已验证。
5. `125003` 被当作 Session/Token 绑定错误处理。实时 API 请求最多触发一次重新认证，
   不允许无限登录循环。

注意：cpemanager 当前 `compute_client_proof` 的 HMAC 参数顺序不是常见 SCRAM 教科书
顺序：`HMAC(key="Client Key", message=saltedPassword)`，随后
`HMAC(key=firstNonce,serverNonce,serverNonce, message=storedKey)`。本项目按该源码
顺序实现并用固定向量测试；这仍不是 H168-383 实机登录成功证明。

Phase 2 的状态机按第 2-4 点实现测试基础，未声称已在 H168-383 上成功；真实设备
仍需用 Probe 验证 token rotation、Cookie 作用域和登录返回形状。

## Surge 约束与依据

Surge 官方文档：

- [JavaScript API](https://manual.nssurge.com/scripting/api.html)：提供
  `$network.v4.primaryRouter`、`$httpClient`、`$persistentStore`，并说明请求体/响应体
  和 Cookie 处理边界。
- [HTTP Request Script](https://manual.nssurge.com/scripting/http-request.html)：
  `http-request` 可以通过 `$done({ response: { status, headers, body } })` 直接返回
  mock response，无需访问远端；HTTPS 请求需要对匹配主机启用 MITM。
- [HTTPS Decryption (MITM)](https://manual.nssurge.com/http/mitm.html)：MITM 只对
  `[MITM] hostname` 中声明的主机生效，可使用专用 Bridge 域名。

因此 cpehuahua 不让浏览器直连 `192.168.x.x`，也不依赖 Surge JavaScript 的 raw TCP
能力。TCP 20249 / Telnet / AT 只作为未来 Mac Agent 扩展，不进入 V1 主流程。

## 许可证与实现边界

- cpehuahua 采用独立实现：只保留端点名称、公开协议事实、字段语义和测试输入形状。
- 不复制 `5g-cpe-signal-monitor` 的 GPL-3.0 UI/代码。
- `cpemanager` 未声明许可证，禁止直接复制其实现。
- `huawei-lte-api-go` 的 LGPL/MIT 元数据冲突需要上游澄清；本项目不复制其代码。
- 若未来需要链接或分发第三方库，必须在集成前重新核对版本许可证和 NOTICE 要求。
