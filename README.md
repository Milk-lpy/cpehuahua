# CPE Huahua / cpehuahua

面向 iPhone / iOS 的 Huawei / Brovi 5G CPE 实时监控项目。V1 的目标设备是
Huawei / Brovi H168-383（鸿蒙智选 5G CPE Ultra 6），重点是移动场景中的蜂窝、
小区、载波聚合、Internet 可达性和断流事件时间线。

当前仓库已进入“实机监控 + 有界设备控制”阶段。已经收到一台 H168-383 的真实 ProbeReport，并验证了
一批只读 endpoint；短信、锁频、移动数据、终端过滤和重启写入仍需在该 H168 上逐项回读。没有实机返回证据
的字段必须保持 `null`，能力状态必须保持 `unknown`；不会用其他指标填充。当前实机
结论见 [docs/h168-findings.md](docs/h168-findings.md)。

## 第一轮交付范围

- 参考项目、许可证和 H168 证据边界：见 [docs/reference-research.md](docs/reference-research.md)
- 目前已知差异与待验证项：见 [docs/h168-findings.md](docs/h168-findings.md)
- 分层、Adapter、只读和本地优先决策：见 [docs/architecture.md](docs/architecture.md)
- TypeScript strict 核心模型、XML 解析、H168 登录状态机基础和测试
- H168 Probe 的端点清单、原始响应/脱敏响应契约；诊断端点仍保留在 Bridge，生产界面不开放 Probe 页面
- 集中 `PollingEngine`、用户路径 `NetworkQualityTracker`、独立 `EventEngine` 及其测试
- iPhone 优先的登录、概览、控制、锁频、设备、短信界面，动态 PCC/SCell/Neighbor
  展示、流量统计、事件时间线和 PWA 离线壳
- Surge 本地 Bridge：`/api/probe` 返回脱敏诊断，`/api/endpoint/<id>` 支持
  集中端点轮询，`/api/network-probe` 提供可选用户路径样本，`/api/live` 保留单次规范化
  快照回退；`/api/control` 只接受固定 action，不接受任意 URL 或 XML
- 短信收件箱/发件箱、发送、已读和删除；移动数据开关、4G/5G Band 掩码、设备重启；
  在线终端详情和兼容性 MAC 过滤断网

本轮没有宣称生产级全量控制支持；用户可显式配置自己的低负载 HTTPS 用户路径探测，
也可主动选用 Apple 联网检测地址。锁 PCI/小区、终端限速/重命名、WLAN/APN、升级、
恢复出厂和关机仍待 H168 实机协议证据，不会用猜测按钮代替。
端点级路由已完成一批 H168-383 实机读取验证，但状态代码、复合 MCS/TX 字段、速率
单位和 Session 复用细节仍需继续确认。

## 目标运行方式

```text
iPhone Safari / PWA
        │ 专用 HTTPS Bridge URL
        ▼
Surge http-request Script
        │ 本地读取默认网关并请求 H168
        ▼
H168-383 Wi-Fi 管理接口
```

实时数据不依赖远端服务器。管理密码、Session、Cookie 和 CSRF Token 只允许在
iPhone / Surge / H168 的本地链路中处理，不能发送到本项目远端服务器。当前 Bridge
已在一台 H168-383 上完成部分认证和只读 endpoint 验证；未验证字段仍只返回 null 或
unknown，认证失败时只返回错误和脱敏证据。

## 开发

需要 Node.js 20.19+（当前开发环境为 Node 24）和 npm。

```bash
npm install
npm test
npm run typecheck
npm run build
npm run lint
npm run dev --workspace @cpehuahua/web
```

推送到 `main` 后，GitHub Actions 会构建并发布手机可访问的 GitHub Pages 前端：
`https://milk-lpy.github.io/cpehuahua/`。页面本身是静态文件；实时 H168 数据仍通过
iPhone 上的 Surge Bridge 获取，不会发送到 GitHub Pages。

测试 fixture 是脱敏的参考形状或经整理的实机响应，不应据此宣称全量支持。真实抓包只能保存到
本地未纳入版本控制的 `fixtures/h168/live/`，整理后再提交脱敏结果。

## 支持范围

| 设备 | V1 状态 |
| --- | --- |
| H168-383 | 已验证一批只读 endpoint；完整字段支持仍需 Probe 实机验证 |
| H155-381 | 仅保留 Adapter / Interface stub |
| E6888、H158、烽火设备 | V1 不实现 |

## 许可证

本项目自己的 clean reimplementation 代码使用 MIT。参考项目只用于研究协议、
字段意义和行为；没有直接复制 GPL 前端或参考仓库实现代码。参考项目许可证和
使用边界记录在 [docs/reference-research.md](docs/reference-research.md)。
