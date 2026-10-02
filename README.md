# KimiMonitor — Kimi Code 用量监控

本地桌面应用，监控 [Kimi Code](https://www.kimi.com/)（月之暗面 CLI）的 API 调用次数与 token 消耗。
v2.0.0 以 Rust + Tauri 桌面版为正式发行版，提供原生窗口与托盘，支持任意时段筛选、按模型/项目多选筛选、GitHub 风格热力总览、双主题。Node/SEA 产物保留在旧版 Release，仓库仍保留兼容源码与打包脚本。

## 下载安装（成品包）

到 [Releases](../../releases/latest) 页面下载，无需自己构建：

| 文件 | 平台 | 用法 |
|---|---|---|
| [`KimiMonitor_2.0.0_x64-setup.exe`](../../releases/download/v2.0.0/KimiMonitor_2.0.0_x64-setup.exe) | Windows 10/11 x64 | **Rust/Tauri 安装版**：原生托盘，双击安装（需要 WebView2，Win11 自带） |
| [`KimiMonitor_2.0.0_universal.dmg`](../../releases/download/v2.0.0/KimiMonitor_2.0.0_universal.dmg) | macOS 11+ 双架构 | **Rust/Tauri 版 .dmg**：拖入「应用程序」，首次右键 → 打开（未签名） |

### 旧版 Node/SEA 下载

需要 Node 安装版、单文件版或绿色版时，访问 [v1.2.0 Release](../../releases/tag/v1.2.0)。这些历史资产继续保留，不会重新打包或并入 v2.0.0。

| 文件 | 平台 | 用法 |
|---|---|---|
| `KimiMonitor-Setup-1.2.0.exe` | Windows 10/11 x64 | Node/SEA 安装版：免管理员权限安装，使用 PowerShell 托盘 |
| `KimiMonitor-Windows-x64.exe` | Windows | 便携单文件版，免安装，双击即用（SmartScreen 提示选"仍要运行"）；首次运行自动在桌面创建「KimiMonitor」快捷方式 |
| `KimiMonitor-Windows-Portable.zip` | Windows | 绿色文件夹版，解压后双击 `启动监控.bat` |
| `Kimi-Monitor-macOS.tar.gz` | macOS 11+ 双架构 | 解压 → 「KimiMonitor.app」拖入"应用程序"（首次需右键 → 打开）；卸载双击包内「卸载.command」 |

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

## 各版本的使用差异（后台与退出）

本应用由「后台服务 + 界面窗口」两部分组成。**关闭应用窗口 ≠ 退出**：窗口关掉后服务仍在后台运行（右下角托盘图标），要彻底退出请用下面的退出方式。

### Rust/Tauri v2.0.0（当前正式版）

- **启动**：开始菜单/桌面快捷方式「KimiMonitor」，原生窗口 + 原生托盘图标（无控制台、无 Edge 依赖）；内嵌服务仅绑定 `127.0.0.1`，优先使用 `43110`，被占用时自动选择空闲端口
- **后台**：关闭应用窗口 = 隐藏到后台，托盘常驻；托盘左键或菜单「打开窗口」恢复
- **退出**：托盘右键 →「退出」，服务与托盘一起彻底关闭
- **卸载**：设置 → 应用 → KimiMonitor → 卸载，同时清理配置目录（`%APPDATA%\com.yfan945.kimimonitor`）
- **构建**：需要 Rust + MSVC 构建工具，`npm install` 后 `npm run desktop`，产物在 `src-tauri/target/release/bundle/nsis/`

### Node/SEA 安装版（KimiMonitor-Setup-x.x.x.exe）

- **启动**：开始菜单或桌面快捷方式「KimiMonitor」（安装时可选择是否创建），没有控制台黑窗
- **后台**：关闭应用窗口后右下角托盘图标仍在，左键或右键菜单可「打开窗口」或「退出」
- **退出**：托盘右键 →「退出」，或页面右上角「退出」——服务、托盘、应用窗口会一起关闭
- **卸载**：设置 → 应用 → KimiMonitor → 卸载。会先结束后台服务和应用窗口，并**询问是否删除配置文件**（config.json，含数据目录设置，选否则下次安装保留设置）；被监控的 Kimi Code 会话数据（`~/.kimi-code`）不受任何影响；应用在注册表中只有 Windows 标准的卸载信息，卸载时自动移除，本应用自身不写任何注册表项

### 便携单文件版（KimiMonitor-Windows-x64.exe）

- **启动**：双击 exe（无控制台黑窗），首次运行自动在桌面创建「KimiMonitor」快捷方式
- **后台 / 退出**：同安装版（托盘退出 / 页面退出）
- **卸载**：无任何安装与注册表信息，退出后直接删 exe 即可；配置文件 config.json 生成在 exe 旁边，想要干净卸载就一并删除

### 绿色文件夹版（KimiMonitor-Windows-Portable.zip）

- **启动**：解压后双击「启动监控.bat」（电脑没有 Node 时，把 node.exe 放进 `runtime\` 子文件夹，见打包章节）
- **后台 / 退出**：同安装版；也可双击「停止监控.bat」结束服务
- **卸载**：退出后直接删除整个文件夹

### macOS

**Tauri 版（推荐，双架构 .dmg）**：因 macOS 应用必须在 macOS 上构建，仓库用 GitHub Actions 云端产出——推 `v*` 标签会构建并附加到 Release；在 Actions 页手动运行「Build desktop apps」时，从该次运行的 artifacts 下载。应用未做签名/公证，首次打开需右键 → 打开（或 `xattr -cr /Applications/KimiMonitor.app`）。后台/退出行为与 Windows Tauri 版一致（关窗隐藏到后台、托盘退出）。

**Node 版（Kimi-Monitor-macOS.tar.gz，旧）**：

- **启动**：打开「KimiMonitor.app」，自动打开浏览器页面；关闭页面后服务仍在后台
- **退出**：在「活动监视器」结束 node 进程，或直接双击包内「卸载.command」（同时删除 App 与 `~/Library/Application Support/KimiMonitor`）

## 打包成桌面应用

### 一键打包（推荐）

双击 `build.bat`（或命令行运行 `node build.js`），自动完成：读取版本号 → 构建单文件 exe → 冒烟测试 → 安装包 → 绿色版 zip，产物生成在 `dist\`。可选参数：

- `--mac`：额外构建 macOS .app 包（自动下载 node 官方双架构二进制，约 100MB）
- `--release`：构建后把产物上传到 GitHub Release v<版本号>（已存在该 Release 则覆盖资产）

依赖：Node.js ≥ 20（必装）；Inno Setup（缺则跳过安装包）；Python + Pillow（仅 mac 包图标需要）。

以下是从零手工复现各成品包的步骤（在 Windows 上构建）。

### 1. Windows 单文件 exe（Node SEA）

把页面资源内嵌进 Node 官方单文件应用（SEA）机制：

```bat
mkdir dist
node --experimental-sea-config sea-config.json
copy "%CD%\..\node\node.exe" dist\KimiMonitor.exe   &rem 或复制任意 Node ≥ 20.12 的 node.exe
npx postject dist\KimiMonitor.exe NODE_SEA_BLOB sea-prep.blob --sentinel-fuse %FUSE%
```

哨兵 fuse 随 Node 版本不同：Node 20/22 为 `NODE_SEA_FUSE_fce6eababc5e6c1af2e46e1b3d2d4cc4`，Node 24 为 `NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2`。查你本机 node.exe 的实际值：

```bat
grep -abo NODE_SEA_FUSE "C:\Program Files\nodejs\node.exe"
```

产物 `dist\KimiMonitor.exe`（约 90MB）双击即用：自动起服务、以 Edge 应用模式开窗、首次运行自动在桌面创建「KimiMonitor」快捷方式（只创建一次，由 config.json 的 `shortcut` 字段标记）；配置写在 exe 旁边。

- `sea-config.json` 声明了内嵌资产（`index.html` / `icon.png` / `favicon.ico`），`server.js` 通过 `node:sea` 检测自己是否运行在 SEA 模式
- 坑：不要用 rcedit 给这个 exe 换图标（90MB 的 Node 本体会让它挂死）；图标通过旁边的 `.ico` 文件给快捷方式用

### 2. Windows 安装包（Inno Setup）

先按上一步生成 `dist\KimiMonitor.exe`，再安装 [Inno Setup](https://jrsoftware.org/isinfo.php)（中文语言包随附），运行：

```bat
ISCC.exe packaging\installer.iss
```

产物 `dist\KimiMonitor-Setup-1.2.0.exe`：免管理员权限安装到 `%LOCALAPPDATA%\Programs\KimiMonitor`，安装时可勾选是否创建开始菜单 / 桌面快捷方式（默认都创建），带"应用和功能"卸载项（卸载时会强制结束运行中的进程并清理配置文件）。版本号在 `packaging\installer.iss` 顶部 `#define` 处修改。

### 3. macOS 应用包（.app）

可在 Windows 上运行 `node build.js --mac` 自动组装 Node 版双架构 `.app` 并输出 `dist/Kimi-Monitor-macOS.tar.gz`。需要网络下载 Node 二进制及 Python；Pillow 用于生成图标。下列步骤用于手工复现，不是 Tauri `.dmg` 的构建方式：

1. 从 [nodejs.org](https://nodejs.org/dist/) 下载 macOS **arm64 与 x64** 两个官方 tarball（v22 LTS），解出各自 `bin/node`，存为 `Resources/bin/node-darwin-arm64`、`Resources/bin/node-darwin-x64`
2. 把 `server.js` 与 `public/` 拷进 `Resources/app/`
3. `Contents/MacOS/kimi-monitor` 写一个启动脚本：按 `uname -m` 选对应架构的 node 执行 `Resources/app/server.js`，然后打开浏览器
4. `Info.plist` 设 `CFBundleExecutable=kimi-monitor`、`CFBundleIconFile=icon.icns`、`CFBundleName=KimiMonitor`
5. 图标 `icon.icns` 由 `icon-512.png` 转换（Python Pillow 可直接生成 ICNS）
6. 再包一层「卸载.command」脚本（`pkill` 掉服务 + 删除 .app 与 `~/Library/Application Support/KimiMonitor`），最后：

```bash
tar czf dist/Kimi-Monitor-macOS.tar.gz "KimiMonitor.app" 卸载.command
```

未做公证，首次打开需右键 → 打开，或 `xattr -cr "KimiMonitor.app"`。

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
会话的工作目录取自 `state.json` 的 `cwd`，缺失时用 `session_index.jsonl` 的 `workDir` 兜底；没有 `state.json` 但存在 `agents/` 的会话也会扫描。
合法 JSONL 中的字段空格不影响解析，损坏行会跳过。重叠扫描目录按会话真实路径去重，同一个会话只计一次。
“今天 / 24 小时 / 7 天 / 30 天”随页面刷新或重新渲染更新，自定义范围保持固定。

## 开发与回归测试

```bash
npm test
cargo test --manifest-path src-tauri/Cargo.toml --locked
```

`npm test` 使用 Node 内置 `node:test`，测试真实 HTTP 服务与共享前端函数，无需安装运行时依赖。Rust 测试需要桌面构建工具链，验证 Tauri 数据引擎。全部会话样本均为临时目录中的合成数据，不扫描用户的真实会话。

回归覆盖会话索引、重叠目录、缺少元数据、JSONL 空格与损坏行、大数 token、相对时段、异常配置及非法 URL。配置请求需要 `roots` 字符串数组和可选的 `setupDone` 布尔值；Node 返回 `400` 拒绝无效配置，超过 1 MiB 返回 `413`，原配置保留。

`.github/workflows/test.yml` 在 PR 和 main 分支推送时运行回归测试；桌面构建工作流也先运行测试。自动化测试不覆盖窗口、托盘及安装器交互，相关修改仍需手动验证。

Tauri 版本来自 `package.json`、`src-tauri/Cargo.toml` 和 `src-tauri/tauri.conf.json`；Node/SEA 安装器版本独立来自 `packaging/installer.iss`。发布前核对对应产物的版本，`node build.js --release` 会上传并覆盖同名资产。

## 开源协议

[MIT](LICENSE)
