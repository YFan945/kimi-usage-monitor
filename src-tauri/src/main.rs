#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// KimiMonitor 桌面版（Tauri v2）：
// Rust 内核完整移植原 server.js 数据引擎（扫描 wire.jsonl / 聚合 usage.record），
// 内嵌 HTTP 服务（127.0.0.1:43110，被占用时回退随机端口），原生托盘（打开窗口/退出），
// 关窗 = 隐藏到后台，托盘退出 = 彻底退出。不再依赖 PowerShell / Edge --app。

use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

const APP_TITLE: &str = "Kimi Code 用量监控";
const PORT: u16 = 43110; // 优先端口；被占用时自动回退随机端口

const INDEX_HTML: &[u8] = include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/../public/index.html"));
const ICON_PNG: &[u8] = include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/../public/icon.png"));
const FAVICON_ICO: &[u8] = include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/../public/favicon.ico"));
const MANIFEST_WEBMANIFEST: &[u8] = include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/../public/manifest.webmanifest"));
const ICON_192: &[u8] = include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/../public/icon-192.png"));
const ICON_512: &[u8] = include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/../public/icon-512.png"));

// ---------- 数据结构 ----------
#[derive(Clone)]
struct Rec {
    s: usize,
    t: i64,
    m: String,
    a: String,
    i: i64,
    o: i64,
    r: i64,
    c: i64,
}

#[derive(Clone)]
struct Session {
    id: String,
    cwd: String,
    title: String,
    created_at: i64,
    updated_at: i64,
}

#[derive(Default)]
struct Config {
    roots: Vec<String>,
    setup_done: bool,
}

#[derive(Default)]
struct Engine {
    config_dir: PathBuf,
    cfg: Config,
    // wire.jsonl 路径 -> (mtime_ms, size, records)
    wire_cache: HashMap<PathBuf, (i64, u64, Vec<Rec>)>,
    // 会话目录 -> (mtime_ms, state.json Value)
    state_cache: HashMap<PathBuf, (i64, Option<Value>)>,
    // session_index.jsonl 路径 -> (mtime_ms, sessionId -> workDir)
    index_cache: HashMap<PathBuf, (i64, HashMap<String, String>)>,
    // 800ms 限流：缓存的 /api/data 响应
    last_scan: Option<(Instant, String)>,
    default_probe: Option<(bool, Option<Value>)>,
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn token_count(v: &Value) -> i64 {
    v.as_i64().filter(|n| *n >= 0 && *n <= 9_007_199_254_740_991).unwrap_or(0)
}

fn valid_config(body: &Value) -> bool {
    body.get("roots").and_then(Value::as_array)
        .map(|roots| roots.iter().all(Value::is_string)).unwrap_or(false)
        && body.get("setupDone").map(Value::is_boolean).unwrap_or(true)
}

fn file_mtime(p: &Path) -> Option<i64> {
    std::fs::metadata(p)
        .ok()?
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|d| d.as_millis() as i64)
}

// state.json 里 createdAt/updatedAt 的解析：数值直传，字符串按 RFC3339 / 本地时间兜底
fn to_epoch(v: &Value) -> i64 {
    match v {
        Value::Number(n) => n.as_i64().or_else(|| n.as_f64().map(|f| f as i64)).unwrap_or(0),
        Value::String(s) => parse_iso(s),
        _ => 0,
    }
}

fn parse_iso(s: &str) -> i64 {
    let t = s.trim();
    use chrono::TimeZone;
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(t) {
        return dt.timestamp_millis();
    }
    for fmt in ["%Y-%m-%dT%H:%M:%S%.f", "%Y-%m-%d %H:%M:%S%.f", "%Y/%m/%d %H:%M:%S%.f"] {
        if let Ok(naive) = chrono::NaiveDateTime::parse_from_str(t, fmt) {
            return chrono::Local
                .from_local_datetime(&naive)
                .single()
                .map(|d| d.timestamp_millis())
                .unwrap_or(0);
        }
    }
    if let Ok(d) = chrono::NaiveDate::parse_from_str(t, "%Y-%m-%d") {
        let naive = d.and_hms_opt(0, 0, 0).unwrap();
        return chrono::Local
            .from_local_datetime(&naive)
            .single()
            .map(|d| d.timestamp_millis())
            .unwrap_or(0);
    }
    0
}

