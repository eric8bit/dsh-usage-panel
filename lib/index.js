// dsh-usage-panel host half: same-origin OpenCode usage data service.
// 取数/解析/汇总逻辑直接运行在 DSH 宿主进程内,在 DSH web 自己的端口(3080)
// 挂 /dsh-usage-panel/* 路由,浏览器卡片与仪表盘同源 fetch——
// 没有独立端口、没有常驻终端窗口,DSH 在跑即有数据。
//
// 凭据来源(优先级从上到下):
//   1. 环境变量 OPCODE_AUTH / OPCODE_WORKSPACE_ID
//   2. %DSH_HOME%/usage-panel.json  ->  { "auth": "...", "workspaceId": "wrk_..." }
// 由 set-credentials.bat 写入 JSON。
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DASHBOARD_PATH = path.join(__dirname, '..', 'dashboard.html');
const REFRESH_MS = 300_000; // 缓存 TTL(5分钟;过期后后台刷新;点击展开时走 /refresh 强制刷新)

// ===== server function id(逆向自 opencode 前端)=====
const FN = {
  usage:   'bfd684bfc2e4eed05cd0b518f5e4eafd3f3376e3938abb9e536e7c03df831e5c',
  billing: 'c83b78a614689c38ebee981f9b39a8b377716db85c1fd7dbab604adc02d3313d',
  lite:    'c7389bd0e731f80f49593e5ee53835475f4e28594dd6bd83eb229bab753498cd',
  costs:   '15702f3a12ff8bff357f8c2aa154a17e65b746d5f6b96adc9002c86ee0c15205',
};

// ===== 凭据 =====
function configPath() {
  const homedir0 = os.homedir();
  const usr = process.platform === 'win32' ? (process.env.USERPROFILE || homedir0) : homedir0;
  // 实测 dsh web 宿主进程的环境里 DSH_HOME 未必可见,而 set-credentials.bat
  // 把凭据写到 %DSH_HOME%\usage-panel.json(= ~/.dsh/usage-panel.json)—
  // 按候选路径逐个探测,返回第一个真实存在的文件(先判定再 join,避免 undefined)。
  const candidates = [];
  if (process.env.DSH_HOME) candidates.push(path.join(process.env.DSH_HOME, 'usage-panel.json'));
  candidates.push(path.join(homedir0, '.dsh', 'usage-panel.json'));
  if (usr && usr !== homedir0) {
    candidates.push(path.join(usr, '.dsh', 'usage-panel.json'));
    candidates.push(path.join(usr, 'usage-panel.json'));
  }
  candidates.push(path.join(homedir0, 'usage-panel.json'));
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch { /* 继续探测 */ }
  }
  return candidates[0];
}
function readCredentials() {
  let json = {};
  try { json = JSON.parse(fs.readFileSync(configPath(), 'utf8')); } catch { /* 未配置 */ }
  return {
    cookie: process.env.OPCODE_AUTH || (typeof json.auth === 'string' ? json.auth : ''),
    workspace: process.env.OPCODE_WORKSPACE_ID || (typeof json.workspaceId === 'string' ? json.workspaceId : ''),
  };
}

// ===== seroval 序列化(请求参数)=====
function ser(v) {
  if (typeof v === 'string') return { t: 1, s: v };
  if (typeof v === 'boolean') return { t: 2, s: v ? 1 : 0 };
  if (typeof v === 'number') return { t: 0, s: v };
  if (Array.isArray(v)) return { t: 9, i: 0, l: v.length, a: v.map(ser), o: 0 };
  if (v === null || v === undefined) return { t: 6 };
  return { t: 1, s: String(v) };
}
function argsEncode(args) {
  return encodeURIComponent(JSON.stringify({ t: ser(args), f: 31, m: [] }));
}

// ===== 安全的 seroval 解析(响应)—— 不使用 eval =====
const SEROVAL_MAX_BYTES = 20 * 1024 * 1024;

class SerovalParseError extends Error {
  constructor(msg) {
    super(`seroval 解析失败: ${msg}`);
    this.name = 'SerovalParseError';
  }
}

