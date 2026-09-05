# CPE Huahua / cpehuahua

面向 iPhone / iOS 的 Huawei / Brovi 5G CPE 实时监控项目。V1 的目标设备是
Huawei / Brovi H168-383（鸿蒙智选 5G CPE Ultra 6），重点是移动场景中的蜂窝、
小区、载波聚合、Internet 可达性和断流事件时间线。

当前仓库处于研究与探针阶段。`H168-383` 是目标设备，不等于本仓库已经在真实
设备上验证了所有端点或字段。没有实机返回数据的字段必须保持 `null`，能力状态
必须保持 `unknown`；不会用其他指标填充。

## 第一轮交付范围

- 参考项目、许可证和 H168 证据边界：见 [docs/reference-research.md](docs/reference-research.md)
- 目前已知差异与待验证项：见 [docs/h168-findings.md](docs/h168-findings.md)
- 分层、Adapter、只读和本地优先决策：见 [docs/architecture.md](docs/architecture.md)
- TypeScript strict 核心模型、XML 解析、H168 登录状态机基础和测试
- H168 Probe 的端点清单、原始响应/脱敏响应契约和朴素 Probe 页面
- 实验性的 Surge 只读 Probe Bridge：单次收集公开/认证 endpoint；实时轮询仍在后续阶段

本轮没有实现完整视觉 Dashboard、锁频、锁 PCI、锁小区、APN、重启 CPE 或其他
写操作。

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
仍需真实 H168-383 验证；认证失败时只返回错误和脱敏证据，不宣称设备已支持。

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

测试 fixture 是脱敏的参考形状，不是 H168-383 实机抓包。真实抓包只能保存到
本地未纳入版本控制的 `fixtures/h168/live/`，整理后再提交脱敏结果。

## 支持范围

| 设备 | V1 状态 |
| --- | --- |
| H168-383 | 目标设备；必须经过 Probe 实机验证 |
| H155-381 | 仅保留 Adapter / Interface stub |
| E6888、H158、烽火设备 | V1 不实现 |

## 许可证

本项目自己的 clean reimplementation 代码使用 MIT。参考项目只用于研究协议、
字段意义和行为；没有直接复制 GPL 前端或参考仓库实现代码。参考项目许可证和
使用边界记录在 [docs/reference-research.md](docs/reference-research.md)。
