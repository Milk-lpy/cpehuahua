# CPE Huahua Surge runtime

`bridge.js` 是当前阶段的单文件 Surge 入口，原因是 Surge Module 运行时不保证
方便加载项目内多文件模块。协议和数据模型的可测试实现仍在 `packages/core`；该
文件只是把回调式 `$httpClient`、`$persistentStore` 和 WebView Web Crypto 接到
Probe 契约上。

它只匹配专用 Bridge URL，先用 `$network.v4.primaryRouter` 找默认网关，再读取
H168-383 的公开/认证只读 endpoint。`/api/probe` 返回脱敏 ProbeReport，`/api/live`
额外返回单次 `CpeLiveReport` 和保守规范化快照。登录 POST 仅用于认证，不是配置写
操作。真实设备兼容性尚未在本仓库验证。跨域访问只允许 `bridge.js` 中列出的 PWA
origin，部署时必须替换示例域名，不要改成任意来源。

PWA 当前通过 `LivePollingSession` 集中请求 `/api/live`；如果实机证明完整读取会造成
负载，再把入口拆成端点级 Surge 路由并接入 core `PollingEngine`。不要让 UI 直接请求
H168，也不要在这里加入配置修改 endpoint。
