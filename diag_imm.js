/**
 * 细粒度诊断：/server imm 之后，逐包记录【收到】与【发出】，定位卡在哪一步。
 * 用法: node diag_imm.js [秒数]
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
const seqRx = [], seqTx = [];
let spawns = 0, logins = 0;

const bot = mineflayer.createBot({ host: 'mc.mcme.uno', username: 'TextValue', auth: 'offline', version: '1.21.1', hideErrors: false });

// 包 hook：记录发出
const _write = bot._client.write.bind(bot._client);
bot._client.write = function (name, params) {
  if (afterImm) { seqTx.push(ts() + ' TX ' + name); log('TX ' + name); }
  return _write(name, params);
};

function replyRegister() { if (repliedOnce) return; repliedOnce = true; log('>>> 回复 390 通道 (' + QUERY.length + ' B)'); bot._client.write('custom_payload', { channel: 'neoforge:register', data: QUERY }); }
bot._client.on('custom_payload', (d) => {
  if (d.channel === 'neoforge:register') replyRegister();
  else if (d.channel === 'neoforge:network') log('*** 协商通过');
  else if (afterImm) { seqRx.push(ts() + ' RX custom ' + d.channel); log('RX custom_payload ' + d.channel + ' len=' + (d.data ? d.data.length : 0)); }
});
bot._client.on('packet', (data, meta) => {
  const n = meta && meta.name || '?';
  if (afterImm) { seqRx.push(ts() + ' RX ' + n); log('RX ' + n); }
  if (/^login$|game_join|join_game/i.test(n)) { logins++; log('*** [login] ' + n + ' #' + logins); }
});
bot.on('spawn', () => { spawns++; log('*** [spawn] #' + spawns + ' @ ' + ts()); if (!sentImm) { sentImm = true; setTimeout(() => { afterImm = true; log('>>> /server imm'); bot.chat('/server imm'); }, 3000); } });
bot.on('messagestr', (m) => { const s = String(m); if (/unable to connect|could ?n.?t connect|invalid|kick|disconnect|no such server/i.test(s)) log('!!! ' + s.slice(0, 160)); });
bot.on('end', (r) => { log('EVENT end ' + r); finish(); });
bot.on('error', (e) => log('EVENT error ' + (e && e.message)));

function finish() {
  log('=== diag 结论 ==='); log('  spawn=' + spawns + ' login=' + logins);
  fs.writeFileSync(OUT + 'diag_imm.json', JSON.stringify({ spawns, logins, rx: seqRx, tx: seqTx }, null, 2));
  setTimeout(() => process.exit(0), 300);
}
const secs = parseInt(process.argv[2] || '90', 10);
setTimeout(() => { log('TIMEOUT'); finish(); }, secs * 1000);
