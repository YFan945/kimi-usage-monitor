# Kimi Code 用量监控（Kimi Monitor）

本地桌面应用，监控 [Kimi Code](https://www.kimi.com/)（月之暗面 CLI）的 API 调用次数与 token 消耗。
零依赖 Node 服务 + 单页前端，支持任意时段筛选、按模型/项目多选筛选、GitHub 风格热力总览、双主题。

## 下载安装（成品包）

到 [Releases](../../releases/latest) 页面下载，无需自己构建：

| 文件 | 平台 | 用法 |
|---|---|---|
| `KimiMonitor-Setup-1.0.1.exe` | Windows 10/11 x64 | **安装版（推荐）**：双击安装 → 开始菜单/桌面快捷方式；卸载走"设置 → 应用 → 已安装的应用" |
| `KimiMonitor-Windows-x64.exe` | Windows | 便携单文件版，免安装，双击即用（SmartScreen 提示选"仍要运行"）；首次运行自动在桌面创建「Kimi Monitor」快捷方式 |
| `KimiMonitor-Windows-Portable.zip` | Windows | 绿色文件夹版，解压后双击 `启动监控.bat` |
| `Kimi-Monitor-macOS.tar.gz` | macOS 11+ 双架构 | 解压 → 「Kimi Monitor.app」拖入"应用程序"（首次需右键 → 打开）；卸载双击包内「卸载.command」 |

## 如何使用

### 启动

- **源码运行**：装好 Node.js（≥ 18）后运行 `node server.js`，浏览器打开 <http://127.0.0.1:43110>
- **桌面窗口**：双击 `启动监控.bat` —— 启动本地服务并以 Edge 应用模式独立窗口打开（无地址栏，像普通桌面程序；没装 Edge 则用默认浏览器）
- 换端口：`node server.js --port 8080`，或设环境变量 `KIMI_MONITOR_PORT`

### 停止

关闭窗口不会停止后台服务。停止方式任选其一：

- 双击 `停止监控.bat`
- 点页面右上角"退出"

重复运行启动脚本无副作用：检测到端口被占用时新进程会自动退出，复用已在运行的服务。

### 首次运行引导

第一次启动会进入初始化引导，自动探测默认数据目录 `C:\Users\<用户名>\.kimi-code\sessions`（macOS 为 `~/.kimi-code/sessions`）并显示会话统计，确认即可；Kimi Code 数据不在常用位置就选"指定其他目录"手填。

### 数据目录

- 页面右上角"数据目录"面板可随时增删扫描目录，修改后立即重新扫描；不存在的路径会被自动剔除
- 路径结构需为 `…\sessions\<工作区>\<会话>\agents`，也兼容直接指向某个会话集合目录
- 扫描目录保存在 `config.json`（源码运行 = 项目目录；Windows exe = exe 旁边；macOS = `~/Library/Application Support/KimiMonitor`），其余界面状态（主题、时段、筛选）保存在浏览器 localStorage

## 打包成桌面应用

仓库只含源代码，以下是从零复现各成品包的步骤（在 Windows 上构建）。

### 1. Windows 单文件 exe（Node SEA）

把页面资源内嵌进 Node 官方单文件应用（SEA）机制：

```bat
mkdir dist
node --experimental-sea-config sea-config.json
copy "%CD%\..\node\node.exe" dist\KimiMonitor.exe   &rem 或复制任意 Node ≥ 20.12 的 node.exe
npx postject dist\KimiMonitor.exe NODE_SEA_BLOB sea-prep.blob --sentinel-fuse NODE_SEA_FUSE_fce6eababc5e6c1af2e46e1b3d2d4cc4
```

产物 `dist\KimiMonitor.exe`（约 90MB）双击即用：自动起服务、以 Edge 应用模式开窗、首次运行自动在桌面创建「Kimi Monitor」快捷方式（只创建一次，由 config.json 的 `shortcut` 字段标记）；配置写在 exe 旁边。

- `sea-config.json` 声明了内嵌资产（`index.html` / `icon.png` / `favicon.ico`），`server.js` 通过 `node:sea` 检测自己是否运行在 SEA 模式
- 坑：不要用 rcedit 给这个 exe 换图标（90MB 的 Node 本体会让它挂死）；图标通过旁边的 `.ico` 文件给快捷方式用

### 2. Windows 安装包（Inno Setup）

先按上一步生成 `dist\KimiMonitor.exe`，再安装 [Inno Setup](https://jrsoftware.org/isinfo.php)（中文语言包随附），运行：

```bat
ISCC.exe packaging\installer.iss
```

产物 `dist\KimiMonitor-Setup-1.0.1.exe`：免管理员权限安装到 `%LOCALAPPDATA%\Programs\KimiMonitor`，无条件创建开始菜单 + 桌面快捷方式，带"应用和功能"卸载项（卸载时会强制结束运行中的进程并清理配置文件）。版本号在 `packaging\installer.iss` 顶部 `#define` 处修改。

### 3. macOS 应用包（.app）

仓库未内置 mac 构建脚本，手工组装（在任意能跑 macOS 的机器上）：

1. 从 [nodejs.org](https://nodejs.org/dist/) 下载 macOS **arm64 与 x64** 两个官方 tarball（v22 LTS），解出各自 `bin/node`，存为 `Resources/bin/node-darwin-arm64`、`Resources/bin/node-darwin-x64`
2. 把 `server.js` 与 `public/` 拷进 `Resources/app/`
3. `Contents/MacOS/kimi-monitor` 写一个启动脚本：按 `uname -m` 选对应架构的 node 执行 `Resources/app/server.js`，然后打开浏览器
4. `Info.plist` 设 `CFBundleExecutable=kimi-monitor`、`CFBundleIconFile=icon.icns`、`CFBundleName=Kimi Monitor`
5. 图标 `icon.icns` 由 `icon-512.png` 转换（Python Pillow 可直接生成 ICNS）
6. 再包一层「卸载.command」脚本（`pkill` 掉服务 + 删除 .app 与 `~/Library/Application Support/KimiMonitor`），最后：

```bash
tar czf dist/Kimi-Monitor-macOS.tar.gz "Kimi Monitor.app" 卸载.command
```

未做公证，首次打开需右键 → 打开，或 `xattr -cr "Kimi Monitor.app"`。

### 4. Windows 绿色文件夹版（zip）

把整个项目文件夹拷到目标机器，在没有 Node 的电脑上从 [nodejs.org](https://nodejs.org/download/release/) 的 Windows x64 zip 包里取出 `node.exe` 放进 `runtime\` 子文件夹（`启动监控.bat` 会自动识别），连同 bat 脚本一起打包成 zip 即可。

## 功能

- **Token 活动总览**（页首）：GitHub 风格的热力日历，正方形格子、追溯补足空周（最多约 1 年）铺满整行宽度；右上角"每日 / 每周 / 累计"三种模式；悬停显示"日期 / tokens · 调用次数"。始终展示全部数据，不随时段与筛选变化
- **时段**：今天 / 24 小时 / 7 天 / 30 天 / 全部，或自定义起止时间；图表时间轴始终覆盖完整所选时段，空时段显示明确提示
- **趋势图**：按天或按小时的堆叠柱状图，默认叠加缓存读取（紫色，可取消）；"着色"可切换按类型（输出/输入/缓存）/按模型（每模型一色，悬停看逐模型分解）；常规时段自适应铺满不出现横向滚动
- **按模型/项目筛选（多选）**：趋势图上方下拉多选，或点击"按模型/按项目"横条行加入/移出筛选；多个条件叠加生效
- **主题**：自动（跟随系统）/ 浅色 / 深色；界面状态自动记忆
- **自动刷新**：每 10 秒增量扫描（只重读有变化的 wire.jsonl）

## 数据口径

数据来自各会话 `agents/*/wire.jsonl` 的 `usage.record` 事件——每次 LLM 请求（含子 agent）一条，
字段为 `inputOther` / `output` / `inputCacheRead` / `inputCacheCreation`。只统计 token 数，不代表费用。
会话的工作目录取自 `state.json` 的 `cwd`，缺失时用 `session_index.jsonl` 的 `workDir` 兜底。

## 开源协议

[MIT](LICENSE)
