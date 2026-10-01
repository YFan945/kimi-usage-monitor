# Kimi Code 用量监控（桌面便携版）

本地桌面应用，监控 Kimi Code 的 API 调用次数与 token 消耗，支持任意时段筛选、按模型/项目筛选、双主题。

## 下载安装

到 [Releases](../../releases/latest) 页面下载：

| 文件 | 平台 | 用法 |
|---|---|---|
| `KimiMonitor-Setup-1.0.0.exe` | Windows 10/11 x64 | **安装版（推荐）**：双击安装 → 开始菜单/桌面快捷方式；卸载走"设置 → 应用 → 已安装的应用" |
| `KimiMonitor-Windows-x64.exe` | Windows | 便携单文件版，免安装，双击即用（SmartScreen 提示选"仍要运行"） |
| `KimiMonitor-Windows-Portable.zip` | Windows | 绿色文件夹版，解压后双击 `启动监控.bat` |
| `Kimi-Monitor-macOS.tar.gz` | macOS 11+ 双架构 | 解压 → 「Kimi Monitor.app」拖入"应用程序"（首次需右键 → 打开）；卸载双击包内「卸载.command」 |

也可以直接克隆本仓库用 `node server.js` 运行（见下文"文件夹版移植"）。

## 桌面启动

**双击 `启动监控.bat`** —— 会启动本地服务并以独立窗口打开（Edge 应用模式，无地址栏，像普通桌面程序）。

- 关闭窗口不会停止服务；要停止请双击 `停止监控.bat`，或点页面右上角"退出"
- 重复双击启动脚本无副作用（端口占用时自动复用已在运行的服务）
- 换端口：`node server.js --port 8080`（端口会写进 port.txt 供脚本使用）

## 单文件安装包（dist\ 目录）

| 文件 | 平台 | 用法 |
|---|---|---|
| `KimiMonitor-Windows-x64.exe` | Windows 10/11 x64 | 单文件，双击即用：自动起服务 + 弹出应用窗口；首次运行会在 exe 旁边生成 config.json 并进入初始化引导 |
| `Kimi-Monitor-macOS.tar.gz` | macOS 11+（Apple Silicon / Intel 双架构） | 解压得到「Kimi Monitor.app」，右键 → 打开（首次需绕过 Gatekeeper，见包内说明），启动后自动开浏览器 |

两个包都把服务端与页面资源打进/放进程内部，数据目录通过首次引导或页面右上角"数据目录"配置，配置文件保存在程序旁边（Windows）或 App 沙盒旁（macOS）。

自己重新构建 Windows exe：`node --experimental-sea-config sea-config.json` → 复制 node.exe → `npx postject` 注入 blob（见 sea-config.json）；
构建 Windows 安装包：安装 [Inno Setup](https://jrsoftware.org/isinfo.php) 后运行 `ISCC.exe packaging\installer.iss`（产物在 `dist\`）。

## 文件夹版移植（不用单文件包时）

把整个 `kimi-usage-monitor` 文件夹拷过去即可：

1. 目标电脑装了 Node.js → 直接双击 `启动监控.bat`
2. 没装 Node → 从任意一台装了 Node 的电脑复制 `node.exe` 放进 `runtime\` 子文件夹，再双击启动
3. **首次会弹出初始化引导**：自动探测默认位置 `C:\Users\<用户名>\.kimi-code\sessions` 并显示会话统计，确认即可；不在常用位置就选"指定其他目录"手填
4. （可选）双击 `创建桌面快捷方式.bat`，把带图标的快捷方式放到桌面

扫描目录保存在程序目录的 `config.json`，其余状态（主题、时段、筛选）保存在目标电脑的浏览器里。之后可在页面右上角"数据目录"里随时增删目录。

## 应用图标

`public/icon.png` / `public/favicon.ico` 由 `icon-512.png` 生成，Edge 应用窗口、任务栏和浏览器标签页均显示该图标；`创建桌面快捷方式.bat` 生成的桌面快捷方式同样使用它。

## 数据目录说明

- 可添加多个目录，路径结构需为 `…\sessions\<工作区>\<会话>\agents`（也兼容直接指向某个会话集合目录）
- 修改后立即重新扫描；无效路径（不存在）会被自动剔除
- 会话的工作目录取自 `state.json` 的 `cwd`，缺失时用 `session_index.jsonl` 的 `workDir` 兜底

## 功能

- **Token 活动总览**（页首）：GitHub 风格的热力日历，正方形格子、追溯补足空周（最多约 1 年）铺满整行宽度；右上角"每日 / 每周 / 累计"三种模式；悬停显示"日期 / tokens · 调用次数"。始终展示全部数据，不随时段与筛选变化
- **时段**：今天 / 24 小时 / 7 天 / 30 天 / 全部，或自定义起止时间；图表时间轴始终覆盖完整所选时段，空时段显示明确提示
- **趋势图**：按天或按小时的堆叠柱状图，默认叠加缓存读取（紫色，可取消）；"着色"可切换按类型（输出/输入/缓存）/按模型（每模型一色，悬停看逐模型分解）；常规时段自适应铺满不出现横向滚动
- **按模型/项目筛选（多选）**：趋势图上方下拉多选，或点击"按模型/按项目"横条行加入/移出筛选；多个条件叠加生效
- **主题**：自动（跟随系统）/ 浅色 / 深色；界面状态（时段、筛选、主题等）自动记忆
- **自动刷新**：每 10 秒增量扫描（只重读有变化的 wire.jsonl）

## 数据口径

数据来自各会话 `agents/*/wire.jsonl` 的 `usage.record` 事件——每次 LLM 请求（含子 agent）一条，
字段为 `inputOther` / `output` / `inputCacheRead` / `inputCacheCreation`。只统计 token 数，不代表费用。

## 开源协议

[MIT](LICENSE)
