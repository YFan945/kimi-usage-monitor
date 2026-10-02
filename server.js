#!/usr/bin/env node
'use strict';
/*
 * Kimi Code 用量监控 — 本地服务（便携版）
 * 扫描一个或多个数据目录下所有会话各 agent 目录的 wire.jsonl，
 * 解析其中的 usage.record 事件（每次 LLM API 调用一条），提供 JSON API + 静态页面。
 * 零依赖，Node >= 18 即可运行：node server.js [--port 43110]
 * 扫描目录保存在程序目录的 config.json 里，拷贝整个文件夹即可移植到其他 Windows 电脑。
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

// SEA 单文件模式检测（KimiMonitor.exe）：资源内嵌、数据/配置写在 exe 旁边
let SEA = null;
try { SEA = require('node:sea'); } catch { }
const isSEA = !!(SEA && typeof SEA.isSea === 'function' && SEA.isSea());
const ASSETS = isSEA ? {
  'index.html': Buffer.from(SEA.getAsset('index.html')),
  'icon.png': Buffer.from(SEA.getAsset('icon.png')),
  'favicon.ico': Buffer.from(SEA.getAsset('favicon.ico')),
  'manifest.webmanifest': Buffer.from(SEA.getAsset('manifest.webmanifest')),
  'icon-192.png': Buffer.from(SEA.getAsset('icon-192.png')),
  'icon-512.png': Buffer.from(SEA.getAsset('icon-512.png')),
} : null;

const HOME = process.env.USERPROFILE || process.env.HOME;
// 配置目录：Windows 单文件 exe → exe 旁（便携）；macOS .app → Application Support；纯 node 运行 → 项目目录
let CONFIG_DIR;
if (isSEA) CONFIG_DIR = path.dirname(process.execPath);
else if (process.platform === 'darwin') CONFIG_DIR = path.join(os.homedir(), 'Library', 'Application Support', 'KimiMonitor');
else CONFIG_DIR = __dirname;
try { fs.mkdirSync(CONFIG_DIR, { recursive: true }); } catch { }
const PUBLIC_DIR = path.join(__dirname, 'public');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

const argvPortIdx = process.argv.indexOf('--port');
const PORT = Number(
  (argvPortIdx > -1 && process.argv[argvPortIdx + 1]) ||
  process.env.KIMI_MONITOR_PORT ||
  43110
);

// ---------- 配置 ----------
const CFG = { roots: [], setupDone: false, shortcut: false };
const DEFAULT_ROOT = path.join(HOME, '.kimi-code', 'sessions');
function loadConfig() {
  try {
    const j = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    if (Array.isArray(j.roots)) CFG.roots = j.roots;
    if (typeof j.setupDone === 'boolean') CFG.setupDone = j.setupDone;
    else if (CFG.roots.length) CFG.setupDone = true; // 旧版配置已选过目录，视为完成引导
    if (typeof j.shortcut === 'boolean') CFG.shortcut = j.shortcut;
  } catch { }
  if (!CFG.roots.length) {
    if (fs.existsSync(DEFAULT_ROOT)) CFG.roots.push(DEFAULT_ROOT); // 首次运行自动使用本机默认目录
  }
  CFG.roots = [...new Set(CFG.roots.map(p => path.normalize(String(p).trim())).filter(Boolean))];
}
loadConfig();
function saveConfig() {
  try { fs.writeFileSync(CONFIG_FILE, JSON.stringify({ port: PORT, roots: CFG.roots, setupDone: !!CFG.setupDone, shortcut: !!CFG.shortcut }, null, 2)); } catch { }
}

// 单文件 exe（SEA）模式下首次运行自动创建桌面快捷方式（仅 Windows；由 config.json 的 shortcut 标记保证只创建一次）
function ensureWinShortcut() {
  if (process.platform !== 'win32' || !isSEA || CFG.shortcut || process.env.KIMI_NO_SHORTCUT) return;
  CFG.shortcut = true;
  saveConfig();
  try {
    const cp = require('child_process');
    const exe = process.execPath;
    const ico = path.join(CONFIG_DIR, 'KimiMonitor.ico');
    try { fs.writeFileSync(ico, ASSETS['favicon.ico']); } catch { }
    const scr = `$d=[Environment]::GetFolderPath('Desktop');$ws=New-Object -ComObject WScript.Shell;$l=$ws.CreateShortcut($d+'\\KimiMonitor.lnk');$l.TargetPath='${exe}';$l.WorkingDirectory='${path.dirname(exe)}';$l.IconLocation='${ico}';$l.Save()`;
    cp.exec(`powershell -NoProfile -ExecutionPolicy Bypass -Command "${scr}"`, { windowsHide: true }, () => { });
  } catch { }
}

// ---------- 关闭 Edge 应用窗口（按页面标题匹配，WM_CLOSE 只关本应用窗口，不影响其他 Edge 标签） ----------
const APP_TITLE = 'Kimi Code 用量监控';
const WIN32_CLOSE_CS = "using System;using System.Runtime.InteropServices;using System.Text;public class Win32Close{public delegate bool EnumProc(IntPtr h,IntPtr l);[DllImport(\"user32.dll\")]public static extern bool EnumWindows(EnumProc cb,IntPtr l);[DllImport(\"user32.dll\")]public static extern int GetWindowText(IntPtr h,StringBuilder t,int n);[DllImport(\"user32.dll\")]public static extern bool PostMessage(IntPtr h,uint m,IntPtr w,IntPtr l);[DllImport(\"user32.dll\")]public static extern bool IsWindowVisible(IntPtr h);public static void CloseByTitle(string title){EnumWindows(delegate(IntPtr h,IntPtr l){if(IsWindowVisible(h)){var sb=new StringBuilder(256);GetWindowText(h,sb,256);if(sb.ToString().Contains(title))PostMessage(h,0x0010,IntPtr.Zero,IntPtr.Zero);}return true;},IntPtr.Zero);}}";
function closeAppWindows() {
  if (process.platform !== 'win32') return;
  try {
    const ps = [
      `Add-Type -TypeDefinition '${WIN32_CLOSE_CS}'`,
      `[Win32Close]::CloseByTitle('${APP_TITLE}')`,
    ].join("\r\n");
    const enc = Buffer.from(ps, 'utf16le').toString('base64');
    const closer = require('child_process').spawn('powershell',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    closer.stdout.resume(); closer.stderr.resume();
    closer.unref();
  } catch { }
}

// ---------- 托盘图标（Windows）：窗口关闭后在后台运行，左键/右键菜单可打开窗口或退出 ----------
function startTray() {
  if (process.platform !== 'win32' || process.env.KIMI_NO_TRAY) return;
  try {
    let ico = path.join(PUBLIC_DIR, 'favicon.ico');
    if (isSEA) {
      ico = path.join(CONFIG_DIR, 'KimiMonitor.ico');
      try { fs.writeFileSync(ico, ASSETS['favicon.ico']); } catch { }
    }
    const ps = [
      `Add-Type -TypeDefinition '${WIN32_CLOSE_CS}'`,
      "Add-Type -AssemblyName System.Windows.Forms",
      "Add-Type -AssemblyName System.Drawing",
      `$ico = New-Object System.Drawing.Icon('${ico.replace(/'/g, "''")}')`,
      "$ni = New-Object System.Windows.Forms.NotifyIcon",
      "$ni.Icon = $ico",
      "$ni.Text = 'KimiMonitor — 点击打开'",
      "$ni.Visible = $true",
      `$base = 'http://127.0.0.1:${PORT}'`,
      "$menu = New-Object System.Windows.Forms.ContextMenuStrip",
      "$openItem = $menu.Items.Add('打开窗口')",
      "$openItem.add_Click({ try { Invoke-RestMethod -Method Post -Uri \"$base/api/open\" | Out-Null } catch {} })",
      "$quitItem = $menu.Items.Add('退出')",
      // 关闭应用窗口 → 按 PID 结束服务 → 立即收起托盘图标
      `$quitItem.add_Click({ [Win32Close]::CloseByTitle('${APP_TITLE}'); try { Stop-Process -Id ${process.pid} -Force -ErrorAction Stop } catch {}; $ni.Visible = $false; $timer.Stop(); [System.Windows.Forms.Application]::Exit() })`,
      "$ni.ContextMenuStrip = $menu",
      "$ni.add_Click({ if ($_.Button -eq [System.Windows.Forms.MouseButtons]::Left) { try { Invoke-RestMethod -Method Post -Uri \"$base/api/open\" | Out-Null } catch {} } })",
      "$timer = New-Object System.Windows.Forms.Timer",
      "$timer.Interval = 3000",
      "$timer.add_Tick({ try { Invoke-RestMethod -Uri \"$base/api/data\" -TimeoutSec 2 | Out-Null } catch { $ni.Visible = $false; $timer.Stop(); [System.Windows.Forms.Application]::Exit() } })",
      "$timer.Start()",
      "[System.Windows.Forms.Application]::Run()",
      "$ni.Dispose()",
    ].join("\r\n");
    const enc = Buffer.from(ps, 'utf16le').toString('base64');
    // 注意：不能用 detached（PowerShell 无控制台会秒退）；stdio 必须是 pipe 并消费掉——
    // 'ignore' 的无效句柄同样会让 powershell 宿主静默退出（exit 0）
    const tray = require('child_process').spawn('powershell',
      ['-NoProfile', '-Sta', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', enc],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    tray.stdout.resume(); tray.stderr.resume();
    tray.unref();
  } catch { }
}
// 引导期对默认目录做一次探测（缓存结果，避免每次轮询都全量扫描）
let defaultProbe = null;
function getDefaultProbe() {
  if (defaultProbe) return defaultProbe;
  const ok = fs.existsSync(DEFAULT_ROOT);
  defaultProbe = { root: DEFAULT_ROOT, ok, stats: ok && !CFG.setupDone ? probeRoot(DEFAULT_ROOT) : null };
  return defaultProbe;
}

// ---------- 缓存 ----------
// wire.jsonl 路径 -> { mtimeMs, size, records: [{t,m,a,i,o,r,c}] }
const wireCache = new Map();
// 会话目录 -> { mtimeMs, state }
const stateCache = new Map();
// session_index.jsonl 路径 -> { mtimeMs, map: sessionId -> workDir }
const indexCache = new Map();
let lastScan = { at: 0, data: null };

function toEpoch(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') { const t = Date.parse(v); return isNaN(t) ? 0 : t; }
  return 0;
}

// session_index.jsonl: sessionId -> workDir（state.json 缺 cwd 时的兜底）；
// 可能在数据目录本身或其上一级（.kimi-code 目录）
function loadIndexFor(root) {
  const candidates = [path.join(root, 'session_index.jsonl'), path.join(root, '..', 'session_index.jsonl')];
  for (const file of candidates) {
    let st;
    try { st = fs.statSync(file); } catch { continue; }
    const hit = indexCache.get(file);
    if (hit && hit.mtimeMs === st.mtimeMs) return hit.map;
    const map = new Map();
    try {
      for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try { const j = JSON.parse(line); if (j.sessionId) map.set(j.sessionId, j.workDir || ''); } catch { }
      }
    } catch { }
    indexCache.set(file, { mtimeMs: st.mtimeMs, map });
    return map;
  }
  return new Map();
}

// ---------- 解析 ----------
function listDir(p) {
  try { return fs.readdirSync(p, { withFileTypes: true }); } catch { return []; }
}

function parseWireFile(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const out = [];
  for (const line of text.split('\n')) {
    if (!line.includes('usage.record')) continue;
    try {
      const ev = JSON.parse(line);
      if (ev.type !== 'usage.record' || !ev.usage) continue;
      out.push({
        t: typeof ev.time === 'number' ? ev.time : 0,
        m: ev.model || 'unknown',
        a: ev.agentId || 'main',
        i: tokenCount(ev.usage.inputOther),
        o: tokenCount(ev.usage.output),
        r: tokenCount(ev.usage.inputCacheRead),
        c: tokenCount(ev.usage.inputCacheCreation),
      });
    } catch { /* 跳过损坏行 */ }
  }
  return out;
}

