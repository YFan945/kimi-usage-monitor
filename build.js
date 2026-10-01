#!/usr/bin/env node
'use strict';
/*
 * Kimi-CodeMonitor 一键打包脚本（零依赖，Node >= 20）
 * 用法：
 *   node build.js            构建全部 Windows 产物到 dist\（单文件 exe + 安装包 + 绿色版 zip）+ 冒烟测试
 *   node build.js --mac      额外构建 macOS .app 包（需联网下载 node 官方二进制，约 100MB）
 *   node build.js --release  构建后把产物上传到 GitHub Release v<版本号>（已有则覆盖资产）
 * 版本号统一在 packaging/installer.iss 的 #define MyAppVersion 处修改。
 */
const { spawnSync, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');
const MAC_NODE_VER = 'v22.23.3'; // macOS 包内置的 node 版本（官方 tarball）
const REPO = 'YFan945/kimi-usage-monitor';
const args = new Set(process.argv.slice(2));
const WANT_MAC = args.has('--mac');
const WANT_RELEASE = args.has('--release');

const log = (...a) => console.log('\x1b[36m[build]\x1b[0m', ...a);
const ok = (...a) => console.log('\x1b[32m[build]\x1b[0m ✓', ...a);
const die = m => { console.error('\x1b[31m[build] ✗ ' + m + '\x1b[0m'); process.exit(1); };
function run(cmd, cmdArgs, opts = {}) {
  const r = spawnSync(cmd, cmdArgs, { stdio: 'inherit', ...opts });
  if (r.status !== 0) die(`${cmd} ${cmdArgs.join(' ')} 失败（exit ${r.status}）`);
}
function which(candidates) { // 依次在候选路径中找存在的文件
  for (const p of candidates) if (p && fs.existsSync(p)) return p;
  return null;
}
// Windows 自带 bsdtar：支持 C:\ 路径（PATH 里的 Git Bash GNU tar 会把 C:\ 当远程主机，报 "Cannot connect to C:"）
const TAR = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
function httpReq(method, url) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method }, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    req.on('error', reject);
    req.end();
  });
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {

  // ---------- 0. 版本号 ----------
  const issText = fs.readFileSync(path.join(ROOT, 'packaging', 'installer.iss'), 'utf8');
  const VER = (issText.match(/#define MyAppVersion "([^"]+)"/) || [])[1];
  if (!VER) die('无法从 packaging/installer.iss 读取 MyAppVersion');
  log(`====== Kimi-CodeMonitor v${VER} ======`);

  // dist 只做已知产物的 best-effort 清理（可能有用户正在下载等外部占用，不整体删除）
  for (const f of ['KimiMonitor.exe', `KimiMonitor-Setup-${VER}.exe`, 'KimiMonitor-Windows-x64.exe', 'sea-prep.blob', 'config.json', 'port.txt', 'KimiMonitor.ico', 'notes.md'])
    fs.rmSync(path.join(DIST, f), { force: true, recursive: true });
  fs.mkdirSync(DIST, { recursive: true });

  // ---------- 1. Windows 单文件 exe（Node SEA） ----------
  log('生成 SEA blob...');
  run('node', ['--experimental-sea-config', 'sea-config.json'], { cwd: ROOT });

  const nodeExe = process.execPath;
  fs.copyFileSync(nodeExe, path.join(DIST, 'KimiMonitor.exe'));
  const fuse = (fs.readFileSync(nodeExe).toString('latin1').match(/NODE_SEA_FUSE_[0-9a-f]{32}/) || [])[0];
  if (!fuse) die('node.exe 中未找到 NODE_SEA_FUSE 哨兵（Node 版本过旧？需 >= 20.12）');
  log('哨兵 fuse =', fuse);

  log('注入 postject（约半分钟）...');
  run('npx', ['-y', 'postject', 'dist/KimiMonitor.exe', 'NODE_SEA_BLOB', 'sea-prep.blob', '--sentinel-fuse', fuse], { cwd: ROOT, shell: true });
  ok(`dist/KimiMonitor.exe（${(fs.statSync(path.join(DIST, 'KimiMonitor.exe')).size / 1048576).toFixed(1)} MB）`);

  // ---------- 2. 冒烟测试 ----------
  log('冒烟测试：启动单文件 exe...');
  {
    const port = 40000 + Math.floor(Math.random() * 20000);
    const child = spawn(path.join(DIST, 'KimiMonitor.exe'), ['--port', String(port)], {
      cwd: DIST, stdio: 'ignore',
      env: { ...process.env, KIMI_NO_OPEN: '1', KIMI_NO_SHORTCUT: '1' },
    });
    let up = false;
    for (let i = 0; i < 30 && !up; i++) {
      await sleep(300);
      try { up = (await httpReq('GET', `http://127.0.0.1:${port}/api/data`)).status === 200; } catch { }
    }
    if (!up) { try { child.kill(); } catch { } die('冒烟测试失败：服务未在 10 秒内就绪'); }
    await httpReq('POST', `http://127.0.0.1:${port}/api/quit`).catch(() => { });
    await sleep(800);
    try { child.kill(); } catch { }
  }
  for (const f of ['config.json', 'port.txt', 'KimiMonitor.ico']) // 清理测试残留
    fs.rmSync(path.join(DIST, f), { force: true });
  ok('服务可启动、API 正常（测试残留已清理）');

  // ---------- 3. Windows 安装包（Inno Setup） ----------
  const iscc = which([
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'InnoSetup7', 'ISCC.exe'),
    'C:\\Program Files (x86)\\Inno Setup 7\\ISCC.exe',
    'C:\\Program Files\\Inno Setup 7\\ISCC.exe',
    'C:\\Program Files (x86)\\Inno Setup 6\\ISCC.exe',
    'C:\\Program Files\\Inno Setup 6\\ISCC.exe',
  ]);
  if (iscc) {
    log('构建安装包（Inno Setup）...');
    run(iscc, [path.join(ROOT, 'packaging', 'installer.iss')]);
    ok(`dist/KimiMonitor-Setup-${VER}.exe`);
  } else {
    console.warn('\x1b[33m[build] ! 未找到 ISCC.exe，跳过安装包。安装 Inno Setup 后重跑即可。\x1b[0m');
  }

  // ---------- 4. Windows 绿色版 zip ----------
  log('打包绿色版 zip...');
  {
    const stage = path.join(os.tmpdir(), 'kimi-monitor-portable');
    fs.rmSync(stage, { recursive: true, force: true });
    fs.mkdirSync(path.join(stage, 'runtime'), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'server.js'), path.join(stage, 'server.js'));
    fs.copyFileSync(path.join(ROOT, 'README.md'), path.join(stage, 'README.md'));
    fs.copyFileSync(path.join(ROOT, 'LICENSE'), path.join(stage, 'LICENSE'));
    fs.cpSync(path.join(ROOT, 'public'), path.join(stage, 'public'), { recursive: true });
    for (const f of fs.readdirSync(ROOT)) if (f.endsWith('.bat')) fs.copyFileSync(path.join(ROOT, f), path.join(stage, f));
    fs.copyFileSync(nodeExe, path.join(stage, 'runtime', 'node.exe'));
    const zipPath = path.join(DIST, 'KimiMonitor-Windows-Portable.zip');
    const zipPy = 'import os,sys,zipfile\nst,out=sys.argv[1],sys.argv[2]\nwith zipfile.ZipFile(out,"w",zipfile.ZIP_DEFLATED) as z:\n  for root,dirs,files in os.walk(st):\n    for f in files:\n      p=os.path.join(root,f)\n      z.write(p, os.path.relpath(p,st))\nprint("zipped")';
    let done = false;
    for (const py of ['python', 'py']) {
      const r = spawnSync(py, ['-c', zipPy, stage, zipPath], { encoding: 'utf8' });
      if (r.status === 0) { done = true; break; }
    }
    if (!done) { // 兜底：PowerShell（node.exe 被杀软占用时可能失败，建议装 Python）
      run('powershell', ['-NoProfile', '-Command', `Compress-Archive -Path '${stage}\\*' -DestinationPath '${zipPath}' -Force`]);
    }
    fs.rmSync(stage, { recursive: true, force: true });
    ok(`dist/KimiMonitor-Windows-Portable.zip（${(fs.statSync(zipPath).size / 1048576).toFixed(1)} MB）`);
  }

  // ---------- 5. macOS .app 包（可选） ----------
  if (WANT_MAC) {
    log(`构建 macOS 包（下载 node ${MAC_NODE_VER} 双架构，约 100MB）...`);
    const stage = path.join(os.tmpdir(), 'kimi-macbuild');
    fs.rmSync(stage, { recursive: true, force: true });
    fs.mkdirSync(stage, { recursive: true });
    for (const arch of ['arm64', 'x64']) {
      const tgz = path.join(stage, `node-darwin-${arch}.tar.gz`);
      run('curl', ['-sL', '-o', tgz, `https://nodejs.org/download/release/${MAC_NODE_VER}/node-${MAC_NODE_VER}-darwin-${arch}.tar.gz`]);
      run(TAR, ['-xzf', tgz, '-C', stage, `node-${MAC_NODE_VER}-darwin-${arch}/bin/node`]);
      fs.renameSync(path.join(stage, `node-${MAC_NODE_VER}-darwin-${arch}`, 'bin', 'node'), path.join(stage, `node-darwin-${arch}`));
      fs.rmSync(path.join(stage, `node-${MAC_NODE_VER}-darwin-${arch}`), { recursive: true, force: true });
      fs.rmSync(tgz, { force: true });
    }
    const app = path.join(stage, 'Kimi-CodeMonitor.app');
    fs.mkdirSync(path.join(app, 'Contents', 'MacOS'), { recursive: true });
    fs.mkdirSync(path.join(app, 'Contents', 'Resources', 'bin'), { recursive: true });
    fs.mkdirSync(path.join(app, 'Contents', 'Resources', 'app'), { recursive: true });
    fs.copyFileSync(path.join(stage, 'node-darwin-arm64'), path.join(app, 'Contents', 'Resources', 'bin', 'node-darwin-arm64'));
    fs.copyFileSync(path.join(stage, 'node-darwin-x64'), path.join(app, 'Contents', 'Resources', 'bin', 'node-darwin-x64'));
    fs.copyFileSync(path.join(ROOT, 'server.js'), path.join(app, 'Contents', 'Resources', 'app', 'server.js'));
    fs.cpSync(path.join(ROOT, 'public'), path.join(app, 'Contents', 'Resources', 'app', 'public'), { recursive: true });
    fs.writeFileSync(path.join(app, 'Contents', 'MacOS', 'kimi-monitor'), `#!/bin/bash
# Kimi-CodeMonitor — macOS 启动器：选择对应架构的 node 运行 server.js，并打开浏览器
DIR="$(cd "$(dirname "$0")" && pwd)"
RES="$DIR/../Resources"
case "$(uname -m)" in
  arm64) NODE_BIN="$RES/bin/node-darwin-arm64" ;;
  *)     NODE_BIN="$RES/bin/node-darwin-x64" ;;
esac
CFG="$HOME/Library/Application Support/KimiMonitor"
mkdir -p "$CFG"
PORT=43110
[ -f "$CFG/port.txt" ] && PORT=$(cat "$CFG/port.txt")
"$NODE_BIN" "$RES/app/server.js" --port "$PORT" >> "$CFG/server.log" 2>&1 &
sleep 3
open "http://127.0.0.1:$PORT/"
`);
    fs.writeFileSync(path.join(app, 'Contents', 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>CFBundleName</key><string>Kimi-CodeMonitor</string>
\t<key>CFBundleDisplayName</key><string>Kimi-CodeMonitor</string>
\t<key>CFBundleIdentifier</key><string>com.yfan945.kimi-monitor</string>
\t<key>CFBundleVersion</key><string>${VER}</string>
\t<key>CFBundleShortVersionString</key><string>${VER}</string>
\t<key>CFBundleExecutable</key><string>kimi-monitor</string>
\t<key>CFBundleIconFile</key><string>icon.icns</string>
\t<key>CFBundlePackageType</key><string>APPL</string>
\t<key>CFBundleInfoDictionaryVersion</key><string>6.0</string>
\t<key>LSMinimumSystemVersion</key><string>11.0</string>
\t<key>NSHighResolutionCapable</key><true/>
\t<key>LSApplicationCategoryType</key><string>public.app-category.utilities</string>
</dict>
</plist>
`);
    fs.writeFileSync(path.join(stage, '卸载.command'), `#!/bin/bash
# Kimi-CodeMonitor 卸载脚本
pkill -f "node-darwin.*/Kimi-CodeMonitor.app" 2>/dev/null
rm -rf "/Applications/Kimi-CodeMonitor.app" "$HOME/Library/Application Support/Kimi-CodeMonitor"
echo "Kimi-CodeMonitor 已卸载。"
`);
    const icns = path.join(app, 'Contents', 'Resources', 'icon.icns');
    const r = spawnSync('python', ['-c', 'from PIL import Image;import sys;Image.open(sys.argv[1]).save(sys.argv[2])', path.join(ROOT, 'icon-512.png'), icns]);
    if (r.status === 0) ok('icon.icns 已生成');
    else console.warn('\x1b[33m[build] ! 缺少 Python/PIL，mac 包暂无图标\x1b[0m');
    // 用 python tarfile 打包以便精确控制 Unix 权限（Windows chmod 无法设置可执行位）
    const tarPy = `import os,sys,tarfile
stage,out=sys.argv[1],sys.argv[2]
def add(tf,p,arc,mode):
    ti=tf.gettarinfo(p,arcname=arc); ti.mode=mode; ti.uid=ti.gid=0; ti.uname=ti.gname="root"
    if ti.isdir():
        tf.addfile(ti)
        for c in sorted(os.listdir(p)): add(tf,os.path.join(p,c),arc+"/"+c,mode)
    else:
        with open(p,"rb") as f: tf.addfile(ti,f)
with tarfile.open(out,"w:gz") as tf:
    add(tf,os.path.join(stage,"Kimi-CodeMonitor.app"),"Kimi-CodeMonitor.app",0o755)
    add(tf,os.path.join(stage,"卸载.command"),"卸载.command",0o755)
print("tared")`;
    const macTgz = path.join(DIST, 'Kimi-Monitor-macOS.tar.gz');
    let tarOk = false;
    for (const py of ['python', 'py']) {
      const rr = spawnSync(py, ['-c', tarPy, stage, macTgz], { encoding: 'utf8' });
      if (rr.status === 0) { tarOk = true; break; }
    }
    if (!tarOk) die('macOS tar 打包失败（需要 Python）');
    fs.rmSync(stage, { recursive: true, force: true });
    ok(`dist/Kimi-Monitor-macOS.tar.gz（${(fs.statSync(macTgz).size / 1048576).toFixed(1)} MB）`);
  }

  // ---------- 6. 发布资产清单（统一在 dist/） ----------
  fs.copyFileSync(path.join(DIST, 'KimiMonitor.exe'), path.join(DIST, 'KimiMonitor-Windows-x64.exe'));
  const assets = [path.join(DIST, 'KimiMonitor-Windows-x64.exe')];
  if (fs.existsSync(path.join(DIST, `KimiMonitor-Setup-${VER}.exe`))) assets.push(path.join(DIST, `KimiMonitor-Setup-${VER}.exe`));
  assets.push(path.join(DIST, 'KimiMonitor-Windows-Portable.zip'));
  if (WANT_MAC) assets.push(path.join(DIST, 'Kimi-Monitor-macOS.tar.gz'));
  ok('产物已生成到 dist/：');
  for (const f of assets)
    console.log(`   ${path.basename(f)}  (${(fs.statSync(f).size / 1048576).toFixed(1)} MB)`);

  // ---------- 7. 上传 GitHub Release（可选） ----------
  if (WANT_RELEASE) {
    const tag = `v${VER}`;
    log(`上传到 GitHub Release ${tag}...`);
    const notes = `Kimi-CodeMonitor v${VER} 自动发布。\n\n| 文件 | 平台 | 说明 |\n|---|---|---|\n| KimiMonitor-Setup-${VER}.exe | Windows 10/11 x64 | 安装版（推荐） |\n| KimiMonitor-Windows-x64.exe | Windows | 便携单文件版 |\n| KimiMonitor-Windows-Portable.zip | Windows | 绿色文件夹版（含 node.exe） |\n${WANT_MAC ? '| Kimi-Monitor-macOS.tar.gz | macOS 11+ 双架构 | 解压拖入应用程序 |\n' : ''}\n完整说明见 [README](https://github.com/YFan945/kimi-usage-monitor#readme)。`;
    const notesFile = path.join(DIST, 'notes.md');
    fs.writeFileSync(notesFile, notes);
    const exists = spawnSync('gh', ['release', 'view', tag, '--repo', REPO], { stdio: 'ignore', shell: true }).status === 0;
    if (exists) run('gh', ['release', 'upload', tag, ...assets, '--clobber', '--repo', REPO], { shell: true });
    else run('gh', ['release', 'create', tag, ...assets, '--repo', REPO, '--title', tag, '--notes-file', notesFile], { shell: true });
    ok(`Release ${tag} 已更新：https://github.com/YFan945/kimi-usage-monitor/releases/tag/${tag}`);
  }

  ok(`====== v${VER} 打包完成 ======`);

})().catch(e => die(e && e.message || e));
