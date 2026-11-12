# E6888-982 实机样本

验证日期：2026-11-12。固件 `4.0.0.1(H3568SP91C00)`，Web UI
`4.0.0.1(W11SP37C03)`。`signal-sa.xml` 是本次成功登录后的实机响应节选，
空 LTE 字段、缺失 RSSI、复合 MCS/TX 和 `DL:… UL:…` 均保留。
Cell ID 和 TAC 已脱敏，未保留密码、Cookie、Token 或认证挑战。

已验证 `/api/device/basic_information`、`/api/device/information`、
`/api/monitoring/status`、`/api/net/current-plmn`、`/api/device/signal`、
`/api/monitoring/traffic-statistics`、`/api/monitoring/month_statistics`。
成功登录后 `/api/device/seccellinfo`、`/api/device/nbrcellinfo` 仍返回 `100003`。
这只证明此固件下这些端点不可用，不能推断所有 E6888 的硬件聚合能力。