function parseSeroval(text) {
  if (typeof text !== 'string' || text.length === 0) throw new SerovalParseError('空输入');
  if (text.length > SEROVAL_MAX_BYTES) throw new SerovalParseError('输入超过 20MB 上限');

  const src = text.replace(/^;\s*0x[0-9a-fA-F]+\s*;/, '');
  const top = /^\(\(self\.\$R=self\.\$R\|\|\{\}\)\["[^"]+"\]=\[\],([\s\S]*)\)$/.exec(src);
  if (!top) throw new SerovalParseError('顶层模板不匹配');
  const body = top[1];
  const iife = /^\(\$R=>([\s\S]*)\)\(\$R\["[^"]+"\]\)$/.exec(body);
  if (!iife) throw new SerovalParseError('IIFE 模板不匹配');

  const code = iife[1];
  let pos = 0;
  const n = code.length;
  const envR = [];

  function fail(msg) { throw new SerovalParseError(`${msg} @${pos}`); }
  function skipWs() {
    for (;;) {
      const c = code[pos];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\v' || c === '\f') { pos++; continue; }
      if (c === '/' && code[pos + 1] === '/') { while (pos < n && code[pos] !== '\n') pos++; continue; }
      if (c === '/' && code[pos + 1] === '*') {
        const end = code.indexOf('*/', pos + 2);
        if (end < 0) fail('未闭合的块注释');
        pos = end + 2; continue;
      }
      break;
    }
  }

  function peek() { skipWs(); return code[pos]; }
  function eat(ch) { skipWs(); if (code[pos] !== ch) fail(`期望 "${ch}"`); pos++; }

  function parseString() {
    const quote = code[pos];
    if (quote !== '"' && quote !== "'" && quote !== '`') fail(`非法字符串起始符 "${quote}"`);
    pos++;
    let out = '';
    for (;;) {
      if (pos >= n) fail('字符串未闭合');
      const c = code[pos];
      if (c === quote) { pos++; return out; }
      if (quote === '`' && c === '$' && code[pos + 1] === '{') fail('模板插值 ${} 不被允许');
      if (c === '\\') {
        pos++;
        if (pos >= n) fail('转义未闭合');
        const e = code[pos];
        const simple = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', '0': '\0', '\\': '\\', '"': '"', "'": "'", '`': '`', '/' : '/' };
        if (e in simple) { out += simple[e]; pos++; continue; }
        if (e === 'u') {
          const hex = code.slice(pos + 1, pos + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('非法 \\u 转义');
          out += String.fromCharCode(parseInt(hex, 16)); pos += 5; continue;
        }
        if (e === 'x') {
          const hex = code.slice(pos + 1, pos + 3);
          if (!/^[0-9a-fA-F]{2}$/.test(hex)) fail('非法 \\x 转义');
          out += String.fromCharCode(parseInt(hex, 16)); pos += 3; continue;
        }
        fail(`不支持的转义 \\${e}`);
      }
      out += c;
      pos++;
    }
  }

  function parseExpr() {
    const first = parseAssign();
    skipWs();
    if (code[pos] === ',') {
      let v = first;
      while (code[pos] === ',') { pos++; v = parseAssign(); }
      return v;
    }
    return first;
  }

  function parseAssign() {
    skipWs();
    if (code[pos] === '$') {
      pos++;
      if (code[pos] !== 'R') fail('只允许 $R');
      pos++;
      eat('[');
      const m = /^\d+/.exec(code.slice(pos));
      if (!m) fail('期望数字索引');
      pos += m[0].length;
      eat(']');
      const idx = parseInt(m[0], 10);
      skipWs();
      if (code[pos] === '=') {
        pos++;
        const value = parseAssign();
        envR[idx] = value;
        return value;
      }
      return envR[idx];
    }
    skipWs();
    if (code.startsWith('new Date', pos)) {
      pos += 8;
      eat('(');
      const s = parseString();
      eat(')');
      return new Date(s);
    }
    return parseUnary();
  }

  function parseUnary() {
    const c = peek();
    if (c === '!') { pos++; return !parseUnary(); }
    if (c === '-') { pos++; return -parseUnary(); }
    if (c === '+') { pos++; return +parseUnary(); }
    return parseValue();
  }

  function parseValue() {
    const c = peek();
    if (c === '"' || c === "'" || c === '`') return parseString();
    if (c === '[') {
      pos++;
      const arr = [];
      skipWs();
      if (code[pos] === ']') { pos++; return arr; }
      for (;;) {
        arr.push(parseAssign());
        skipWs();
        if (code[pos] === ',') { pos++; continue; }
        eat(']');
        return arr;
      }
    }
    if (c === '{') {
      pos++;
      const obj = {};
      skipWs();
      if (code[pos] === '}') { pos++; return obj; }
      for (;;) {
        let key;
        const k = peek();
        if (k === '"' || k === "'" || k === '`') key = parseString();
        else if (/[A-Za-z_$]/.test(k)) {
          const m = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(code.slice(pos));
          key = m[0]; pos += m[0].length;
        } else if (/[0-9]/.test(k)) {
          const m = /^\d+/.exec(code.slice(pos));
          key = m[0]; pos += m[0].length;
        } else fail('非法对象键');
        eat(':');
        obj[key] = parseAssign();
        skipWs();
        if (code[pos] === ',') { pos++; continue; }
        eat('}');
        return obj;
      }
    }
    if (/[0-9]/.test(c)) {
      const m = /^-?(?:0[xX][0-9a-fA-F]+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/.exec(code.slice(pos));
      if (!m) fail('非法数字');
      pos += m[0].length;
      return Number(m[0]);
    }
    if (/[A-Za-z_$]/.test(c)) {
      const m = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(code.slice(pos));
      const word = m[0]; pos += m[0].length;
      if (word === 'null') return null;
      if (word === 'undefined') return undefined;
      if (word === 'true') return true;
      if (word === 'false') return false;
      if (word === 'NaN') return NaN;
      if (word === 'Infinity') return Infinity;
      if (word === 'void') { skipWs(); if (code[pos] !== '0') fail('仅支持 void 0'); pos++; return undefined; }
      fail(`不允许的标识符 "${word}"`);
    }
    fail(`不允许的字符 "${c}"`);
  }

  const result = parseExpr();
  skipWs();
  if (pos < n) fail(`结尾存在多余内容 "${code.slice(pos, pos + 20)}"`);
  return result;
}

// ===== 抓取(opencode 接口) =====
function call(fnName, args, cred) {
  const url = `https://opencode.ai/_server?id=${FN[fnName]}&args=${argsEncode(args)}`;
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'Cookie': `auth=${cred.cookie}`,
        'X-Server-Id': FN[fnName],
        'X-Server-Instance': `server-fn:${fnName}`,
        'Accept': '*/*',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15',
      },
    }, (res) => {
      let body = '';
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > SEROVAL_MAX_BYTES) { req.destroy(new Error('响应超过 20MB 上限')); return; }
        body += c;
      });
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        try { resolve(parseSeroval(body)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('timeout')));
  });
}