impl Engine {
    fn new(config_dir: PathBuf) -> Self {
        let mut e = Engine::default();
        e.config_dir = config_dir;
        e.load_config();
        e
    }

    fn config_file(&self) -> PathBuf {
        self.config_dir.join("config.json")
    }

    fn default_root() -> String {
        let home = std::env::var("USERPROFILE")
            .or_else(|_| std::env::var("HOME"))
            .unwrap_or_default();
        Path::new(&home).join(".kimi-code").join("sessions").to_string_lossy().to_string()
    }

    fn load_config(&mut self) {
        self.cfg = Config::default();
        if let Ok(text) = std::fs::read_to_string(self.config_file()) {
            if let Ok(j) = serde_json::from_str::<Value>(&text) {
                if let Some(a) = j.get("roots").and_then(|v| v.as_array()) {
                    self.cfg.roots = a.iter().filter_map(|x| x.as_str().map(String::from)).collect();
                }
                if let Some(b) = j.get("setupDone").and_then(|v| v.as_bool()) {
                    self.cfg.setup_done = b;
                } else if !self.cfg.roots.is_empty() {
                    self.cfg.setup_done = true; // 旧版配置已选过目录，视为完成引导
                }
            }
        }
        if self.cfg.roots.is_empty() {
            let d = Self::default_root();
            if Path::new(&d).exists() {
                self.cfg.roots.push(d); // 首次运行自动使用本机默认目录
            }
        }
        self.cfg.roots = self.cfg.roots.iter().map(|p| p.trim().to_string()).filter(|p| !p.is_empty()).collect();
        self.cfg.roots.dedup();
    }

    fn save_config(&self) {
        let body = json!({"roots": self.cfg.roots, "setupDone": self.cfg.setup_done});
        let _ = std::fs::create_dir_all(&self.config_dir);
        let _ = std::fs::write(self.config_file(), serde_json::to_string_pretty(&body).unwrap_or_default());
    }

    // session_index.jsonl: sessionId -> workDir（state.json 缺 cwd 时的兜底）；
    // 可能在数据目录本身或其上一级（.kimi-code 目录）
    fn load_index_for(&mut self, root: &Path) -> HashMap<String, String> {
        let candidates = [root.join("session_index.jsonl"), root.parent().unwrap_or(root).join("session_index.jsonl")];
        for file in candidates {
            let Some(mtime) = file_mtime(&file) else { continue };
            if let Some((m, map)) = self.index_cache.get(&file) {
                if *m == mtime {
                    return map.clone();
                }
            }
            let mut map = HashMap::new();
            if let Ok(text) = std::fs::read_to_string(&file) {
                for line in text.lines() {
                    if line.trim().is_empty() {
                        continue;
                    }
                    if let Ok(j) = serde_json::from_str::<Value>(line) {
                        if let Some(id) = j.get("sessionId").and_then(|v| v.as_str()) {
                            let wd = j.get("workDir").and_then(|v| v.as_str()).unwrap_or("");
                            map.insert(id.to_string(), wd.to_string());
                        }
                    }
                }
            }
            self.index_cache.insert(file, (mtime, map.clone()));
            return map;
        }
        HashMap::new()
    }

    fn parse_wire_file(file: &Path) -> Vec<Rec> {
        let Ok(text) = std::fs::read_to_string(file) else { return Vec::new() };
        let mut out = Vec::new();
        for line in text.lines() {
            if !line.contains("usage.record") {
                continue;
            }
            let Ok(ev) = serde_json::from_str::<Value>(line) else { continue };
            if ev.get("type").and_then(|v| v.as_str()) != Some("usage.record") {
                continue;
            }
            let Some(u) = ev.get("usage") else { continue };
            out.push(Rec {
                s: 0, // 扫描会话时设置索引，缓存记录不绑定会话顺序
                t: ev.get("time").and_then(|v| v.as_i64()).unwrap_or(0),
                m: ev.get("model").and_then(|v| v.as_str()).unwrap_or("unknown").to_string(),
                a: ev.get("agentId").and_then(|v| v.as_str()).unwrap_or("main").to_string(),
                i: token_count(&u["inputOther"]),
                o: token_count(&u["output"]),
                r: token_count(&u["inputCacheRead"]),
                c: token_count(&u["inputCacheCreation"]),
            });
        }
        out
    }

