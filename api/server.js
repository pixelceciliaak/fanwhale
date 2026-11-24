'use strict';
/* Saltline · 账号 / 大厅 / 后台 API
   - 纯 Node 内置模块，零依赖
   - 数据目录：data/{users,tokens,chat,admin,atokens,notices,about,config} */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 7801;
const FB_FILE = path.join(__dirname, 'data', 'feedback.json');
let fbCache = null;
function loadFb() {
  if (fbCache) return fbCache;
  try { fbCache = JSON.parse(fs.readFileSync(FB_FILE, 'utf8')); } catch (e) { fbCache = []; }
  if (!Array.isArray(fbCache)) fbCache = [];
  return fbCache;
}
function saveFb(list) {
  fbCache = list;
  try { fs.writeFileSync(FB_FILE, JSON.stringify(list)); } catch (e) {}
}
const DIR = path.join(__dirname, 'data');
fs.mkdirSync(DIR, { recursive: true });
const F = {
  users: path.join(DIR, 'users.json'),
  tok: path.join(DIR, 'tokens.json'),
  chat: path.join(DIR, 'chat.jsonl'),
  admin: path.join(DIR, 'admin.json'),
  atok: path.join(DIR, 'atokens.json'),
  notices: path.join(DIR, 'notices.json'),
  about: path.join(DIR, 'about.json'),
  config: path.join(DIR, 'config.json'),
  avatars: path.join(DIR, 'avatars'),
  audit: path.join(DIR, 'audit.jsonl'),
};
try { fs.mkdirSync(F.avatars, { recursive: true }); } catch (e) {}

const rd = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return d; } };
const wr = (p, v) => fs.writeFileSync(p, JSON.stringify(v));

let users = rd(F.users, {});
let toks = rd(F.tok, {});
let atoks = rd(F.atok, {});
let admins = rd(F.admin, null);
let notices = rd(F.notices, []);
let about = rd(F.about, { title: '关于 Saltline', body: '', updated: 0 });
let conf = rd(F.config, { allowRegister: true });

let chat = [];
try {
  chat = fs.readFileSync(F.chat, 'utf8').split('\n').filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch (e) { return null; } })
    .filter(Boolean).slice(-400);
} catch (e) {}
let seq = chat.length ? chat[chat.length - 1].id : 0;
let nid = notices.reduce((a, n) => Math.max(a, n.id || 0), 0);

const TTL = 30 * 864e5;
const ATTL = 12 * 36e5;
const ONLINE = 90e3;
const MSG_MAX = 160;
const rnd = n => crypto.randomBytes(n).toString('hex');
const hash = (p, s) => crypto.scryptSync(String(p), String(s), 32).toString('hex');
const saveT = () => wr(F.tok, toks);
const saveU = () => wr(F.users, users);
const saveA = () => wr(F.atok, atoks);
const saveN = () => wr(F.notices, notices);

if (!admins) {
  const pass = process.env.ADMIN_PASS || rnd(9);
  const salt = rnd(16);
  admins = { u: 'admin', salt, hash: hash(pass, salt), created: Date.now() };
  wr(F.admin, admins);
  try { fs.writeFileSync(path.join(DIR, 'admin-init.txt'), 'admin\n' + pass + '\n'); } catch (e) {}
  console.log('[saltline-api] admin created: admin / ' + pass);
}

/* ---- 限流 ---- */
const rl = new Map();
function allow(ip, max, win) {
  const t = Date.now();
  let r = rl.get(ip);
  if (!r || t - r.t > win) { r = { n: 0, t }; rl.set(ip, r); }
  r.n++;
  if (rl.size > 5000) rl.clear();
  return r.n <= max;
}
const fails = new Map();
function failAdd(k) {
  const t = Date.now();
  let r = fails.get(k);
  if (!r || t - r.t > 3e5) { r = { n: 0, t }; fails.set(k, r); }
  r.n++;
  return r.n;
}

