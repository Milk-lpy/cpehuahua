# Surge Module 安装与 H168 实时监控

当前 `surge/bridge.js` 是本地有界 Bridge：它会发现 IPv4 默认网关、先读取
`basic_information` 确认 H168-383，再读取公开和认证 endpoint。`/api/probe` 返回
脱敏 `ProbeReport`，`/api/endpoint/<id>` 返回一个脱敏 endpoint 结果，`/api/network-probe`
返回一次 Surge 用户路径样本，`/api/live` 返回单次脱敏 `CpeLiveReport`。真实固件、
Cookie/Token 轮换和字段含义仍需用户设备验证；默认连续刷新由 PWA 的
`DevicePollingSession`/`PollingEngine` 负责。`/api/control` 只接受代码内固定白名单，
每次控制前重新确认默认网关仍是 H168-383；网页不能传入任意设备路径或 XML。

## 安装前提

- iPhone 已连接 H168-383 Wi-Fi。
- Surge 已安装并能正常接管该 Wi-Fi 的 HTTP 请求。
- 直接导入 GitHub 上的 Module：
  `https://raw.githubusercontent.com/Milk-lpy/cpehuahua/refs/heads/main/surge/cpehuahua.sgmodule`。
  Module 会通过 `script-path` 自动下载并缓存 GitHub 上的
  `surge/bridge.js`，不需要再单独导入脚本文件。
- 第一次启用 Module 或脚本更新时需要临时能够访问 GitHub；下载成功后 Surge 使用本地
  缓存的脚本，H168 Wi-Fi 断 Internet 但 iPhone 仍能连接 CPE 时，Bridge 仍可继续运行。
- 当前 Module 每 86400 秒检查一次远程脚本。修改 GitHub 上的 `bridge.js` 后，可在 Surge
  中手动更新 Module；如果需要固定版本，把 `script-path` 中的 `main` 替换为具体 commit
  SHA，并同步固定 Module 版本。
- 当前脚本 URL 带有版本查询参数，用于避免 Surge/网络缓存继续使用旧脚本。网页来源或
  Bridge 逻辑更新后，请在手机 Surge 中手动更新一次 Module，再重新打开网页。
- 只为 Bridge 域名启用 MITM。示例使用 `cpe-bridge.example.com`；如果改成自己的
  专用域名，必须同时修改 Module 的 `[Script]` pattern、`[MITM] hostname` 和网页
  中的 Bridge URL。不要把大量无关域名加入 MITM。
- 前端可通过 GitHub Pages 打开：
  `https://milk-lpy.github.io/cpehuahua/`；它的 HTTPS origin
  `https://milk-lpy.github.io` 已写入 `bridge.js` 的 `ALLOWED_WEB_ORIGINS`。
  本地开发仍允许 `http://localhost:4173`。如果将来网页使用其他域名，必须只添加那个
  确切的 HTTPS origin，不要改成任意来源。

## 用户操作

1. 确认 Surge Module 已启用，并确认 Safari 的 Bridge URL 是专用 HTTPS URL。
2. 打开 CPE Huahua 登录界面，输入 H168 管理密码；用户名仍由 Bridge 使用 `admin`，
   不需要输入 URL。
3. 认证成功后会直接进入概览，并自动启动按 endpoint 周期运行的实时抓取。
   管理密码错误、Bridge 不可达或设备未确认时，错误会显示在登录界面。
4. 需要自动登录时勾选“记住密码并自动登录”。网页只保存这个偏好开关；原始密码、
   Session/Cookie/CSRF 只在 Surge 的本地持久存储中保存，不写入浏览器存储，也不发送
   到远端服务。
5. 进入概览后，控制、锁频、设备和短信继续使用同一认证会话；实时抓取可在顶部暂停或
   重新启动。诊断 endpoint 仍由 Bridge 内部提供，不作为主界面入口。

密码通过 POST body 发往专用 Bridge URL，由匹配的 Surge `http-request` script
在本地拦截；它不会被 Bridge 转发到远端服务器。若 Surge 没有启用或 pattern/MITM
配置错误，先不要提交密码。

## 失败时记录什么

- 页面显示“未发现默认网关”：确认仍连接 H168 Wi-Fi，并检查 Surge 是否接管请求。
- `basic_information` 失败：记录 HTTP 状态、页面错误和脱敏结果；不要继续猜测 IP。
- 登录失败或 endpoint 返回 `125003`：记录登录界面错误和 Surge 日志中的错误码。
  不要反复快速提交密码，以免触发设备登录限制。
- 运行时数据 endpoint 返回 `100003`：更新 Module 后重试；Bridge 只会在本次请求明确带有
  密码时对这类数据端点自动重建一次认证，持续的 `100003` 仍按设备权限/固件差异保留，
  不能改成空数据。
- Developer/AT 候选 endpoint，或运行时 endpoint 在一次重认证后仍返回
  404/`100002`/`100003`：这属于能力/权限证据，不能改成 `0` 或用其他指标代替；
  把结果发回后再更新 `docs/h168-findings.md`。

Bridge 的持久化状态使用 Surge 的 `$persistentStore`：实时登录默认复用本地
Session/Cookie/CSRF；勾选“记住密码并自动登录”后才保存密码。二者独立。V1 不
使用 TCP 20249、Telnet 或 AT。短信正文/号码和控制页终端 IP/MAC 只在当前页面内存中
展示，不写入浏览器快照；重启、断网、删除短信和锁频均要求二次确认。

实时 1/2/3/10 秒集中轮询、最近 60 个快照和事件时间线的设备无关骨架已经存在，但
Internet 侧连续探测目标尚未确定，所以 InternetOnline、Ping、Loss、Jitter 仍可能为
`null`。这不代表 H168 已支持这些字段。