    fn read_state(&mut self, sess_dir: &Path) -> Option<Value> {
        let file = sess_dir.join("state.json");
        let mtime = file_mtime(&file)?;
        if let Some((m, state)) = self.state_cache.get(sess_dir) {
            if *m == mtime {
                return state.clone();
            }
        }
        let state = std::fs::read_to_string(&file).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok());
        self.state_cache.insert(sess_dir.to_path_buf(), (mtime, state.clone()));
        state
    }

    // 扫描含 agents/ 的会话；state.json 可缺省，项目目录由可找到的索引兜底
    fn scan_session(&mut self, sess_path: &Path, sess_name: &str, index: &HashMap<String, String>, sessions: &mut Vec<Session>, records: &mut Vec<Rec>, seen: &mut HashMap<PathBuf, ()>, seen_sessions: &mut HashSet<PathBuf>) {
        let Ok(canonical) = std::fs::canonicalize(sess_path) else { return };
        let key = if cfg!(windows) { PathBuf::from(canonical.to_string_lossy().to_lowercase()) } else { canonical.clone() };
        if !seen_sessions.insert(key) { return; }
        let sess_path = canonical.as_path();
        let state = self.read_state(sess_path);
        let sess_idx = sessions.len();
        sessions.push(Session {
            id: sess_name.to_string(),
            cwd: state.as_ref()
                .and_then(|s| s.get("cwd").and_then(|v| v.as_str()).map(String::from))
                .or_else(|| index.get(sess_name).cloned())
                .unwrap_or_default(),
            title: state.as_ref().and_then(|s| s.get("title").and_then(|v| v.as_str()).map(String::from)).unwrap_or_default(),
            created_at: state.as_ref().map(|s| to_epoch(s.get("createdAt").unwrap_or(&Value::Null))).unwrap_or(0),
            updated_at: state.as_ref().map(|s| to_epoch(s.get("updatedAt").unwrap_or(&Value::Null))).unwrap_or(0),
        });
        let agents_dir = sess_path.join("agents");
        let Ok(entries) = std::fs::read_dir(&agents_dir) else { return };
        for ag in entries.flatten() {
            if !ag.path().is_dir() {
                continue;
            }
            let wire = ag.path().join("wire.jsonl");
            let Some(mtime) = file_mtime(&wire) else { continue };
            let size = std::fs::metadata(&wire).map(|m| m.len()).unwrap_or(0);
            seen.insert(wire.clone(), ());
            let cached = self.wire_cache.get(&wire).map(|(m, s, recs)| (*m == mtime && *s == size).then(|| recs.clone())).flatten();
            let recs = match cached {
                Some(r) => r,
                None => {
                    let r = Self::parse_wire_file(&wire);
                    self.wire_cache.insert(wire, (mtime, size, r.clone()));
                    r
                }
            };
            records.extend(recs.into_iter().map(|mut r| { r.s = sess_idx; r }));
        }
    }

    // 扫描一个数据目录。兼容两种布局：
    //   root\<工作区>\<会话>\...   （.kimi-code\sessions 原生结构）
    //   root\<会话>\...            （直接指向某个 sessions 子目录或备份）
    fn scan_root(&mut self, root: &Path, sessions: &mut Vec<Session>, records: &mut Vec<Rec>, seen: &mut HashMap<PathBuf, ()>, seen_sessions: &mut HashSet<PathBuf>) {
        let index = self.load_index_for(root);
        let Ok(entries) = std::fs::read_dir(root) else { return };
        for d in entries.flatten() {
            let p1 = d.path();
            if !p1.is_dir() {
                continue;
            }
            if p1.join("state.json").exists() || p1.join("agents").is_dir() {
                let name = d.file_name().to_string_lossy().to_string();
                self.scan_session(&p1, &name, &index, sessions, records, seen, seen_sessions);
                continue;
            }
            let Ok(subs) = std::fs::read_dir(&p1) else { continue };
            for d2 in subs.flatten() {
                let p2 = d2.path();
                if !p2.is_dir() || !(p2.join("state.json").exists() || p2.join("agents").is_dir()) {
                    continue;
                }
                let name = d2.file_name().to_string_lossy().to_string();
                self.scan_session(&p2, &name, &index, sessions, records, seen, seen_sessions);
            }
        }
    }

    fn scan(&mut self) -> (Vec<Session>, Vec<Rec>) {
        let mut seen: HashMap<PathBuf, ()> = HashMap::new();
        let mut seen_sessions = HashSet::new();
        let mut sessions = Vec::new();
        let mut records = Vec::new();
        for root in self.cfg.roots.clone() {
            self.scan_root(Path::new(&root), &mut sessions, &mut records, &mut seen, &mut seen_sessions);
        }
        self.wire_cache.retain(|k, _| seen.contains_key(k));
        (sessions, records)
    }

    fn probe_root(&mut self, root: &str) -> Value {
        let mut sessions = Vec::new();
        let mut records = Vec::new();
        let mut seen = HashMap::new();
        let mut seen_sessions = HashSet::new();
        let ok = Path::new(root).exists();
        if ok {
            self.scan_root(Path::new(root), &mut sessions, &mut records, &mut seen, &mut seen_sessions);
        }
        json!({"path": root, "ok": ok, "sessions": sessions.len(), "records": records.len()})
    }

    fn get_data_string(&mut self) -> String {
        if let Some((at, body)) = &self.last_scan {
            if at.elapsed() < Duration::from_millis(800) {
                return body.clone();
            }
        }
        let (sessions, records) = self.scan();
        let sessions_json: Vec<Value> = sessions
            .iter()
            .map(|s| json!({"id": s.id, "cwd": s.cwd, "title": s.title, "createdAt": s.created_at, "updatedAt": s.updated_at}))
            .collect();
        let records_json: Vec<Value> = records
            .iter()
            .map(|r| json!({"s": r.s, "t": r.t, "m": r.m, "a": r.a, "i": r.i, "o": r.o, "r": r.r, "c": r.c}))
            .collect();
        // 引导期对默认目录做一次探测（与 server.js 一致）
        let default_root = Self::default_root();
        if self.default_probe.is_none() {
            let ok = Path::new(&default_root).exists();
            let stats = if ok && !self.cfg.setup_done { Some(self.probe_root(&default_root)) } else { None };
            self.default_probe = Some((ok, stats));
        }
        let (ok, default_stats) = self.default_probe.as_ref().unwrap();
        let body = json!({
            "generatedAt": now_ms(),
            "roots": self.cfg.roots,
            "setupDone": self.cfg.setup_done,
            "defaultRoot": default_root,
            "defaultOk": ok,
            "defaultStats": default_stats,
            "sessions": sessions_json,
            "records": records_json,
        });
        let s = body.to_string();
        self.last_scan = Some((Instant::now(), s.clone()));
        s
    }

    fn apply_config(&mut self, body: &Value) -> String {
        let mut roots: Vec<String> = body
            .get("roots")
            .and_then(|v| v.as_array())
            .map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect())
            .unwrap_or_default();
        roots = roots.iter().map(|p| p.trim().to_string()).filter(|p| !p.is_empty()).collect();
        roots.dedup();
        let stats: Vec<Value> = roots.iter().map(|r| self.probe_root(r)).collect();
        let ok_roots: Vec<String> = roots
            .iter()
            .zip(stats.iter())
            .filter(|(_, s)| s.get("ok").and_then(|v| v.as_bool()).unwrap_or(false))
            .map(|(r, _)| r.clone())
            .collect();
        self.cfg.roots = ok_roots;
        match body.get("setupDone").and_then(|v| v.as_bool()) {
            Some(b) => self.cfg.setup_done = b,
            None => self.cfg.setup_done = self.cfg.setup_done || !self.cfg.roots.is_empty(),
        }
        self.save_config();
        self.wire_cache.clear();
        self.state_cache.clear();
        self.index_cache.clear();
        self.last_scan = None;
        self.default_probe = None;
        json!({"ok": true, "roots": self.cfg.roots, "setupDone": self.cfg.setup_done, "stats": stats}).to_string()
    }
}