function tokenCount(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function readState(sessDir) {
  const file = path.join(sessDir, 'state.json');
  let st;
  try { st = fs.statSync(file); } catch { return { mtimeMs: 0, state: null }; }
  const hit = stateCache.get(sessDir);
  if (hit && hit.mtimeMs === st.mtimeMs) return hit;
  let state = null;
  try { state = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { }
  const entry = { mtimeMs: st.mtimeMs, state };
  stateCache.set(sessDir, entry);
  return entry;
}

// 扫描单个会话目录（内含 state.json 与 agents/）
function scanSession(sessPath, sessName, index, sessions, records, seen, seenSessions) {
  try { sessPath = fs.realpathSync(sessPath); } catch { return; }
  const key = process.platform === 'win32' ? sessPath.toLowerCase() : sessPath;
  if (seenSessions.has(key)) return;
  seenSessions.add(key);
  const { state } = readState(sessPath);
  const sessIdx = sessions.length;
  sessions.push({
    id: sessName,
    cwd: (state && state.cwd) || index.get(sessName) || '',
    title: (state && state.title) || '',
    createdAt: toEpoch(state && state.createdAt),
    updatedAt: toEpoch(state && state.updatedAt),
  });
  const agentsDir = path.join(sessPath, 'agents');
  for (const ag of listDir(agentsDir)) {
    if (!ag.isDirectory()) continue;
    const wire = path.join(agentsDir, ag.name, 'wire.jsonl');
    let st;
    try { st = fs.statSync(wire); } catch { continue; }
    seen.add(wire);
    let entry = wireCache.get(wire);
    if (!entry || entry.mtimeMs !== st.mtimeMs || entry.size !== st.size) {
      entry = { mtimeMs: st.mtimeMs, size: st.size, records: parseWireFile(wire) };
      wireCache.set(wire, entry);
    }
    for (const r of entry.records) records.push(Object.assign({ s: sessIdx }, r));
  }
}

// 扫描一个数据目录。兼容两种布局：
//   root\<工作区>\<会话>\...   （.kimi-code\sessions 原生结构）
//   root\<会话>\...            （直接指向某个 sessions 子目录或备份）
function scanRoot(root, sessions, records, seen, seenSessions = new Set()) {
  const index = loadIndexFor(root);
  for (const d of listDir(root)) {
    if (!d.isDirectory()) continue;
    const p1 = path.join(root, d.name);
    if (fs.existsSync(path.join(p1, 'state.json')) || fs.existsSync(path.join(p1, 'agents'))) { scanSession(p1, d.name, index, sessions, records, seen, seenSessions); continue; }
    for (const d2 of listDir(p1)) {
      if (!d2.isDirectory()) continue;
      const p2 = path.join(p1, d2.name);
      if (fs.existsSync(path.join(p2, 'state.json')) || fs.existsSync(path.join(p2, 'agents'))) scanSession(p2, d2.name, index, sessions, records, seen, seenSessions);
    }
  }
}

function scan() {
  const seen = new Set();
  const seenSessions = new Set();
  const sessions = [];
  const records = [];
  for (const root of CFG.roots) scanRoot(root, sessions, records, seen, seenSessions);
  for (const k of wireCache.keys()) if (!seen.has(k)) wireCache.delete(k);
  return { sessions, records };
}

function probeRoot(root) {
  const sessions = [], records = [], seen = new Set();
  try { scanRoot(root, sessions, records, seen); } catch { }
  return { path: root, ok: fs.existsSync(root), sessions: sessions.length, records: records.length };
}

function getData() {
  const now = Date.now();
  if (lastScan.data && now - lastScan.at < 800) return lastScan.data; // 限流
  const data = scan();
  lastScan = { at: now, data };
  return data;
}

// ---------- HTTP ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };

function json(res, body, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  let url, decodedPath;
  try {
    url = new URL(req.url, 'http://127.0.0.1');
    decodedPath = decodeURIComponent(url.pathname);
  } catch {
    json(res, { error: '请求路径无效' }, 400);
    return;
  }
  if (url.pathname === '/api/data') {
    let body;
    try {
      const d = getData();
      const dp = getDefaultProbe();
      body = JSON.stringify({ generatedAt: Date.now(), roots: CFG.roots, setupDone: !!CFG.setupDone, defaultRoot: dp.root, defaultOk: dp.ok, defaultStats: dp.stats, sessions: d.sessions, records: d.records });
    } catch (e) {
      body = JSON.stringify({ generatedAt: Date.now(), roots: CFG.roots, setupDone: !!CFG.setupDone, sessions: [], records: [], error: String(e && e.message || e) });
    }
    json(res, body);
    return;
  }
  if (url.pathname === '/api/config' && req.method === 'POST') {
    let raw = '';
    let size = 0, tooLarge = false;
    req.setEncoding('utf8');
    req.on('data', c => {
      size += Buffer.byteLength(c);
      if (tooLarge) return;
      if (size > 1024 * 1024) {
        tooLarge = true;
        raw = '';
        json(res, { error: '配置请求过大' }, 413);
        return;
      }
      raw += c;
    });
    req.on('end', () => {
      if (tooLarge) return;
      let roots, setupDone;
      try {
        const j = JSON.parse(raw);
        if (!j || !Array.isArray(j.roots) || !j.roots.every(p => typeof p === 'string') ||
            (j.setupDone !== undefined && typeof j.setupDone !== 'boolean')) throw new Error('invalid config');
        roots = j.roots;
        if (typeof j.setupDone === 'boolean') setupDone = j.setupDone;
      } catch {
        json(res, { error: '配置需要 roots 字符串数组及可选的 setupDone 布尔值' }, 400);
        return;
      }
      roots = [...new Set(roots.map(p => path.normalize(String(p).trim())).filter(Boolean))];
      const stats = roots.map(probeRoot);
      CFG.roots = roots.filter((_, i) => stats[i].ok);
      if (typeof setupDone === 'boolean') CFG.setupDone = setupDone;
      else CFG.setupDone = CFG.setupDone || CFG.roots.length > 0;
      saveConfig();
      wireCache.clear(); stateCache.clear(); indexCache.clear(); defaultProbe = null;
      lastScan = { at: 0, data: null };
      json(res, { ok: true, roots: CFG.roots, setupDone: !!CFG.setupDone, stats });
    });
    return;
  }
  if (url.pathname === '/api/open' && req.method === 'POST') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('ok');
    openBrowser(`http://127.0.0.1:${PORT}/`);
    return;
  }
  if (url.pathname === '/api/quit' && req.method === 'POST') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('bye');
    closeAppWindows(); // 连 Edge 应用窗口一起关闭（托盘退出路径由托盘脚本自行关闭）
    setTimeout(() => process.exit(0), 150);
    return;
  }
  let p = decodedPath === '/' ? '/index.html' : decodedPath;
  p = path.normalize(p).replace(/^([/\\]|\.\.[/\\])+/g, '');
  if (isSEA && ASSETS[p]) {
    res.writeHead(200, { 'Content-Type': MIME[path.extname(p)] || 'application/octet-stream' });
    res.end(ASSETS[p]);
    return;
  }
  const file = path.join(PUBLIC_DIR, p);
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('404 Not Found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(buf);
  });
});

