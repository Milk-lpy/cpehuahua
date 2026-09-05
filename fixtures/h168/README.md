# H168 fixture policy

这些 XML 只用于解析器、认证和 Adapter 的离线测试。当前文件是根据公开参考项目
中的字段/响应形状制作的脱敏 reference fixture，不是用户 H168-383 的实机抓包，
不能用来宣布 H168 字段已支持。

真实响应放在被 `.gitignore` 忽略的 `fixtures/h168/live/`，分析后只提交脱敏且带
来源与采集时间的 fixture。