function json(res, code, obj) {
  const b = Buffer.from(JSON.stringify(obj));
  res.writeHead(code, {
    'content-type': 'application/json;charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization,content-type',
    'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
    'content-length': b.length,
  });
  res.end(b);
}
function readJson(req) {
  return new Promise(resolve => {
    let n = 0;
    const buf = [];
    req.on('data', c => { n += c.length; if (n > 16384) { req.destroy(); return; } buf.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(buf).toString('utf8') || '{}')); } catch (e) { resolve({}); } });
    req.on('error', () => resolve({}));
  });
}
function bearer(req) {
  return String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
}
function who(req) {
  const h = bearer(req);
  if (!h) return null;
  const e = toks[h];
  if (!e) return null;
  if (e.exp < Date.now()) { delete toks[h]; saveT(); return null; }
  e.seen = Date.now();
  return { name: e.u, token: h };
}
function adminOf(req) {
  const h = bearer(req);
  if (!h) return null;
  const e = atoks[h];
  if (!e) return null;
  if (e.exp < Date.now()) { delete atoks[h]; saveA(); return null; }
  return { name: e.u, token: h };
}
function onlineSet() {
  const s = new Set(), t = Date.now();
  for (const k in toks) {
    const e = toks[k];
    if (e.exp > t && e.seen && t - e.seen < ONLINE) s.add(e.u);
  }
  return s;
}
function banOf(u) {
  if (!u || !u.ban) return null;
  if (u.ban.until && u.ban.until < Date.now()) return null;
  return u.ban;
}
function banText(b) {
  return b.until ? ('封禁至 ' + new Date(b.until).toLocaleString('zh-CN')) : '永久封禁';
}
function audit(act, target, extra) {
  try {
    const rec = Object.assign({ t: Date.now(), act, target: target || '' }, extra || {});
    fs.appendFile(F.audit, JSON.stringify(rec) + '\n', () => {});
  } catch (e) {}
}
function push(m) {
  seq++;
  const msg = { id: seq, t: Date.now(), kind: m.kind || 'say', u: m.u || '', txt: m.txt };
  if (m.n) msg.n = m.n;
  chat.push(msg);
  if (chat.length > 400) chat.shift();
  fs.appendFile(F.chat, JSON.stringify(msg) + '\n', () => {});
  try {
    if (fs.statSync(F.chat).size > (1 << 19)) {
      fs.writeFileSync(F.chat, chat.map(x => JSON.stringify(x)).join('\n') + '\n');
    }
  } catch (e) {}
  return msg;
}
function kickUser(name) {
  let n = 0;
  for (const k in toks) {
    if (toks[k].u === name) { delete toks[k]; n++; }
  }
  if (n) saveT();
  return n;
}
const NAME_RE = /^[\u4e00-\u9fa5A-Za-z0-9_]{2,16}$/;

