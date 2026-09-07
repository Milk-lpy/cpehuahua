# Surge Module 安装与 H168 实机 Probe

当前 `surge/bridge.js` 是实验性的只读 Bridge：它会发现 IPv4 默认网关、先读取
`basic_information` 确认 H168-383，再读取公开和认证 endpoint。`/api/probe` 返回
脱敏 `ProbeReport`，`/api/endpoint/<id>` 返回一个脱敏 endpoint 结果，`/api/network-probe`
返回一次 Surge 用户路径样本，`/api/live` 返回单次脱敏 `CpeLiveReport`。真实固件、
Cookie/Token 轮换和字段含义仍需用户设备验证；默认连续刷新由 PWA 的
`DevicePollingSession`/`PollingEngine` 负责。

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
2. 打开 CPE Huahua Probe 页面。
3. 页面自动使用 Bridge 请求；首次需要在“管理密码”框输入 H168 管理密码，用户名
   默认由 Bridge 使用 `admin`，不要求输入 URL。
4. 建议首次只勾选 `Remember Session`，保持 `Remember Password` 关闭。
5. 点击“读取 Probe”。Bridge 在 Surge 本地依次探测 endpoint，页面展示 HTTP 状态、
   Huawei error、延迟、完整 parsed fields 和脱敏 RAW XML。进入 Dashboard 后可启动
   当前版本按 endpoint 周期运行的集中轮询。首次轮询建议保持 `Remember Session` 开启，
   这样端点请求之间可以复用本地 Session/Cookie；关闭它时，认证端点可能需要每次重新
   登录。
6. 需要反馈数据时，在“只读探针清单”标题右侧点击 `复制本次全部`。它会把本次运行的
   所有 endpoint、时间戳、状态、结构化解析结果、字段列表和脱敏 RAW XML 合并为一个
   JSON，方便一次性复制。也可以在单个 endpoint 卡片中点击 `Copy Sanitized Result`。
   不要发送浏览器 Network 导出、完整 Cookie、密码或未脱敏 RAW XML；重新点击“读取
   Probe”时，页面会先清除上一次的探测结果。

如果要记录 Internet 可达性，在页面填写一个自己信任、低负载且返回 2xx/3xx 的 HTTPS
探测地址。地址只保存在本机浏览器设置，并通过 `/api/network-probe` 交给 Surge 本地
访问；不填写时 InternetOnline、Ping、Loss、Jitter 保持 `null`。这里的延迟是 HTTP
用户路径延迟，不是 ICMP Ping。

密码通过 POST body 发往专用 Bridge URL，由匹配的 Surge `http-request` script
在本地拦截；它不会被 Bridge 转发到远端服务器。若 Surge 没有启用或 pattern/MITM
配置错误，先不要提交密码。

## 失败时记录什么

- 页面显示“未发现默认网关”：确认仍连接 H168 Wi-Fi，并检查 Surge 是否接管请求。
- `basic_information` 失败：记录 HTTP 状态、页面错误和脱敏结果；不要继续猜测 IP。
- 登录失败或 endpoint 返回 `125003`：保留对应卡片的 Huawei error、parsed fields
  和脱敏 RAW XML。不要反复快速提交密码，以免触发设备登录限制。
- 某个 endpoint 返回 404/`100002`/`100003`：这属于能力证据，不能改成 `0` 或用
  其他指标代替；把结果发回后再更新 `docs/h168-findings.md`。

Bridge 的持久化状态使用 Surge 的 `$persistentStore`：`Remember Session` 保存
本地 Session/Cookie/CSRF 状态，`Remember Password` 才保存密码；二者独立。V1 不
使用 TCP 20249、Telnet、AT，也不会调用锁频、锁小区、APN、Wi-Fi 或重启接口。

实时 1/2/3/10 秒集中轮询、最近 60 个快照和事件时间线的设备无关骨架已经存在，但
Internet 侧连续探测目标尚未确定，所以 InternetOnline、Ping、Loss、Jitter 仍可能为
`null`。这不代表 H168 已支持这些字段。
