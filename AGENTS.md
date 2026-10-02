# Repository Guidelines

## 项目结构与模块组织

本项目监控本地 Kimi Code 会话的调用次数与 token 用量，提供 Node 服务版和 Tauri 桌面版。

- `server.js`：零运行时依赖的 CommonJS 服务，负责扫描、缓存、聚合和 HTTP API。
- `public/`：共享前端；`index.html` 内含 HTML、CSS 和 JavaScript，另有 PWA manifest 与图标。
- `src-tauri/src/main.rs`：Rust 数据引擎、HTTP 服务、窗口与原生托盘；`tauri.conf.json` 和 `icons/` 管理桌面配置与资源。
- `build.js`、`sea-config.json`、`packaging/installer.iss`：Node SEA 打包与 Windows 安装器；根目录 `.bat` 提供启动、停止和构建入口。
- `.github/workflows/build.yml`：Windows 与 macOS Tauri 构建；`dist/` 和 `src-tauri/target/` 是忽略的构建产物。

## 构建与开发命令

- `node server.js`：启动源码版，访问 `http://127.0.0.1:43110`；需要 Node.js ≥ 18。
- `node server.js --port 8080`：指定端口，也可设置 `KIMI_MONITOR_PORT`。
- `npm install`：安装 Tauri CLI；Node 服务本身无需此步骤。
- `npm run desktop:dev`：运行 Tauri 开发模式。
- `npm run desktop`：构建桌面安装包；需要 Rust 及平台构建工具，Windows 还需 MSVC。
- `node build.js`：构建 Windows SEA、执行冒烟测试并打包到 `dist/`；需要 Node.js ≥ 20.12，缺少 Inno Setup 时跳过安装器。

## 代码风格与命名

沿用邻近代码：JavaScript 使用两空格缩进、单引号、分号和 CommonJS；函数与变量使用 `camelCase`，常量使用 `UPPER_SNAKE_CASE`。Rust 使用四空格缩进、`snake_case` 函数和 `PascalCase` 类型。仓库未配置 ESLint 或 Prettier，避免无关的整文件格式化。界面文案与说明使用中文，代码标识符保持原文。

## 测试与验证

`tests/*.test.js` 使用 Node 内置 `node:test`，运行 `npm test`；Rust 单元测试位于 `src-tauri/src/main.rs`，运行 `cargo test --manifest-path src-tauri/Cargo.toml --locked`。没有覆盖率门槛。测试使用临时合成数据，覆盖统计、扫描和请求异常；`build.js` 另有 SEA 启动、API 和退出冒烟测试。

功能修改应手动验证首次引导、目录配置、筛选、主题、空数据与刷新；桌面修改还需验证关窗隐藏、托盘恢复和退出。扫描或聚合修改须核对 Node 与 Rust 两套实现的输出，保持 `usage.record` 字段口径一致。新增测试建议使用 `*.test.js` 或 Rust `#[test]`，采用合成会话数据。

Windows SEA 打包后可设置 `$env:KIMI_MONITOR_TEST_EXE = (Resolve-Path dist/KimiMonitor.exe).Path`，运行 `node --test tests/server.test.js`，再用 `Remove-Item Env:KIMI_MONITOR_TEST_EXE` 清理变量。测试会将 exe 复制到临时目录，直接验证二进制的统计和异常请求。

## 提交与 Pull Request

Git 历史多用中文描述具体改动，偶有 `v1.3.0：…` 版本前缀，没有统一 Conventional Commits 规则。提交应聚焦单一目的，例如 `修复：空时段趋势图显示`。

PR 应说明问题、行为变化、影响版本和验证结果；有关联 issue 时附链接，界面修改附截图。大改动及时更新 `README.md`，涉及版本更新时核对 npm、Cargo、Tauri 与安装器配置。

## 配置与发布注意事项

不要提交 `config.json`、`port.txt`、日志或真实会话数据；扫描应保持只读，服务绑定 loopback。`node build.js --release` 会上传并覆盖 Release 资产，推送 `v*` 标签也会触发桌面发布，仅在明确授权发布时执行。