const server = http.createServer(async (req, res) => {
  const ip = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  let url;
  try { url = new URL(req.url, 'http://local'); } catch (e) { return json(res, 400, { err: 'bad url' }); }
  const p = url.pathname;
  if (req.method === 'OPTIONS') { json(res, 204, {}); return; }

  /* ================= 公开 ================= */

  if (p === '/api/health') {
    return json(res, 200, { ok: true, users: Object.keys(users).length, online: onlineSet().size, msgs: chat.length });
  }

  if (p === '/api/announce') {
    return json(res, 200, {
      notices: notices.filter(n => n.active).sort((a, b) => (b.updated || 0) - (a.updated || 0)),
      about: { title: about.title || '关于 Saltline', body: about.body || '', updated: about.updated || 0 },
      config: { allowRegister: !!conf.allowRegister },
    });
  }

  if (p === '/api/register' && req.method === 'POST') {
    if (!conf.allowRegister) return json(res, 403, { err: '当前暂停开放注册' });
    if (!allow(ip, 6, 6e4)) return json(res, 429, { err: '操作太频繁，稍后再试' });
    const b = await readJson(req);
    const name = String(b.u || '').trim();
    const pass = String(b.p || '');
    if (!NAME_RE.test(name)) return json(res, 400, { err: '昵称需 2-16 位：中英文、数字、下划线' });
    if (pass.length < 6 || pass.length > 64) return json(res, 400, { err: '密码需 6-64 位' });
    const key = name.toLowerCase();
    if (users[key]) return json(res, 409, { err: '该昵称已被占用' });
    const salt = rnd(16);
    users[key] = { u: name, nick: name, av: 0, salt, hash: hash(pass, salt), created: Date.now(), last: Date.now(), ban: null };
    saveU();
    const t = rnd(24);
    toks[t] = { u: name, exp: Date.now() + TTL, seen: Date.now() };
    saveT();
    /* 不广播账号名：匿名化 + 120 秒节流，避免泄露个人信息也避免刷屏 */
    if (!global.__lastJoinTip || Date.now() - global.__lastJoinTip > 120000) {
      global.__lastJoinTip = Date.now();
      push({ kind: 'sys', txt: '有新的破袭者接入' });
    }
    return json(res, 200, { token: t, u: name, nick: name, av: 0 });
  }

  if (p === '/api/login' && req.method === 'POST') {
    if (!allow(ip, 12, 6e4)) return json(res, 429, { err: '操作太频繁，稍后再试' });
    const b = await readJson(req);
    const name = String(b.u || '').trim();
    const pass = String(b.p || '');
    const key = name.toLowerCase();
    if (failAdd(ip + '|' + key) > 10) return json(res, 429, { err: '尝试次数过多，请 5 分钟后再试' });
    const u = users[key];
    if (!u || hash(pass, u.salt) !== u.hash) return json(res, 401, { err: '昵称或密码不正确' });
    const ban = banOf(u);
    if (ban) return json(res, 403, { err: '该账号已被封禁 · ' + banText(ban) + (ban.reason ? ('｜' + ban.reason) : '') });
    fails.delete(ip + '|' + key);
    u.last = Date.now();
    saveU();
    const t = rnd(24);
    toks[t] = { u: u.u, exp: Date.now() + TTL, seen: Date.now() };
    saveT();
    push({ kind: 'sys', txt: u.u + ' 回到大厅' });
    return json(res, 200, { token: t, u: u.u, nick: u.nick || u.u, av: u.av || 0 });
  }

  if (p === '/api/me') {
    const w = who(req);
    if (!w) return json(res, 401, { err: '登录凭证已失效' });
    const u = users[w.name.toLowerCase()];
    const ban = u && banOf(u);
    if (ban) { kickUser(w.name); return json(res, 403, { err: '该账号已被封禁 · ' + banText(ban) }); }
    return json(res, 200, { u: w.name, nick: (u && u.nick) || w.name, av: (u && u.av) || 0, online: onlineSet().size });
  }

  if (p === '/api/logout') {
    const w = who(req);
    if (w) { delete toks[w.token]; saveT(); }
    return json(res, 200, { ok: true });
  }

  if (p === '/api/chat' && req.method === 'GET') {
    const w = who(req);
    if (!w) return json(res, 401, { err: '登录凭证已失效' });
    const since = Number(url.searchParams.get('since')) || 0;
    const msgs = chat.filter(m => m.id > since).slice(-80);
    return json(res, 200, { msgs, online: onlineSet().size, seq });
  }

  if (p === '/api/chat' && req.method === 'POST') {
    const w = who(req);
    if (!w) return json(res, 401, { err: '登录凭证已失效' });
    const u = users[w.name.toLowerCase()];
    const ban = u && banOf(u);
    if (ban) return json(res, 403, { err: '该账号已被封禁 · ' + banText(ban) });
    if (!allow(ip, 24, 3e4)) return json(res, 429, { err: '说得太快了，喘口气' });
    const b = await readJson(req);
    const txt = String(b.txt || '').replace(/\s+/g, ' ').trim().slice(0, MSG_MAX);
    if (!txt) return json(res, 400, { err: '空消息' });
    const m = push({ u: w.name, n: (u && u.nick) || w.name, txt });
    return json(res, 200, { ok: true, id: m.id, t: m.t });
  }


  if (p === '/api/nick' && req.method === 'POST') {
    const w = who(req);
    if (!w) return json(res, 401, { err: '登录凭证已失效' });
    const u = users[w.name.toLowerCase()];
    if (!u) return json(res, 401, { err: '登录凭证已失效' });
    const ban = banOf(u);
    if (ban) return json(res, 403, { err: '该账号已被封禁 · ' + banText(ban) });
    if (!allow(ip, 8, 6e4)) return json(res, 429, { err: '改得太频繁，歇一下' });
    const b = await readJson(req);
    const nick = String(b.nick || '').trim();
    if (!NAME_RE.test(nick)) return json(res, 400, { err: '昵称需 2-16 位：中英文、数字、下划线' });
    const low = nick.toLowerCase();
    for (const k in users) {
      if (k === w.name.toLowerCase()) continue;
      if (((users[k].nick || users[k].u) + '').toLowerCase() === low) return json(res, 409, { err: '这个昵称已经有人用了' });
    }
    u.nick = nick;
    saveU();
    return json(res, 200, { ok: true, nick });
  }

  /* ---------------- 战役进度 ---------------- */
  if (p === '/api/progress' && req.method === 'GET') {
    const w = who(req);
    if (!w) return json(res, 401, { err: '登录凭证已失效' });
    const u = users[w.name.toLowerCase()];
    return json(res, 200, { progress: (u && u.progress) || {} });
  }

  if (p === '/api/progress' && req.method === 'POST') {
    const w = who(req);
    if (!w) return json(res, 401, { err: '登录凭证已失效' });
    const u = users[w.name.toLowerCase()];
    if (!u) return json(res, 401, { err: '登录凭证已失效' });
    const ban = banOf(u);
    if (ban) return json(res, 403, { err: '该账号已被封禁 · ' + banText(ban) });
    if (!allow(ip, 40, 6e4)) return json(res, 429, { err: '提交太频繁' });
    const b = await readJson(req);
    const lv = String(b.level || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 24);
    if (!lv) return json(res, 400, { err: '缺少关卡标识' });
    const tm = Math.max(0, Math.min(99999, Math.round(Number(b.time) || 0)));
    u.progress = u.progress || {};
    const pv = u.progress[lv] || { done: false, best: 0, plays: 0 };
    pv.done = true;
    pv.plays = (pv.plays || 0) + 1;
    if (tm > 0 && (!pv.best || tm < pv.best)) pv.best = tm;
    pv.at = Date.now();
    u.progress[lv] = pv;
    saveU();
    audit('clear-level', w.name, lv + ' ' + tm + 's');
    return json(res, 200, { ok: true, progress: u.progress });
  }

  /* ---- 意见反馈 · 用户端 ---- */
  if (p === '/api/feedback' && req.method === 'POST') {
    const w = who(req);
    if (!w) return json(res, 401, { err: '登录凭证已失效' });
    const u = users[w.name.toLowerCase()];
    if (!u) return json(res, 401, { err: '登录凭证已失效' });
    const ban = banOf(u);
    if (ban) return json(res, 403, { err: '该账号已被封禁 · ' + banText(ban) });
    if (!allow('fb' + ip, 6, 6e4)) return json(res, 429, { err: '提交太频繁，稍后再试' });
    const b = await readJson(req);
    let text = String((b && b.text) || '').replace(/\s+/g, ' ').trim();
    if (text.length < 4) return json(res, 400, { err: '至少写 4 个字' });
    if (text.length > 600) text = text.slice(0, 600);
    const fb = loadFb();
    const item = {
      id: crypto.randomBytes(6).toString('hex'),
      u: u.u, nick: u.nick || u.u,
      text, at: Date.now(),
      reply: '', replyAt: 0, by: ''
    };
    fb.push(item);
    if (fb.length > 3000) fb.splice(0, fb.length - 3000);
    saveFb(fb);
    audit('feedback', u.u, text.slice(0, 40));
    return json(res, 200, { ok: true, id: item.id });
  }

  if (p === '/api/feedback' && req.method === 'GET') {
    const w = who(req);
    if (!w) return json(res, 401, { err: '登录凭证已失效' });
    const meLow = w.name.toLowerCase();
    const list = loadFb()
      .filter(x => String(x.u || '').toLowerCase() === meLow)
      .slice(-20).reverse();
    return json(res, 200, { list });
  }

  if (p === '/api/avatar' && req.method === 'GET') {
    const key = String(url.searchParams.get('u') || '').toLowerCase();
    const u = users[key];
    if (!u || !u.av) return json(res, 404, { err: '还没有头像' });
    const fp = path.join(F.avatars, key + '.jpg');
    let st;
    try { st = fs.statSync(fp); } catch (e) { return json(res, 404, { err: '还没有头像' }); }
    res.writeHead(200, {
      'content-type': 'image/jpeg',
      'content-length': st.size,
      'cache-control': 'public, max-age=86400',
      'access-control-allow-origin': '*',
    });
    return fs.createReadStream(fp).pipe(res);
  }

  if (p === '/api/avatar' && req.method === 'POST') {
    const w = who(req);
    if (!w) return json(res, 401, { err: '登录凭证已失效' });
    const u = users[w.name.toLowerCase()];
    if (!u) return json(res, 401, { err: '登录凭证已失效' });
    const ban = banOf(u);
    if (ban) return json(res, 403, { err: '该账号已被封禁 · ' + banText(ban) });
    if (!allow(ip, 6, 6e4)) return json(res, 429, { err: '上传太频繁，稍后再试' });
    const b = await readJson(req);
    const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(b.img || ''));
    if (!m) return json(res, 400, { err: '仅支持 JPEG' });
    const buf = Buffer.from(m[1], 'base64');
    if (buf.length < 64 || buf[0] !== 0xFF || buf[1] !== 0xD8) return json(res, 400, { err: '不是有效的 JPEG' });
    if (buf.length > 400 * 1024) return json(res, 400, { err: '图片太大（上限 400 KB）' });
    const fp = path.join(F.avatars, w.name.toLowerCase() + '.jpg');
    fs.writeFileSync(fp, buf);
    u.av = Date.now();
    saveU();
    return json(res, 200, { ok: true, av: u.av });
  }

  /* ================= 后台 ================= */

  if (p === '/api/admin/login' && req.method === 'POST') {
    if (!allow(ip, 10, 3e5)) return json(res, 429, { err: '尝试过多' });
    const b = await readJson(req);
    const u = String(b.u || '').trim();
    const pw = String(b.p || '');
    if (u.toLowerCase() !== admins.u || hash(pw, admins.salt) !== admins.hash) {
      return json(res, 401, { err: '管理员账号或密码不正确' });
    }
    const t = rnd(24);
    atoks[t] = { u: admins.u, exp: Date.now() + ATTL };
    saveA();
    return json(res, 200, { token: t, u: admins.u });
  }

  if (p.indexOf('/api/admin/') === 0) {
    const a = adminOf(req);
    if (!a) return json(res, 401, { err: '管理员会话已过期' });
    const act = p.slice('/api/admin/'.length);

    if (act === 'feedback') {
      const all = loadFb().slice().reverse();
      const open = all.filter(x => !x.reply).length;
      return json(res, 200, { list: all.slice(0, 300), total: all.length, open });
    }

    if (act === 'fb-reply' && req.method === 'POST') {
      const b = await readJson(req);
      const id = String((b && b.id) || '');
      let reply = String((b && b.reply) || '').replace(/\s+/g, ' ').trim();
      if (!id) return json(res, 400, { err: '缺少反馈编号' });
      if (!reply) return json(res, 400, { err: '回复内容不能为空' });
      if (reply.length > 500) reply = reply.slice(0, 500);
      const fb = loadFb();
      const it = fb.find(x => x.id === id);
      if (!it) return json(res, 404, { err: '这条反馈不存在' });
      it.reply = reply;
      it.replyAt = Date.now();
      it.by = a.u;
      saveFb(fb);
      audit('fb-reply', it.u, reply.slice(0, 40));
      return json(res, 200, { ok: true });
    }

    if (act === 'fb-del' && req.method === 'POST') {
      const b = await readJson(req);
      const id = String((b && b.id) || '');
      const fb = loadFb();
      const i = fb.findIndex(x => x.id === id);
      if (i < 0) return json(res, 404, { err: '这条反馈不存在' });
      fb.splice(i, 1);
      saveFb(fb);
      return json(res, 200, { ok: true });
    }

    if (act === 'stats') {
      const now = Date.now();
      const list = Object.values(users);
      return json(res, 200, {
        users: list.length,
        online: onlineSet().size,
        banned: list.filter(u => banOf(u)).length,
        msgs: chat.length,
        notices: notices.length,
        allowRegister: !!conf.allowRegister,
        uptime: Math.floor(process.uptime()),
      });
    }

    if (act === 'users') {
      const q = String(url.searchParams.get('q') || '').toLowerCase();
      const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
      const size = Math.min(100, Number(url.searchParams.get('size')) || 10);
      const on = onlineSet();
      let list = Object.values(users).map(u => ({
        key: u.u.toLowerCase(),
        u: u.u,
        created: u.created || 0,
        last: u.last || 0,
        online: on.has(u.u),
        banned: !!banOf(u),
        ban: banOf(u) || null,
      }));
      if (q) list = list.filter(x => x.u.toLowerCase().indexOf(q) >= 0);
      list.sort((x, y) => (y.created || 0) - (x.created || 0));
      const total = list.length;
      return json(res, 200, { total, page, size, list: list.slice((page - 1) * size, page * size) });
    }

    if (act === 'ban' && req.method === 'POST') {
      const b = await readJson(req);
      const key = String(b.u || '').toLowerCase();
      const u = users[key];
      if (!u) return json(res, 404, { err: '用户不存在' });
      const days = Math.max(0, Number(b.days) || 0);
      u.ban = days > 0
        ? { until: Date.now() + days * 864e5, reason: String(b.reason || '').slice(0, 80), at: Date.now() }
        : { until: 0, reason: String(b.reason || '').slice(0, 80), at: Date.now() };
      saveU();
      audit('ban', u.u, { days, reason: u.ban.reason, until: u.ban.until });
      const kicked = kickUser(u.u);
      return json(res, 200, { ok: true, kicked });
    }

    if (act === 'unban' && req.method === 'POST') {
      const b = await readJson(req);
      const u = users[String(b.u || '').toLowerCase()];
      if (!u) return json(res, 404, { err: '用户不存在' });
      u.ban = null;
      saveU();
      audit('unban', u.u);
      return json(res, 200, { ok: true });
    }

    if (act === 'audit') {
      let lines = [];
      try {
        lines = fs.readFileSync(F.audit, 'utf8').trim().split('\n').filter(Boolean).slice(-300).reverse();
      } catch (e) {}
      const list = lines.map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).filter(Boolean);
      return json(res, 200, { list, total: list.length });
    }

    if (act === 'user/pass' && req.method === 'POST') {
      const b = await readJson(req);
      const u = users[String(b.u || '').toLowerCase()];
      if (!u) return json(res, 404, { err: '用户不存在' });
      let p = String(b.p || '').trim();
      const gen = !p;
      if (gen) {
        const A = 'abcdefghjkmnpqrstuvwxyz23456789';
        p = '';
        for (let i = 0; i < 10; i++) p += A[Math.floor(Math.random() * A.length)];
      }
      if (p.length < 6 || p.length > 64) return json(res, 400, { err: '密码需 6-64 位' });
      const salt = rnd(16);
      u.salt = salt;
      u.hash = hash(p, salt);
      u.last = Date.now();
      saveU();
      kickUser(u.u);
      audit('reset-pass', u.u, { generated: gen });
      return json(res, 200, { ok: true, pass: p, generated: gen });
    }

    if (act === 'user/del' && req.method === 'POST') {
      const b = await readJson(req);
      const key = String(b.u || '').toLowerCase();
      if (!users[key]) return json(res, 404, { err: '用户不存在' });
      kickUser(users[key].u);
      delete users[key];
      saveU();
      return json(res, 200, { ok: true });
    }

    if (act === 'notices') {
      return json(res, 200, { list: notices.slice().sort((x, y) => (y.updated || 0) - (x.updated || 0)) });
    }

    if (act === 'notice' && req.method === 'POST') {
      const b = await readJson(req);
      const title = String(b.title || '').trim().slice(0, 60);
      const body = String(b.body || '').trim().slice(0, 2000);
      if (!title) return json(res, 400, { err: '标题不能为空' });
      const level = ['info', 'warning', 'success', 'error'].indexOf(b.level) >= 0 ? b.level : 'info';
      const active = b.active !== false;
      let item = null;
      if (b.id) item = notices.find(n => n.id === Number(b.id));
      if (item) {
        item.title = title; item.body = body; item.level = level; item.active = active; item.updated = Date.now();
      } else {
        nid++;
        item = { id: nid, title, body, level, active, created: Date.now(), updated: Date.now() };
        notices.push(item);
      }
      saveN();
      return json(res, 200, { ok: true, item });
    }

    if (act === 'notice/del' && req.method === 'POST') {
      const b = await readJson(req);
      const id = Number(b.id);
      const i = notices.findIndex(n => n.id === id);
      if (i < 0) return json(res, 404, { err: '公告不存在' });
      notices.splice(i, 1);
      saveN();
      return json(res, 200, { ok: true });
    }

    if (act === 'about') {
      if (req.method === 'POST') {
        const b = await readJson(req);
        about = {
          title: String(b.title || '关于 Saltline').trim().slice(0, 60),
          body: String(b.body || '').slice(0, 4000),
          updated: Date.now(),
        };
        wr(F.about, about);
        return json(res, 200, { ok: true, about });
      }
      return json(res, 200, { about });
    }

    if (act === 'config') {
      if (req.method === 'POST') {
        const b = await readJson(req);
        if (typeof b.allowRegister === 'boolean') conf.allowRegister = b.allowRegister;
        wr(F.config, conf);
        return json(res, 200, { ok: true, config: conf });
      }
      return json(res, 200, { config: conf });
    }

    if (act === 'chat/del' && req.method === 'POST') {
      const b = await readJson(req);
      const id = Number(b.id);
      const i = chat.findIndex(m => m.id === id);
      if (i < 0) return json(res, 404, { err: '消息不存在' });
      chat.splice(i, 1);
      try { fs.writeFileSync(F.chat, chat.map(x => JSON.stringify(x)).join('\n') + (chat.length ? '\n' : '')); } catch (e) {}
      return json(res, 200, { ok: true });
    }

    return json(res, 404, { err: 'unknown admin action' });
  }

  /* ================= 管理后台静态（/admin/ -> admin/dist） ================= */
  if ((req.method === 'GET' || req.method === 'HEAD') && p.startsWith('/admin')) {
    const ADM = path.join(__dirname, '..', 'admin', 'dist');
    let rel = p.replace(/^\/admin\/?/, '') || 'index.html';
    try { rel = decodeURIComponent(rel); } catch (e) {}
    const full = path.normalize(path.join(ADM, rel));
    if (full.startsWith(ADM)) {
      let st = null;
      try { st = fs.statSync(full); } catch (e) {}
      if (st && st.isFile()) {
        const MIME = { '.html':'text/html;charset=utf-8', '.js':'application/javascript;charset=utf-8',
          '.css':'text/css;charset=utf-8', '.json':'application/json;charset=utf-8',
          '.png':'image/png', '.jpg':'image/jpeg', '.svg':'image/svg+xml', '.ico':'image/x-icon',
          '.woff2':'font/woff2', '.map':'application/json;charset=utf-8' };
        const ext = path.extname(full).toLowerCase();
        const buf = fs.readFileSync(full);
        res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream',
          'content-length': buf.length, 'cache-control': 'no-store' });
        return res.end(req.method === 'HEAD' ? undefined : buf);
      }
    }
  }

  /* ================= 静态文件（Render 单进程部署） ================= */
  if (req.method === 'GET' || req.method === 'HEAD') {
    const WEB = path.join(__dirname, '..', 'web');
    let rel = p === '/' ? '/index.html' : p;
    try { rel = decodeURIComponent(rel); } catch (e) {}
    const full = path.normalize(path.join(WEB, rel));
    if (full.startsWith(WEB)) {
      let st = null;
      try { st = fs.statSync(full); } catch (e) {}
      if (st && st.isFile()) {
        const MIME = { '.html':'text/html;charset=utf-8', '.js':'application/javascript;charset=utf-8',
          '.css':'text/css;charset=utf-8', '.json':'application/json;charset=utf-8',
          '.png':'image/png', '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.svg':'image/svg+xml',
          '.ico':'image/x-icon', '.woff2':'font/woff2', '.txt':'text/plain;charset=utf-8' };
        const ext = path.extname(full).toLowerCase();
        const type = MIME[ext] || 'application/octet-stream';
        const buf = fs.readFileSync(full);
        res.writeHead(200, { 'content-type': type, 'content-length': buf.length,
          'cache-control': ext === '.html' ? 'no-cache' : 'public, max-age=300' });
        return res.end(req.method === 'HEAD' ? undefined : buf);
      }
    }
  }

  json(res, 404, { err: 'not found' });
});