const USAGE_BATCH = 20; // 并发批次,减少全量爬取耗时(实测4500+条/26s→约减半)
const USAGE_MAX_PAGES = 200;
const USAGE_EMPTY_STOP = 5;

async function fetchAll(cred) {
  const seen = new Set();
  const usage = [];
  let emptyStreak = 0;
  for (let base = 0; base < USAGE_MAX_PAGES && emptyStreak < USAGE_EMPTY_STOP; base += USAGE_BATCH) {
    const pages = await Promise.all(
      Array.from({ length: USAGE_BATCH }, (_, j) => call('usage', [cred.workspace, base + j], cred).catch(() => []))
    );
    let batchEmpty = 0;
    for (const page of pages) {
      if (!page || !page.length) { batchEmpty++; continue; }
      for (const r of page) {
        if (r && r.id && !seen.has(r.id)) { seen.add(r.id); usage.push(r); }
      }
    }
    if (batchEmpty === USAGE_BATCH) emptyStreak++;
    else emptyStreak = 0;
  }

  const [billing, lite, costs] = await Promise.all([
    call('billing', [cred.workspace], cred).catch(() => ({})),
    call('lite', [cred.workspace], cred).catch(() => ({})),
    call('costs', [cred.workspace, new Date().getFullYear(), new Date().getMonth() + 1, 480], cred).catch(() => ({ keys: [] })),
  ]);

  return { usage, billing, lite, costs };
}

// ===== 组装数据 =====
function summarize({ usage, billing, lite, costs }, fxCache) {
  const keyNames = {};
  let email = '';
  (costs.keys || []).forEach((k) => {
    const dn = k.displayName || k.id;
    keyNames[k.id] = dn.split(' - ').pop();
    if (!email && typeof dn === 'string' && dn.includes('@')) email = dn.split(' - ')[0].trim();
  });

  const models = [], modelIdx = {};
  const keyList = [], keyIdx = {};
  const records = [];

  usage.forEach((r) => {
    if (!r || !r.id) return;
    const m = r.model || '?';
    if (!(m in modelIdx)) { modelIdx[m] = models.length; models.push(m); }
    const k = r.keyID || '?';
    if (!(k in keyIdx)) { keyIdx[k] = keyList.length; keyList.push(k); }
    const t = r.timeCreated ? new Date(r.timeCreated).getTime() : 0;
    records.push([t, modelIdx[m], +((r.cost || 0) / 1e8).toFixed(8), r.inputTokens || 0, r.outputTokens || 0, keyIdx[k], r.cacheReadTokens || 0]);
  });

  const knames = keyList.map((kid) => keyNames[kid] || kid);
  const u = (k) => (lite[k] ? { pct: lite[k].usagePercent || 0, reset: lite[k].resetInSec || 0 } : { pct: 0, reset: 0 });

  return {
    balance: (billing.balance || 0) / 1e8,
    payment: billing.paymentMethodType || 'alipay',
    email,
    lite: { rolling: u('rollingUsage'), weekly: u('weeklyUsage'), monthly: u('monthlyUsage'), useBalance: !!lite.useBalance },
    fx: fxCache,
    records, models, knames,
    updated: new Date().toISOString(),
  };
}

