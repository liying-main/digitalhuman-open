# 本次离线验证记录

验证日期：2026-10-30。

在项目根目录执行：

```powershell
python -m unittest discover -s tests -v
node --test tests/*.test.js
git diff --check
```

- Python：8 项通过。覆盖现成配音跳过写稿/TTS、素材预校验、显式 Key 优先级、本机 Web 的跨站限制、配置不回传 Key、自定义服务和输出目录、任务互斥。
- Node：7 项通过。覆盖 Key 加密保存与旧配置迁移、加密不可用/配置损坏、数字人使用默认 Key、SRT 文本响应及 HTTP 错误脱敏。系统加密接口由测试替身模拟。
- Electron 源码和 Web 内嵌 JavaScript 通过 `node --check`；Git 空白检查通过。

没有调用云端 API。测试使用模拟服务与临时目录，媒体和临时设置在测试后移除。尚未安装/运行 Electron 或构建安装包，未验证真实系统 `safeStorage` 及云端模型兼容性。本文件记录结果，未保存含用户数据的原始日志。