/* ================= 联机合作 · WebSocket ================= */
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const rooms = new Map();
const MAX_ROOMS = 200, MAX_PLAYERS = 4;

function wsAccept(key) {
  return crypto.createHash('sha1').update(key + WS_GUID).digest('base64');
}

function wsFrame(str) {
  const buf = Buffer.from(str, 'utf8');
  const len = buf.length;
  let head;
  if (len < 126) {
    head = Buffer.alloc(2); head[0] = 0x81; head[1] = len;
  } else if (len < 65536) {
    head = Buffer.alloc(4); head[0] = 0x81; head[1] = 126; head.writeUInt16BE(len, 2);
  } else {
    head = Buffer.alloc(10); head[0] = 0x81; head[1] = 127;
    head.writeUInt32BE(0, 2); head.writeUInt32BE(len, 6);
  }
  return Buffer.concat([head, buf]);
}

function wsParse(st, chunk) {
  st.buf = Buffer.concat([st.buf, chunk]);
  const out = [];
  for (;;) {
    const b = st.buf;
    if (b.length < 2) break;
    const op = b[0] & 0x0f;
    const masked = (b[1] & 0x80) !== 0;
    let len = b[1] & 0x7f, off = 2;
    if (len === 126) { if (b.length < 4) break; len = b.readUInt16BE(2); off = 4; }
    else if (len === 127) { if (b.length < 10) break; len = Number(b.readBigUInt64BE(2)); off = 10; }
    const ml = masked ? 4 : 0;
    if (b.length < off + ml + len) break;
    const mask = masked ? b.slice(off, off + 4) : null;
    off += ml;
    const pay = Buffer.from(b.slice(off, off + len));
    if (mask) for (let i = 0; i < pay.length; i++) pay[i] ^= mask[i & 3];
    st.buf = b.slice(off + len);
    if (op === 8) { out.push({ close: true }); break; }
    if (op === 9) out.push({ ping: pay });
    if (op === 1) out.push({ text: pay.toString('utf8') });
  }
  return out;
}

