# E6888-982 接入与验证（2026-11-12）

## 公开实现评估

先搜索 GitHub、相关公开客户端和 Brovi 厂商资料，再核对当前设备网页自身的协议。
没有找到明确列出 E6888-982 实机兼容性的公开源码；通用 Huawei 支持声明不作为本机支持证据。

| 来源 | 许可证、维护与依赖 | 安全与兼容性、采用决定 |
| --- | --- | --- |
| [Salamek/huawei-lte-api](https://github.com/Salamek/huawei-lte-api) | LICENSE 为 LGPL-3.0；有公开提交与维护记录；Python 客户端，requests/xmltodict/pycryptodomex 等依赖 | 接口目录用作交叉核对；含设备写操作，未将其安装进静态前端或复制源码；未声称 E6888 已在其兼容列表 |
| [Salamek/huawei-lte-api-ts](https://github.com/Salamek/huawei-lte-api-ts) | LGPL-3.0；主分支 package 0.1.1，未提供实际测试脚本；依赖 axios 0.25.0、crypto-js、tough-cookie、xml2js 等 | 旧依赖与 Node Cookie 封装不适合直接放入 Surge 单文件；参考接口命名，不引入依赖。未做全量漏洞审计 |
| [yuan-666/cpemanager](https://github.com/yuan-666/cpemanager) | pyproject 0.3.2、Alpha；Python >=3.11，requests >=2.31,<3；公开 release 有 SCRAM/token 修正。检查的根 LICENSE 路径不存在，未确认可复用许可证 | 现有项目认证实现的协议参考；许可证未核实时不复制新增代码。它的 SesTokInfo 优先策略在此 E6888 固件上不能直接沿用 |
| 当前 E6888 自带网页 | 本地 `/js/main.js`、`/lib/emui-crypto.js`；设备固件资源，没有作为第三方组件引入 | 对照其令牌轮转、普通管理员登录字段和 CryptoJS SCRAM 行为，以合成测试向量核对现有项目算法，没有将厂商 JS 打包进应用 |

GitHub API 元数据访问本次返回 403，未声称取得精确最近提交日期。以上引用只用于研究，
此次没有新增第三方生产依赖。复用了本项目已有认证算法、XML parser、H168 通用字段归一化、
轮询引擎、时间线及主题组件，增加 E6888 专属协议分支与实机字段处理。

## 登录差异

- E6888 先建立 SessionID，读取 `/api/webserver/token`，去掉返回值的前 32 个字符。
- `challenge_login` 使用这个 token；认证请求必须接续挑战响应头的轮转 token。
  两步之间再次 GET token 在本次实测中导致认证失败。
- 普通设备网页登录不发送开发者页面的 `loginflag=2`。
- `authentication_login` 成功后的轮转 token 要继续保留给后续请求。
- 密码不会出现在 XML 认证请求中；Cookie 和 token 不写入日志、fixture 或采集报告。

H168 默认认证路径保持不变，E6888 使用独立 profile；已有 H168 认证测试继续覆盖原行为。

## 字段与能力

验证固件 `4.0.0.1(H3568SP91C00)` / Web UI `4.0.0.1(W11SP37C03)`。

- `mode=12`、`workmode=NR-5GC`：SA；不将单载波 5G 自动标为 5G-A。
- `nrearfcn=DL:175380 UL:166380`：主载波 ARFCN 使用显式 DL 值。
- 缺少 `bandInfo` 时，从 `15MHz@175380(N5)` 解析 N5。
- 缺少 `nrrssi` 时 RSSI 保持未知；复合 MCS/TX 表达式保留原文。
- 电量取 `BatteryPercent`，USB 状态取 `usbup`；不由 USB 在线推断正在充电。
- 日/月流量、设备版本和开机时长已读取；设备信息每 60 秒刷新。
- 两个载波/邻区端点登录后返回 100003，默认不轮询；不制造副载波或邻区数据。
- 当前只交付已实测的监控功能；未在设备上执行锁频、重启、短信发送等控制操作。

## 验证与复测

本次分别用项目 `HuaweiAuthMachine(profile: "e6888")` 和独立 `surge/bridge.js` 登录实机。
Bridge 通过浏览器 DOMParser 加回调 HTTP shim 执行原脚本，`/api/live` 成功返回
`adapterId=e6888`、设备版本、电量、USB、N5/175380、信号及流量能力。
此验证覆盖真实 HTTP API 和 Bridge 脚本；尚未声称已在手机 Surge 运行时重新安装并验收。

随后用 390×844 浏览器打开项目登录页，将 Bridge 请求送入上述真实设备链路：
概览成功显示 E6888、N5、175380、电量和 USB 状态，信号连续读取 3 次；
两个不可用端点请求数为 0，无页面错误、无横向溢出，白天/夜间模式截图检查通过，
参数页可见固件版本，网页存储未包含管理密码。100 项单元测试、类型检查与构建通过。

独立临时 Node HTTP 调用也观察到过 125003/100006 会话错误，因此本次交付验收路径
为已有的 PWA + Surge Bridge，没有把临时直连采集程序作为稳定客户端交付。

手机上的实际入口仍为项目已有的登录页和 Surge Module；更新 Bridge 后输入设备密码即可。
不要把密码写进命令历史、代码、URL 或提交内容。

## r3 地址发现修正

用户手机返回的实际错误为默认网关 `192.168.9.1` 上 HTTP 404，但 Safari 可在
`192.168.8.1` 读取 E6888 型号。因此默认路由与管理地址不能视为同一个地址。
r3 在公开型号发现阶段检查默认网关和已知管理地址，确认受支持型号后才登录；
后续读取复用按当前网络记录的管理地址，并隔离不同地址的 Cookie/Token。

回归验证将默认网关响应固定为 404，`192.168.8.1` 使用真实设备，执行原 Bridge
脚本的基础信息、运营商两个 endpoint：均返回 200/ok，gateway 均为 `192.168.8.1`，
错误默认网关只访问一次。跨网络缓存失效和跨地址会话隔离测试也通过；总计 105 项测试。