// ===== 汇率(按天缓存) =====
let fxCache = null;
async function fetchFx() {
  const today = new Date().toISOString().slice(0, 10);
  if (fxCache && fxCache.date === today) return fxCache;
  try {
    const data = await new Promise((resolve, reject) => {
      const req = https.get('https://open.er-api.com/v6/latest/USD', { timeout: 10000 }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => {
          if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
          try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
        });
      });
      req.on('error', reject);
      req.setTimeout(10000, () => req.destroy(new Error('fx timeout')));
    });
    const rate = data && data.rates && Number(data.rates.CNY);
    if (rate && rate > 1 && rate < 50) fxCache = { rate: +rate.toFixed(4), date: today };
  } catch { /* 汇率失败不影响用量 */ }
  return fxCache;
}

// ===== TTL 缓存 + 互斥刷新 =====
let cached = null;
let cachedAt = 0;
let refreshing = null;

async function doRefresh() {
  const cred = readCredentials();
  if (!cred.cookie || !cred.workspace) return { ok: false, reason: 'credentials-missing' };
  try {
    const fx = await fetchFx();
    const snap = await fetchAll(cred);
    cached = summarize(snap, fx);
    cachedAt = Date.now();
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String((e && e.message) || e) };
  }
}
function refreshNow() {
  if (!refreshing) refreshing = doRefresh().finally(() => { refreshing = null; });
  return refreshing;
}
async function ensureData() {
  // 缓存优先(stale-while-revalidate):有数据立即返回,过期时后台刷新,绝不阻塞响应——
  // 避免每次自动刷新都等待一次全量爬取(实测约 26s / 4500+ 条)。
  if (cached) {
    if (Date.now() - cachedAt >= REFRESH_MS) refreshNow(); // 后台刷新(互斥,单飞)
    return { ok: true, fresh: true };
  }
  const r = await refreshNow();
  return r.ok ? { ok: true } : { ok: false, reason: r.reason };
}

// ===== HTTP 路由 =====
function isLoopback(req) {
  const a = req.socket && req.socket.remoteAddress;
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}
function writeJson(res, status, obj) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(obj));
}

/** 构造 /dsh-usage-panel/* 的路由处理函数(独立导出便于测试)。 */
export function createUsageHandler() {
  return async (req, res) => {
    if (!isLoopback(req)) { writeJson(res, 403, { error: 'loopback-only' }); return; }
    if (req.method !== 'GET') { writeJson(res, 405, { error: 'method-not-allowed' }); return; }
    const pathname = new URL(req.url ?? '/', 'http://x').pathname;

    if (pathname === '/dsh-usage-panel/dashboard') {
      try {
        const html = fs.readFileSync(DASHBOARD_PATH, 'utf8');
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-cache' });
        res.end(html);
      } catch (e) {
        writeJson(res, 500, { error: 'dashboard.html 未找到: ' + e.message });
      }
      return;
    }

    if (pathname === '/dsh-usage-panel/refresh') {
      const r = await refreshNow();
      if (!r.ok) { writeJson(res, 503, { error: r.reason }); return; }
      writeJson(res, 200, { ok: true, records: cached.records.length, updated: cached.updated });
      return;
    }

    if (pathname === '/dsh-usage-panel/data') {
      const r = await ensureData();
      if (!r.ok) {
        if (r.reason === 'credentials-missing') writeJson(res, 200, { error: 'credentials-missing', message: '未配置凭据,请双击运行 set-credentials.bat' });
        else writeJson(res, 503, { error: r.reason || '数据尚未就绪', message: '数据获取失败' });
        return;
      }
      const body = JSON.stringify(cached);
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' });
      res.end(body);
      return;
    }

    writeJson(res, 404, { error: 'not-found' });
  };
}

function registerRoutes(ctx) {
  const handler = createUsageHandler();
  const disposeRoute = ctx.webServer.register({ kind: 'prefix', path: '/dsh-usage-panel', handler });
  return () => disposeRoute();
}

/** 声明需要注入的服务(经 loader 授权后才能访问 ctx.webServer)。
 *  注意:必须挂在插件对象(default)上,仅模块级具名导出不够——
 *  dsh 的 cordis 加载器可能从 default 对象读 inject(参考已装 dsh-usage-stats 的
 *  具名导出风格),两条路径都声明才稳妥。 */
export const inject = ['webServer'];

export default {
  name: 'dsh-usage-panel',
  inject: ['webServer'],
  apply(ctx) {
    if (!ctx || typeof ctx.effect !== 'function' || !ctx.webServer || typeof ctx.webServer.register !== 'function') return;
    ctx.effect(() => {
      const dispose = registerRoutes(ctx);
      return () => dispose();
    }, 'dsh-usage-panel: same-origin usage routes');
  },
};

// 供单元测试 / 复用
export { parseSeroval, SerovalParseError, configPath, readCredentials };