function rSend(room, obj, except) {
  const f = wsFrame(JSON.stringify(obj));
  for (const p of room.players) {
    if (p === except) continue;
    try { p.sock.write(f); } catch (e) {}
  }
}

function rSnapshot(room) {
  return {
    t: 'snap',
    p: room.players.map(p => ({
      i: p.id, n: p.nick, a: p.av,
      x: Math.round(p.x * 100) / 100,
      y: Math.round(p.y * 100) / 100,
      z: Math.round(p.z * 100) / 100,
      r: Math.round(p.yaw * 100) / 100,
      q: Math.round(p.pitch * 100) / 100,
      s: p.st | 0
    })),
    relays: room.relays,
    st: room.state
  };
}

let seqId = 0;
server.on('upgrade', (req, sock) => {
  console.log('[ws] upgrade ' + String(req.url||'').slice(0,70));
  let url;
  try { url = new URL(req.url, 'http://x'); } catch (e) { sock.destroy(); return; }
  if (url.pathname !== '/ws/coop') { sock.destroy(); return; }

  const tok = String(url.searchParams.get('token') || '');
  const te = toks[tok];
  if (!te || te.exp < Date.now()) {
    try { sock.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); } catch (e) {}
    sock.destroy(); return;
  }
  const uobj = users[te.u.toLowerCase()];
  if (!uobj || banOf(uobj)) {
    try { sock.write('HTTP/1.1 403 Forbidden\r\n\r\n'); } catch (e) {}
    sock.destroy(); return;
  }

  const key = req.headers['sec-websocket-key'];
  if (!key) { sock.destroy(); return; }
  sock.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    'Sec-WebSocket-Accept: ' + wsAccept(key) + '\r\n\r\n'
  );
  sock.setNoDelay(true);

  /* --- 找房间 --- */
  let rid = String(url.searchParams.get('room') || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  const level = String(url.searchParams.get('level') || 'dock').replace(/[^a-z0-9_-]/gi, '').slice(0, 24);
  if (!rid) rid = 'PUBLIC';
  let room = rooms.get(rid);
  if (!room) {
    if (rooms.size >= MAX_ROOMS) {
      try { sock.write(wsFrame(JSON.stringify({ t: 'err', msg: '服务器房间满了' }))); } catch (e) {}
      sock.destroy(); return;
    }
    room = { id: rid, level, players: [], relays: { a: 0, b: 0, c: 0 }, state: 'lobby', created: Date.now() };
    rooms.set(rid, room);
  }
  if (room.players.length >= MAX_PLAYERS) {
    try { sock.write(wsFrame(JSON.stringify({ t: 'err', msg: '房间已满（最多 ' + MAX_PLAYERS + ' 人）' }))); } catch (e) {}
    sock.destroy(); return;
  }

  const me = {
    id: ++seqId, sock,
    u: uobj.u, nick: uobj.nick || uobj.u, av: uobj.av || 0,
    x: 0, y: 0, z: 0, yaw: 0, pitch: 0, st: 0,
    joined: Date.now()
  };
  room.players.push(me);

  const st = { buf: Buffer.alloc(0) };
  const send = obj => { try { sock.write(wsFrame(JSON.stringify(obj))); } catch (e) {} };

  send({
    t: 'joined', room: room.id, you: me.id, level: room.level,
    players: rSnapshot(room).p, relays: room.relays, host: room.players[0].id
  });
  rSend(room, { t: 'peer', act: 'in', id: me.id, n: me.nick, a: me.av }, me);

  sock.on('data', chunk => {
    let msgs;
    try { msgs = wsParse(st, chunk); } catch (e) { return; }
    for (const m of msgs) {
      if (m.close) { sock.destroy(); return; }
      if (m.ping) { try { sock.write(Buffer.from([0x8a, m.ping.length]), ), sock.write(m.ping); } catch (e) {} continue; }
      if (!m.text) continue;
      let d;
      try { d = JSON.parse(m.text); } catch (e) { continue; }
      if (!d || typeof d.t !== 'string') continue;

      if (d.t === 'pos') {
        if (typeof d.x === 'number' && isFinite(d.x)) me.x = d.x;
        if (typeof d.y === 'number' && isFinite(d.y)) me.y = d.y;
        if (typeof d.z === 'number' && isFinite(d.z)) me.z = d.z;
        if (typeof d.r === 'number' && isFinite(d.r)) me.yaw = d.r;
        if (typeof d.q === 'number' && isFinite(d.q)) me.pitch = d.q;
        if (typeof d.s === 'number') me.st = d.s | 0;
      } else if (d.t === 'relay') {
        const k = String(d.id || '').toLowerCase().slice(0, 1);
        if (!room.relays.hasOwnProperty(k)) continue;
        if (room.relays[k]) continue;
        room.relays[k] = 1;
        rSend(room, { t: 'relay', id: k, by: me.nick });
      } else if (d.t === 'ask') {
        send(rSnapshot(room));
      } else if (d.t === 'state') {
        const v = String(d.v || '');
        if (v === 'playing' || v === 'lobby') room.state = v;
        rSend(room, { t: 'state', v: room.state }, me);
      }
    }
  });

  const bye = () => {
    const i = room.players.indexOf(me);
    if (i >= 0) room.players.splice(i, 1);
    try { sock.destroy(); } catch (e) {}
    if (!room.players.length) { rooms.delete(room.id); return; }
    rSend(room, { t: 'peer', act: 'out', id: me.id, n: me.nick }, me);
  };
  sock.on('close', bye);
  sock.on('error', bye);
  sock.on('end', bye);
});

/* 10 Hz 状态广播 */
setInterval(() => {
  for (const room of rooms.values()) {
    if (!room.players.length) continue;
    rSend(room, rSnapshot(room));
  }
}, 100);

/* 房间统计 */
if (!global.__coopStats) {
  global.__coopStats = () => {
    const list = [];
    for (const r of rooms.values()) {
      list.push({ id: r.id, level: r.level, n: r.players.length, relays: r.relays, age: Math.round((Date.now() - r.created) / 1000) });
    }
    return list;
  };
}

server.listen(PORT, '0.0.0.0', () => {
  console.log('[saltline-api] listening on 0.0.0.0:' + PORT);
});