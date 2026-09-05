# Surge Module 安装与 H168 实机 Probe

当前 `surge/bridge.js` 是实验性的只读 Bridge：它会发现 IPv4 默认网关、先读取
`basic_information` 确认 H168-383，再读取公开和认证 endpoint。`/api/probe` 返回
脱敏 `ProbeReport`，`/api/live` 返回单次脱敏 `CpeLiveReport`。真实固件、Cookie/Token
轮换和字段含义仍需用户设备验证；连续刷新由 PWA 的 `LivePollingSession` 负责。

## 安装前提

- iPhone 已连接 H168-383 Wi-Fi。
- Surge 已安装并能正常接管该 Wi-Fi 的 HTTP 请求。
- `surge/cpehuahua.sgmodule` 和 `surge/bridge.js` 都已导入；若 Surge 的脚本路径
  解析方式不同，按本机界面把 `script-path=bridge.js` 指向导入的同一份脚本。
- 只为 Bridge 域名启用 MITM。示例使用 `cpe-bridge.example.com`；如果改成自己的
  专用域名，必须同时修改 Module 的 `[Script]` pattern、`[MITM] hostname` 和网页
  中的 Bridge URL。不要把大量无关域名加入 MITM。
- 若 PWA 与 Bridge 不同源，在 `bridge.js` 的 `ALLOWED_WEB_ORIGINS` 中把 PWA 的
  实际 HTTPS origin 加入白名单；不要为了省事把它改成任意来源。

## 用户操作

1. 确认 Surge Module 已启用，并确认 Safari 的 Bridge URL 是专用 HTTPS URL。
2. 打开 CPE Huahua Probe 页面。
3. 页面自动使用 Bridge 请求；首次需要在“管理密码”框输入 H168 管理密码，用户名
   默认由 Bridge 使用 `admin`，不要求输入 URL。
4. 建议首次只勾选 `Remember Session`，保持 `Remember Password` 关闭。
5. 点击“读取 Probe”。Bridge 在 Surge 本地依次探测 endpoint，页面展示 HTTP 状态、
   Huawei error、延迟、完整 parsed fields 和脱敏 RAW XML。进入 Dashboard 后可启动
   当前版本的集中 live 快照轮询。
6. 对需要反馈的 endpoint 点击 `Copy Sanitized Result`，只发送脱敏结果；不要发送
   浏览器 Network 导出、完整 Cookie、密码或未脱敏 RAW XML。

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

实时 1/2/3/10 秒集中轮询、Internet 侧连续 Ping/丢包判断和历史事件时间线尚未在
本轮实现；Probe 成功后再进入这些阶段。