// ---------- 内嵌 HTTP 服务 ----------
fn static_asset(p: &str) -> Option<(&'static [u8], &'static str)> {
    match p {
        "/" | "/index.html" => Some((INDEX_HTML, "text/html; charset=utf-8")),
        "/icon.png" => Some((ICON_PNG, "image/png")),
        "/favicon.ico" => Some((FAVICON_ICO, "image/x-icon")),
        "/manifest.webmanifest" => Some((MANIFEST_WEBMANIFEST, "application/manifest+json")),
        "/icon-192.png" => Some((ICON_192, "image/png")),
        "/icon-512.png" => Some((ICON_512, "image/png")),
        _ => None,
    }
}

fn read_request(stream: &mut TcpStream) -> Option<(String, String, Vec<u8>)> {
    let mut buf = Vec::new();
    let mut tmp = [0u8; 4096];
    // 读完请求头
    let header_end = loop {
        match stream.read(&mut tmp) {
            Ok(0) => return None,
            Ok(n) => {
                buf.extend_from_slice(&tmp[..n]);
                if let Some(pos) = find_subslice(&buf, b"\r\n\r\n") {
                    break pos + 4;
                }
                if buf.len() > 1024 * 1024 {
                    return None;
                }
            }
            Err(_) => return None,
        }
    };
    let head = String::from_utf8_lossy(&buf[..header_end]).to_string();
    let mut lines = head.split("\r\n");
    let request_line = lines.next()?.to_string();
    let mut content_length = 0usize;
    for l in lines {
        let lower = l.to_ascii_lowercase();
        if let Some(v) = lower.strip_prefix("content-length:") {
            content_length = v.trim().parse().unwrap_or(0);
        }
    }
    let mut body = buf[header_end..].to_vec();
    while body.len() < content_length {
        match stream.read(&mut tmp) {
            Ok(0) => break,
            Ok(n) => body.extend_from_slice(&tmp[..n]),
            Err(_) => break,
        }
    }
    body.truncate(content_length);
    let mut parts = request_line.split_whitespace();
    let method = parts.next()?.to_string();
    let path_full = parts.next()?.to_string();
    let path = path_full.split('?').next().unwrap_or("/").to_string();
    Some((method, path, body))
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

fn respond(stream: &mut TcpStream, status: &str, ctype: &str, body: Vec<u8>) -> std::io::Result<()> {
    let head = format!("HTTP/1.1 {status}\r\nContent-Type: {ctype}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n", body.len());
    stream.write_all(head.as_bytes())?;
    stream.write_all(&body)?;
    stream.flush()
}

fn http_server(engine: std::sync::Arc<std::sync::Mutex<Engine>>, app: AppHandle, port_tx: std::sync::mpsc::Sender<u16>) {
    let listener = match TcpListener::bind(("127.0.0.1", PORT)) {
        Ok(l) => l,
        Err(_) => match TcpListener::bind(("127.0.0.1", 0)) {
            Ok(l) => l, // 优先端口被占用时回退随机端口（前端同源相对路径，任意端口都可用）
            Err(_) => return,
        },
    };
    let _ = port_tx.send(listener.local_addr().map(|a| a.port()).unwrap_or(PORT));
    for stream in listener.incoming().flatten() {
        let engine = engine.clone();
        let app = app.clone();
        std::thread::spawn(move || {
            let _ = handle_conn(stream, engine, app);
        });
    }
}

fn handle_conn(mut stream: TcpStream, engine: std::sync::Arc<std::sync::Mutex<Engine>>, app: AppHandle) -> std::io::Result<()> {
    stream.set_read_timeout(Some(Duration::from_secs(5)))?;
    let Some((method, path, body)) = read_request(&mut stream) else { return Ok(()) };

    if path == "/api/data" && method == "GET" {
        let s = engine.lock().map(|mut e| e.get_data_string()).unwrap_or_else(|_| "{\"error\":\"监控数据暂不可用\"}".into());
        return respond(&mut stream, "200 OK", "application/json; charset=utf-8", s.into_bytes());
    }
    if path == "/api/config" && method == "POST" {
        let j: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
        if !valid_config(&j) {
            return respond(&mut stream, "400 Bad Request", "application/json; charset=utf-8", json!({"error":"配置需要 roots 字符串数组及可选的 setupDone 布尔值"}).to_string().into_bytes());
        }
        let s = engine.lock().map(|mut e| e.apply_config(&j)).unwrap_or_else(|_| "{\"error\":\"配置暂时无法保存\"}".into());
        return respond(&mut stream, "200 OK", "application/json; charset=utf-8", s.into_bytes());
    }
    if path == "/api/open" && method == "POST" {
        show_main(&app);
        return respond(&mut stream, "200 OK", "text/plain; charset=utf-8", b"ok".to_vec());
    }
    if path == "/api/quit" && method == "POST" {
        respond(&mut stream, "200 OK", "text/plain; charset=utf-8", b"bye".to_vec())?;
        let app2 = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(150));
            app2.exit(0);
        });
        return Ok(());
    }
    if method == "GET" {
        if let Some((bytes, ctype)) = static_asset(&path) {
            return respond(&mut stream, "200 OK", ctype, bytes.to_vec());
        }
    }
    respond(&mut stream, "404 Not Found", "text/plain; charset=utf-8", b"404 Not Found".to_vec())
}

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

