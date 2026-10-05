/**
 * 决定性诊断：服务器到底有没有发 finish_configuration？
 *   - 显式监听 bot._client.on('finish_configuration')、on('state')、on('login')
 *   - 配置状态每个包都打名（不过滤）
 *   - /server imm 后统计 spawn/login
 * 用法: node probe_finish.js [秒数]
 */
const mineflayer = require('mineflayer');
const fs = require('fs');

const OUT = 'F:/wish/Fab-Neo/bot/';
function ts() { return new Date().toISOString().slice(11, 19); }
function log(...a) { console.log(ts(), ...a); }
function varintBuf(n) { const o = []; n = n >>> 0; while (true) { if ((n & 0xffffff80) === 0) { o.push(n); break } o.push((n & 0x7f) | 0x80); n >>>= 7 } return Buffer.from(o); }
function mcStr(s) { const b = Buffer.from(s, 'utf8'); return Buffer.concat([varintBuf(b.length), b]); }
function flowOrd(s) { const u = String(s || '').toUpperCase(); if (u.includes('SERVERBOUND')) return 0; if (u.includes('CLIENTBOUND')) return 1; return null; }
function buildComponent(id, version, fo, optional) {
  const p = [mcStr(id), mcStr(version || '')];
  if (fo === null || fo === undefined) p.push(Buffer.from([0x00])); else p.push(Buffer.concat([Buffer.from([0x01]), varintBuf(fo)]));
  p.push(Buffer.from([optional ? 0x01 : 0x00])); return Buffer.concat(p);
}
function buildQuery(proto, list) { const p = [varintBuf(1), varintBuf(proto), varintBuf(list.length)]; for (const c of list) p.push(buildComponent(c.id, c.version, c.flow, true)); return Buffer.concat(p); }

const spec = JSON.parse(fs.readFileSync(OUT + 'learned.json', 'utf8'));
const PROTO = parseInt(process.env.PROTO || '1', 10);
const table = Object.entries(spec).map(([id, v]) => ({ id, version: v.version || '', flow: flowOrd(v.flowOrd !== undefined && v.flowOrd !== null ? (v.flowOrd === 0 ? 'SERVERBOUND' : 'CLIENTBOUND') : v.flow) }));
const QUERY = buildQuery(PROTO, table);

let repliedOnce = false, sentImm = false, afterImm = false;
let spawns = 0, logins = 0;
const cfgPkts = [];

const bot = mineflayer.createBot({ host: 'mc.mcme.uno', username: 'TextValue', auth: 'offline', version: '1.21.1', hideErrors: false });

// 显式决定性监听
bot._client.on('finish_configuration', () => log('!!! FINISH_CONFIGURATION 已收到（服务器发了）'));
bot._client.on('state', (newState, oldState) => log('### STATE ' + oldState + ' -> ' + newState));
bot._client.on('login', () => { logins++; log('!!! LOGIN 事件 #' + logins); });

const _write = bot._client.write.bind(bot._client);
bot._client.write = function (n, p) { if (afterImm && n !== 'keep_alive') log('TX ' + n); return _write(n, p); };

function replyRegister() { if (repliedOnce) return; repliedOnce = true; log('>>> 回 neoforge:register (' + QUERY.length + ' B)'); bot._client.write('custom_payload', { channel: 'neoforge:register', data: QUERY }); }

bot._client.on('custom_payload', (d) => {
  const ch = d.channel;
  if (ch === 'neoforge:register') { replyRegister(); return; }
  if (ch === 'neoforge:network') { log('*** 协商通过'); return; }
});
bot._client.on('packet', (data, meta) => {
  const n = meta && meta.name || '?';
  const st = meta && meta.state;
  if (st === 'configuration') { cfgPkts.push(ts() + ' ' + n); if (afterImm) log('CFG RX ' + n); }
  if (/^login$|game_join|join_game/i.test(n)) { logins++; log('*** [login] ' + n + ' #' + logins); }
});
bot.on('spawn', () => { spawns++; log('*** [spawn] #' + spawns + ' @ ' + ts()); if (!sentImm) { sentImm = true; setTimeout(() => { afterImm = true; log('>>> /server imm'); bot.chat('/server imm'); }, 3000); } });
bot.on('messagestr', (m) => { const s = String(m); if (/unable to connect|could ?n.?t connect|invalid|kick|disconnect|no such server/i.test(s)) log('!!! ' + s.slice(0, 160)); });
bot.on('end', (r) => { log('EVENT end ' + r); finish(); });
bot.on('error', (e) => log('EVENT error ' + (e && e.message)));

function finish() {
  log('=== 结论 === spawn=' + spawns + ' login=' + logins);
  log('配置状态收到的包 (' + cfgPkts.length + '):'); cfgPkts.forEach(x => log('   ' + x));
  fs.writeFileSync(OUT + 'probe_finish.json', JSON.stringify({ spawns, logins, cfgPkts }, null, 2));
  setTimeout(() => process.exit(0), 300);
}
const secs = parseInt(process.argv[2] || '90', 10);
setTimeout(() => { log('TIMEOUT'); finish(); }, secs * 1000);
