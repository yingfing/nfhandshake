/**
 * 只回答一个问题：bot 连 mc.mcme.uno 后，到底收到几次 spawn / login？
 * 每次发生都带时间戳打印，不靠布尔量。
 *
 * 用法: node count_spawn.js [秒数]
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
log('载入 ' + table.length + ' 通道, 查询包 ' + QUERY.length + ' B');

let repliedOnce = false;        // 每条连接只回一次
const spawnTimes = [];
const loginTimes = [];
const events = [];

const bot = mineflayer.createBot({ host: 'mc.mcme.uno', username: 'TextValue', auth: 'offline', version: '1.21.1', hideErrors: false });

bot._client.on('custom_payload', (data) => {
  const ch = data.channel;
  const len = data.data ? data.data.length : 0;
  if (ch === 'neoforge:register' && !repliedOnce) {
    repliedOnce = true;
    log('>>> [register] 回复 390 通道查询 (' + QUERY.length + ' B)');
    bot._client.write('custom_payload', { channel: 'neoforge:register', data: QUERY });
    return;
  }
  if (ch === 'neoforge:network') {
    log('*** [M1] 协商通过 (neoforge:network, ' + len + ' B)');
    return;
  }
  log('<<< payload ' + ch + ' len=' + len);
});

bot._client.on('packet', (d, m) => {
  const n = m.name;
  if (/^login$|game_join|join_game/i.test(n)) { loginTimes.push(ts()); events.push(ts() + ' LOGIN/' + n); log('*** [login] ' + n + '  次数=' + loginTimes.length); }
  if (/position/i.test(n)) { events.push(ts() + ' POSITION/' + n); log('*** [position] ' + n); }
});

bot.on('spawn', () => {
  spawnTimes.push(ts());
  events.push(ts() + ' SPAWN  #' + spawnTimes.length);
  log('*** [spawn] #' + spawnTimes.length + ' @ ' + ts());
  if (spawnTimes.length === 1) setTimeout(() => { log('发送 /server imm'); bot.chat('/server imm'); }, 3000);
});

bot.on('messagestr', (msg) => { const s = String(msg); log('CHAT: ' + s.slice(0, 200)); if (/unable to connect to imm/i.test(s)) log('!!! 检测到进 imm 失败提示 !!!'); });

bot.on('end', (r) => { log('EVENT end: ' + r); finish(); });
bot.on('error', (e) => log('EVENT error: ' + (e && e.message)));

function finish() {
  log('================ 结论 ================');
  log('  spawn 次数 : ' + spawnTimes.length + (spawnTimes.length ? '  @ ' + spawnTimes.join(', ') : ''));
  log('  login 次数 : ' + loginTimes.length + (loginTimes.length ? '  @ ' + loginTimes.join(', ') : ''));
  log('  事件序列   : ' + (events.join(' | ') || '(无)'));
  log('  判断       : ' + (spawnTimes.length >= 2 ? '✅ 出现两次 spawn —— 进入过子服 imm' : '❌ 只有/不到一次 spawn —— 没进 imm'));
  fs.writeFileSync(OUT + 'count_spawn_result.json', JSON.stringify({ spawnTimes, loginTimes, events }, null, 2));
  setTimeout(() => process.exit(0), 300);
}

const secs = parseInt(process.argv[2] || '120', 10);
setTimeout(() => { log('TIMEOUT ' + secs + 's'); finish(); }, secs * 1000);