function openBrowser(u) {
  if (process.platform !== 'win32') {
    try { require('child_process').spawn('open', [u], { detached: true, stdio: 'ignore' }).unref(); } catch { }
    return;
  }
  const pf86 = process.env['ProgramFiles(x86)'] || '';
  const edge = path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe');
  const edge64 = path.join(process.env.ProgramFiles || '', 'Microsoft', 'Edge', 'Application', 'msedge.exe');
  const cp = require('child_process');
  try {
    if (fs.existsSync(edge)) cp.spawn(edge, ['--app=' + u, '--window-size=1280,900'], { detached: true, stdio: 'ignore' }).unref();
    else if (fs.existsSync(edge64)) cp.spawn(edge64, ['--app=' + u, '--window-size=1280,900'], { detached: true, stdio: 'ignore' }).unref();
    else cp.spawn('cmd', ['/c', 'start', '', u], { detached: true, stdio: 'ignore' }).unref();
  } catch { }
}

// GUI 子系统（无控制台窗口）下 stdout 无效，写日志必须兜异常
const log = (...a) => { try { console.log(...a); } catch { } };
const logErr = (...a) => { try { console.error(...a); } catch { } };

server.on('error', e => {
  if (e && e.code === 'EADDRINUSE') {
    log(`[kimi-usage-monitor] 端口 ${PORT} 已被占用（可能服务已在运行），直接复用。`);
    if (isSEA && !process.env.KIMI_NO_OPEN) openBrowser(`http://127.0.0.1:${PORT}/`);
    process.exit(0);
  }
  logErr('[kimi-usage-monitor] 启动失败:', e);
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', () => {
  try { if (process.platform === 'win32') fs.writeFileSync(path.join(CONFIG_DIR, 'port.txt'), String(PORT)); } catch { }
  log(`[kimi-usage-monitor] http://127.0.0.1:${PORT}`);
  log(`[kimi-usage-monitor] 数据目录: ${CFG.roots.join(' ; ') || '(未配置，请打开页面右上角"数据目录"添加)'}`);
  ensureWinShortcut();
  startTray();
  if (isSEA && !process.env.KIMI_NO_OPEN) openBrowser(`http://127.0.0.1:${PORT}/`);
});
