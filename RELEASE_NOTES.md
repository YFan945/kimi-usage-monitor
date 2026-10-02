# KimiMonitor v2.0.0 — Rust/Tauri 桌面版

KimiMonitor 从本机 Kimi Code 会话日志统计模型调用次数与 token 用量，提供趋势图、活动热力图、模型/项目多选筛选及浅色/深色主题。本版本使用 Rust 数据引擎与 Tauri 原生窗口、托盘，是当前 Latest 正式版；安装后无需 Node.js 或 Rust 工具链。

## 下载

| 文件 | 平台 | 用法 |
|---|---|---|
| [KimiMonitor_2.0.0_x64-setup.exe](https://github.com/YFan945/kimi-usage-monitor/releases/download/v2.0.0/KimiMonitor_2.0.0_x64-setup.exe) | Windows x64 | 运行安装器；需要 WebView2，缺少时按安装器提示处理 |
| [KimiMonitor_2.0.0_universal.dmg](https://github.com/YFan945/kimi-usage-monitor/releases/download/v2.0.0/KimiMonitor_2.0.0_universal.dmg) | macOS，Apple Silicon / Intel | 打开 DMG，将应用拖入“应用程序”；未签名或公证，首次打开按系统提示处理 |

## 修复与改进

- 修复调用记录与会话索引的关联，项目筛选及会话明细正确归属。
- 修复累计 token 超过 32 位范围后的显示溢出。
- 重叠扫描路径按会话真实路径去重，避免重复累计。
- 接受带字段空格的 JSONL，跳过损坏行；没有 `state.json` 但有 `agents/` 的会话仍会扫描，并使用可找到的索引恢复项目目录。
- 相对时段随刷新更新，自定义范围固定，自动刷新不会覆盖正在编辑的日期。
- 拒绝无效配置并保留原设置，缓存默认目录探测，完成引导后不再额外扫描默认目录。
- 增加 Node/共享前端和 Rust 回归测试，接入 CI；许可证标注统一为 MIT。

## 使用、退出与升级

首次启动时确认默认 `~/.kimi-code/sessions` 目录，或选择自己的会话集合目录。统计包含主 agent 和子 agent；token 合计不代表费用、余额或剩余额度。监控只读取原会话文件。

关闭窗口会隐藏到后台；通过托盘恢复窗口，通过托盘菜单或页面“退出”停止应用。内嵌服务仅绑定 `127.0.0.1`，优先使用 `43110`，被占用时自动选择空闲端口，不依赖 Edge。

升级前先退出旧应用。同一 Tauri 发行线沿用应用标识和配置位置：Windows 为 `%APPDATA%\com.yfan945.kimimonitor`，macOS 为 `~/Library/Application Support/com.yfan945.kimimonitor`。卸载后配置可能保留，需要重置时在退出后手动清理相应目录。

从 Node/SEA 迁移时先停止原服务，再在 Tauri 首次引导中重新确认目录；两者的程序配置和界面设置不会自动迁移。完整说明见 [README](https://github.com/YFan945/kimi-usage-monitor#readme)。

## 验证与维护版

此发布提交已通过 Node 18/24 回归测试和 Rust 单元测试，Windows 与 macOS 双架构安装包的云端构建成功。自动化验证不等同于所有系统版本上的窗口、托盘和安装器实机验收。

Node/SEA 继续以独立的 v1.x 维护线提供 Windows 安装版、单文件版、绿色版和 macOS TAR 包，最新补丁见 [v1.2.1](https://github.com/YFan945/kimi-usage-monitor/releases/tag/v1.2.1)。这些包不属于本次 Rust 发行；历史版本资产继续保留。