// v2.0.0 起 identifier 由 com.yfan945.kimimonitor 改为 kimimonitor：
// 迁移旧配置文件到新目录，并清理旧目录（Roaming 配置 + Local WebView 缓存，均为应用自管数据）
fn migrate_legacy_config(new_config_dir: &Path) {
    let legacy_id = "com.yfan945.kimimonitor";
    let mut legacy_dirs: Vec<PathBuf> = Vec::new();
    if let Ok(appdata) = std::env::var("APPDATA") {
        legacy_dirs.push(PathBuf::from(appdata).join(legacy_id));
    }
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        legacy_dirs.push(PathBuf::from(local).join(legacy_id));
    }
    if let Ok(home) = std::env::var("HOME") {
        legacy_dirs.push(PathBuf::from(home).join("Library/Application Support").join(legacy_id));
    }
    for dir in &legacy_dirs {
        let old_cfg = dir.join("config.json");
        let new_cfg = new_config_dir.join("config.json");
        if old_cfg.exists() && !new_cfg.exists() {
            let _ = std::fs::create_dir_all(new_config_dir);
            let _ = std::fs::copy(&old_cfg, &new_cfg);
        }
    }
    for dir in &legacy_dirs {
        if dir.exists() {
            let _ = std::fs::remove_dir_all(dir);
        }
    }
}

