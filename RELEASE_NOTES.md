# KimiMonitor v2.0.0 — Rust/Tauri 桌面版

本次正式发布 Rust + Tauri 桌面版，包含 Windows x64 安装包与 macOS 双架构 DMG。应用使用原生窗口和托盘；关闭窗口隐藏到后台，通过托盘或页面“退出”停止应用。

## 修复与改进

- 修复记录与会话索引关联，项目筛选和会话统计正确归属。
- 修复累计 token 数的 32 位溢出，大数显示不再变成负数。
- 重叠扫描目录按会话真实路径去重，避免重复统计。
- 支持带字段空格的 JSONL；缺少 `state.json` 的会话仍扫描并使用索引恢复工作目录。
- 相对时间范围随刷新更新，保留固定的自定义范围和正在编辑的日期。
- 无效配置返回错误并保留原配置；Node 兼容源码也修复了非法 URL 导致服务退出的问题。
- 缓存默认目录探测，完成引导后不再额外扫描默认会话目录。
- 增加 Node/共享前端与 Rust 回归测试，并接入 CI；许可证标注统一为 MIT。

## 下载与升级

- Windows：`KimiMonitor_2.0.0_x64-setup.exe`，需要 WebView2（Windows 11 自带）。
- macOS：`KimiMonitor_2.0.0_universal.dmg`，支持 Apple Silicon 与 Intel；未签名/公证，首次运行请右键“打开”。
- 从旧 Tauri 版升级沿用应用标识和配置目录。升级前退出旧应用，再安装新版本。
- 从 Node/SEA 版迁移时先停止旧服务；两种实现使用不同配置位置，请在首次引导重新确认数据目录。原 Kimi Code 会话文件保持只读。

Node/SEA 的安装包、便携版和 macOS TAR 包继续保留在 [v1.2.0 Release](https://github.com/YFan945/kimi-usage-monitor/releases/tag/v1.2.0)，不会加入本次发行，也不会覆盖历史资产。
