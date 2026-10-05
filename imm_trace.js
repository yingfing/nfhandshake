/**
 * 专门诊断：发 /server imm 之后到底发生了什么。
 * 重点打印 /server imm 之后的所有 chat 原文、custom_payload、配置阶段包、踢人提示、spawn/login。
 *
 * 用法: node imm_trace.js [秒数]
 */
const mineflayer = require('mineflayer');
const fs = require('fs');

const OUT = 'F:/wish/Fab-Neo/bot/';
function ts() { return new Date().toISOString().slice(11, 19); }
function log(...a) { console.log(ts(), ...a); }

function varint(n) { const o = []; n = n >>> 0; while (true) { if ((n & 0xffffff80) === 0) { o.push(n); break } o.push((n & 0x7f) | 0x80); n >>>= 7 } return Buffer.from(o); }
function mcStr(s) { const b = Buffer.from(s, 'utf8'); return Buffer.concat([varint(b.length), b]); }
function flowOrd(s) { const u = String(s || '').toUpperCase(); if (u.includes('SERVERBOUND')) return 0; if (u.includes('CLIENTBOUND')) return 1; return null; }
function buildComponent(id, version, fo, optional) {
  const p = [mcStr(id), mcStr(version || '')];
  if (fo === null || fo === undefined) p.push(Buffer.from([0x00]));
  else p.push(Buffer.concat([Buffer.from([0x01]), varint(fo)]));
  p.push(Buffer.from([optional ? 0x01 : 0x00]));
  return Buffer.concat(p);
}
function buildQuery(proto, list) {
  const p = [varint(1), varint(proto), varint(list.length)];
  for (const c of list) p.push(buildComponent(c.id, c.version, c.flow, true));
  return Buffer.concat(p);
}

const spec = JSON.parse(fs.readFileSync(OUT + 'learned.json', 'utf8'));
const PROTO = parseInt(process.env.PROTO || '1', 10);
const table = Object.entries(spec).map(([id, v]) => ({ id, version: v.version || '', flow: flowOrd(v.flowOrd !== undefined && v.flowOrd !== null ? (v.flowOrd === 0 ? 'SERVERBOUND' : 'CLIENTBOUND') : v.flow) }));
const QUERY = buildQuery(PROTO, table);

let repliedOnce = false;
let sentImm = false;
let afterImm = false;
const spawnTimes = [], loginTimes = [];
const configAfterImm = [];
const chatAfterImm = [];
const kicked = [];

const bot = mineflayer.createBot({ host: 'mc.mcme.uno', username: 'TextValue', auth: 'offline', version: '1.21.1', hideErrors: false });

function replyRegister() {
  if (repliedOnce) return;
  repliedOnce = true;
  log('>>> [register] 回复 390 通道 (' + QUERY.length + ' B)');
  bot._client.write('custom_payload', { channel: 'neoforge:register', data: QUERY });
}

bot._client.on('custom_payload', (data) => {
  const ch = data.channel, len = data.data ? data.data.length : 0;
  if (ch === 'neoforge:register') { replyRegister(); return; }
  if (ch === 'neoforge:network') { log('*** 协商通过 (neoforge:network, ' + len + ' B)'); return; }
  if (afterImm) log('<<< [imm后] payload ' + ch + ' len=' + len);
});

bot._client.on('packet', (d, m) => {
  const n = m.name;
  if (!afterImm) {
    // 在发 imm 之前，若检测到配置相关包，也记一下（诊断重配置时机）
    return;
  }
  if (/config|finish|registry|select_known|known_packs|login|game_join|join_game|position/i.test(n)) {
    configAfterImm.push(ts() + ' ' + n);
    log('*** [imm后] 包 ' + n);
  }
});

bot.on('spawn', () => {
  spawnTimes.push(ts());
  log('*** [spawn] #' + spawnTimes.length + ' @ ' + ts());
  if (!sentImm) { sentImm = true; setTimeout(() => { afterImm = true; log('>>> 发送 /server imm'); bot.chat('/server imm'); }, 3000); }
});

bot.on('messagestr', (msg) => {
  const s = String(msg);
  if (afterImm) { chatAfterImm.push(ts() + ' ' + s); log('CHAT[imm后]: ' + s.slice(0, 300)); }
  if (/unable to connect|could ?n.?t connect|invalid|kick|disconnect|no such server|unknown server|transfer/i.test(s)) { kicked.push(ts() + ' ' + s); log('!!! 疑似踢人/失败: ' + s.slice(0, 200)); }
});

bot.on('end', (r) => { log('EVENT end: ' + r); finish(); });
bot.on('error', (e) => log('EVENT error: ' + (e && e.message)));

function finish() {
  log('============ imm_trace 结论 ============');
  log('  spawn 次数 : ' + spawnTimes.length);
  log('  login 次数 : ' + loginTimes.length);
  log('  imm后聊天  : ' + (chatAfterImm.length ? '\n    ' + chatAfterImm.join('\n    ') : '(无)'));
  log('  疑似失败   : ' + (kicked.length ? '\n    ' + kicked.join('\n    ') : '(无)'));
  log('  imm后配置包: ' + (configAfterImm.length ? '\n    ' + configAfterImm.join('\n    ') : '(无)'));
  fs.writeFileSync(OUT + 'imm_trace_result.json', JSON.stringify({ spawnTimes, chatAfterImm, kicked, configAfterImm }, null, 2));
  setTimeout(() => process.exit(0), 300);
}

const secs = parseInt(process.argv[2] || '100', 10);
setTimeout(() => { log('TIMEOUT ' + secs + 's'); finish(); }, secs * 1000);
