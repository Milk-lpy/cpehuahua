# CPE Huahua Surge runtime

`bridge.js` 是当前阶段的单文件 Surge 入口，原因是 Surge Module 运行时不保证
方便加载项目内多文件模块。协议和数据模型的可测试实现仍在 `packages/core`；该
文件只是把回调式 `$httpClient`、`$persistentStore` 和 WebView Web Crypto 接到
Probe 契约上。

它只匹配专用 Bridge URL，先用 `$network.v4.primaryRouter` 找默认网关，再读取
H168-383 的公开/认证只读 endpoint。登录 POST 仅用于认证，不是配置写操作。真实
设备兼容性尚未在本仓库验证。跨域访问只允许 `bridge.js` 中列出的 PWA origin，
部署时必须替换示例域名，不要改成任意来源。

后续增加 PollingEngine 前，应把此入口拆为 Surge 适用的模块并由 bundler 生成；不要
让 UI 直接请求 H168，也不要在这里加入配置修改 endpoint。
