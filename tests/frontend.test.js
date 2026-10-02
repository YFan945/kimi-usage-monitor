'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');

function context() {
  const elements = new Map();
  const ctx = vm.createContext({
    $: key => { if (!elements.has(key)) elements.set(key, {}); return elements.get(key); },
    document: { querySelectorAll: () => [] },
    renderLegend() {}, drawHeatmap() {}, drawCharts() {}, drawBreakdowns() {}, drawSessions() {}, saveUI() {},
  });
  // 使用页面中的实际函数，避免复制实现后只测试副本。
  vm.runInContext(html.slice(html.indexOf('const p2 ='), html.indexOf('// ---------- 主题')), ctx);
  vm.runInContext(html.match(/function pct\([^\n]+/)[0], ctx);
  vm.runInContext('let curPreset="24h", range={}; const DATA={records:[],sessions:[]}; const fltModel=new Set(), fltProj=new Set();', ctx);
  vm.runInContext(html.slice(html.indexOf('function updatePresetRange('), html.indexOf("$('#presets').addEventListener")), ctx);
  vm.runInContext(html.slice(html.indexOf('function render()'), html.indexOf('// ---------- 数据目录管理')), ctx);
  return ctx;
}

test('大数格式化不发生 32 位溢出', () => {
  const ctx = context();
  assert.equal(vm.runInContext('fmt(3000000000)', ctx), '30.00亿');
  assert.equal(vm.runInContext('fmtFull(3000000000)', ctx), '3,000,000,000');
  assert.equal(vm.runInContext('fmtFull(4294967296)', ctx), '4,294,967,296');
  assert.equal(vm.runInContext('fmt(12345)', ctx), '1.2万');
});

test('渲染会移动 24 小时窗口，并在跨午夜后更新今天', () => {
  const ctx = context();
  vm.runInContext(`
    const RealDate=Date;
    let clock=new RealDate(2026,9,2,23,59).getTime();
    Date=class extends RealDate { constructor(...args){super(...(args.length?args:[clock]));} static now(){return clock;} };
    render();
  `, ctx);
  const first = vm.runInContext('range.start', ctx);
  vm.runInContext('$("#from").value="2026-10-01T10:00"; $("#to").value="2026-10-02T11:00";', ctx);
  vm.runInContext('clock+=120000; render()', ctx);
  assert.equal(vm.runInContext('range.start', ctx), first + 120000);
  assert.equal(vm.runInContext('$("#from").value', ctx), '2026-10-01T10:00');
  assert.equal(vm.runInContext('$("#to").value', ctx), '2026-10-02T11:00');
  vm.runInContext('curPreset="today"; render()', ctx);
  assert.equal(vm.runInContext('range.start', ctx), vm.runInContext('new RealDate(2026,9,3).getTime()', ctx));
  vm.runInContext('curPreset="custom"; range={start:100,end:200}; render()', ctx);
  assert.equal(vm.runInContext('range.start', ctx), 100);
  assert.equal(vm.runInContext('range.end', ctx), 200);
});

test('完整内联脚本语法有效', () => {
  assert.doesNotThrow(() => new vm.Script(html.match(/<script>([\s\S]*?)<\/script>/)[1]));
});
