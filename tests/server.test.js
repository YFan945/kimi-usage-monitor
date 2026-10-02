'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { once } = require('node:events');

let fixture, child, base, root;
const request = (route, body) => fetch(base + route, body === undefined ? {} : {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});
async function configure(roots) {
  const res = await request('/api/config', { roots, setupDone: true });
  assert.equal(res.status, 200);
  return res.json();
}
function makeSession(name, state, lines) {
  const dir = path.join(root, 'workspace', name);
  fs.mkdirSync(path.join(dir, 'agents', 'main'), { recursive: true });
  if (state) fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(state));
  fs.writeFileSync(path.join(dir, 'agents', 'main', 'wire.jsonl'), lines.join('\n'));
}
const event = count => JSON.stringify({ type: 'usage.record', time: 1700000000000,
  model: 'demo', usage: { inputOther: count, output: 5 } });

before(async () => {
  fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'kimi-monitor-test-'));
  root = path.join(fixture, 'sessions');
  fs.copyFileSync(path.join(__dirname, '..', 'server.js'), path.join(fixture, 'server.js'));
  const seaExecutable = process.env.KIMI_MONITOR_TEST_EXE ? path.join(fixture, 'KimiMonitor.exe') : null;
  if (seaExecutable) fs.copyFileSync(process.env.KIMI_MONITOR_TEST_EXE, seaExecutable);
  fs.writeFileSync(path.join(fixture, 'config.json'), JSON.stringify({ roots: [], setupDone: true }));
  makeSession('a', { cwd: 'project-a', title: 'A' }, [event(3000000000), event(10).replace('"type":', '"type": '), '{broken']);
  makeSession('b', null, [event(20)]);
  fs.writeFileSync(path.join(root, 'session_index.jsonl'), JSON.stringify({ sessionId: 'b', workDir: 'project-b' }));
  const reservation = net.createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  base = `http://127.0.0.1:${port}`;
  child = spawn(seaExecutable || process.execPath,
    [...(seaExecutable ? [] : [path.join(fixture, 'server.js')]), '--port', String(port)], {
    cwd: fixture, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, HOME: fixture, USERPROFILE: fixture, KIMI_NO_TRAY: '1', KIMI_NO_OPEN: '1', KIMI_NO_SHORTCUT: '1' },
  });
  let logs = '';
  child.stdout.on('data', data => { logs += data; });
  child.stderr.on('data', data => { logs += data; });
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`server exited: ${logs}`);
    try { if ((await request('/api/data')).ok) return; } catch { }
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error(`server did not start: ${logs}`);
});
after(async () => {
  if (child && child.exitCode === null) {
    const stopped = once(child, 'exit');
    child.kill();
    await stopped;
  }
  if (fixture && path.dirname(fixture) === path.resolve(os.tmpdir()) && path.basename(fixture).startsWith('kimi-monitor-test-')) {
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});

test('扫描合法 JSONL、保留大数，并通过索引恢复缺少 state.json 的项目', async () => {
  await configure([root]);
  const data = await (await request('/api/data')).json();
  assert.equal(data.sessions.length, 2);
  assert.equal(data.records.length, 3);
  assert.deepEqual(data.records.map(r => data.sessions[r.s].cwd).sort(), ['project-a', 'project-a', 'project-b']);
  assert.equal(data.records.find(r => r.i > 100).i, 3000000000);
});

test('重叠根目录及不同路径写法不会重复累计', async () => {
  await configure([root, path.join(root, 'workspace'), path.join(root, 'workspace', '..')]);
  const data = await (await request('/api/data')).json();
  assert.equal(data.sessions.length, 2);
  assert.equal(data.records.length, 3);
});

test('无效配置返回 400，原配置保留且服务继续运行', async () => {
  await configure([root]);
  for (const body of ['{bad', 'null', '{}', '{"roots":"abc"}', '{"roots":[1]}', '{"roots":[],"setupDone":"yes"}']) {
    assert.equal((await request('/api/config', body)).status, 400);
    const data = await (await request('/api/data')).json();
    assert.deepEqual(data.roots, [root]);
    assert.equal(data.records.length, 3);
  }
});

test('过大的配置请求返回 413，不修改配置', async () => {
  assert.equal((await request('/api/config', ' '.repeat(1024 * 1024 + 1))).status, 413);
  assert.deepEqual((await (await request('/api/data')).json()).roots, [root]);
});

test('非法 URL 编码返回 400，后续请求仍然可用', async () => {
  assert.equal((await request('/%ZZ')).status, 400);
  assert.equal((await request('/api/data')).status, 200);
});