fn main() {
    let engine = std::sync::Arc::new(std::sync::Mutex::new(Engine::new(PathBuf::from(""))));

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main(app);
        }))
        .setup(move |app| {
            let config_dir = app
                .path()
                .app_config_dir()
                .unwrap_or_else(|_| PathBuf::from(std::env::var("APPDATA").unwrap_or_default()).join("KimiMonitor"));
            let _ = std::fs::create_dir_all(&config_dir);
            migrate_legacy_config(&config_dir);
            {
                let mut e = engine.lock().unwrap();
                e.config_dir = config_dir;
                e.load_config();
            }

            // 启动内嵌 HTTP 服务并等待端口就绪
            let (tx, rx) = std::sync::mpsc::channel::<u16>();
            let app_handle = app.handle().clone();
            let e2 = engine.clone();
            std::thread::spawn(move || http_server(e2, app_handle, tx));
            let port = rx.recv_timeout(Duration::from_secs(5)).unwrap_or(PORT);

            // 主窗口：指向内嵌服务（同源相对路径，前端零改动）
            let url = format!("http://127.0.0.1:{port}/");
            let win = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(url.parse()?))
                .title(APP_TITLE)
                .inner_size(1280.0, 900.0)
                .min_inner_size(980.0, 640.0)
                .visible(false)
                .build()?;
            let _ = win.show();
            let _ = win.set_focus();

            // 托盘：打开窗口 / 退出
            use tauri::menu::{MenuBuilder, MenuItem};
            let open_item = MenuItem::with_id(app, "open", "打开窗口", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = MenuBuilder::new(app).item(&open_item).item(&quit_item).build()?;
            let _tray = tauri::tray::TrayIconBuilder::with_id("main-tray")
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("KimiMonitor")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, ev| match ev.id().as_ref() {
                    "open" => show_main(app),
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, ev| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        button_state: tauri::tray::MouseButtonState::Up,
                        ..
                    } = ev
                    {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            // 关闭窗口 = 隐藏到后台（托盘常驻）；托盘「退出」才是真退出
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("启动 KimiMonitor Rust/Tauri 桌面版失败");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            static SEQ: AtomicUsize = AtomicUsize::new(0);
            let name = format!("kimi-rust-test-{}-{}-{}", std::process::id(), now_ms(), SEQ.fetch_add(1, Ordering::Relaxed));
            let dir = std::env::temp_dir().join(name);
            std::fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }
        fn write(&self, relative: &str, content: &str) {
            let file = self.0.join(relative);
            std::fs::create_dir_all(file.parent().unwrap()).unwrap();
            std::fs::write(file, content).unwrap();
        }
        fn engine(&self) -> Engine {
            Engine {
                config_dir: self.0.join("config"),
                cfg: Config { roots: vec![self.0.join("sessions").to_string_lossy().to_string()], setup_done: true },
                ..Engine::default()
            }
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            assert_eq!(self.0.parent(), Some(std::env::temp_dir().as_path()));
            assert!(self.0.file_name().unwrap().to_string_lossy().starts_with("kimi-rust-test-"));
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
    fn event(model: &str, count: i64) -> String {
        json!({"type":"usage.record", "time":1700000000000i64, "model":model,
            "usage":{"inputOther":count,"output":5}}).to_string()
    }
    fn assert_associations(data: &Value) {
        assert_eq!(data["sessions"].as_array().unwrap().len(), 2);
        let records = data["records"].as_array().unwrap();
        assert_eq!(records.len(), 3);
        for r in records {
            let s = r["s"].as_u64().unwrap() as usize;
            assert_eq!(data["sessions"][s]["cwd"], r["m"]);
        }
        assert!(records.iter().any(|r| r["i"] == 3_000_000_000i64));
    }

    #[test]
    fn session_indices_survive_cached_scans_and_overlapping_roots() {
        let f = Fixture::new();
        f.write("sessions/ws/a/state.json", r#"{"cwd":"project-a"}"#);
        f.write("sessions/ws/a/agents/main/wire.jsonl", &format!("{}\n{}\n{{broken", event("project-a", 3_000_000_000), event("project-a", 10).replace("\"type\":", "\"type\": ")));
        // b 没有 state.json，使用索引恢复项目。
        f.write("sessions/ws/b/agents/main/wire.jsonl", &event("project-b", 20));
        f.write("sessions/session_index.jsonl", r#"{"sessionId":"b","workDir":"project-b"}"#);
        let mut engine = f.engine();
        assert_associations(&serde_json::from_str(&engine.get_data_string()).unwrap());
        engine.cfg.roots.insert(0, f.0.join("sessions/ws").to_string_lossy().to_string());
        engine.last_scan = None;
        assert_associations(&serde_json::from_str(&engine.get_data_string()).unwrap());
    }

    #[test]
    fn parser_accepts_whitespace_and_skips_malformed_lines() {
        let f = Fixture::new();
        f.write("wire.jsonl", &format!("{}\n{{broken\n{{\"type\":\"other\"}}", event("demo", 3_000_000_000).replace("\"type\":", "\"type\": ")));
        let records = Engine::parse_wire_file(&f.0.join("wire.jsonl"));
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].i, 3_000_000_000);
        assert_eq!(token_count(&json!(-1)), 0);
        assert_eq!(token_count(&json!(1.5)), 0);
        assert_eq!(token_count(&json!("100")), 0);
        assert_eq!(token_count(&json!(9_007_199_254_740_992i64)), 0);
    }

    #[test]
    fn invalid_config_is_rejected() {
        for body in [Value::Null, json!({}), json!({"roots":"abc"}), json!({"roots":[1]}), json!({"roots":[],"setupDone":"yes"})] {
            assert!(!valid_config(&body));
        }
        assert!(valid_config(&json!({"roots":[],"setupDone":true})));
        assert!(valid_config(&json!({"roots":["somewhere"]})));
    }

    #[test]
    fn default_probe_is_cached_and_invalidated_by_config() {
        let f = Fixture::new();
        let mut engine = f.engine();
        let data: Value = serde_json::from_str(&engine.get_data_string()).unwrap();
        assert!(data["defaultStats"].is_null()); // 完成引导后不扫描默认目录
        engine.default_probe = Some((true, Some(json!({"cached":true}))));
        engine.last_scan = None;
        let data: Value = serde_json::from_str(&engine.get_data_string()).unwrap();
        assert_eq!(data["defaultStats"]["cached"], true);
        engine.apply_config(&json!({"roots":[],"setupDone":true}));
        assert!(engine.default_probe.is_none());
    }
}
