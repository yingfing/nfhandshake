/**
 * 硬碰实验：/server imm 后，补回服务器要求的 configuration 阶段回应，试探能否进 imm。
 * 目前发现客户端回了 configuration_acknowledged/settings/neoforge:register/select_known_packs，
 * 但服务器发完 registry_data+tags 后不发 finish_configuration。
 * 本脚本额外补：
 *   1) 收到服务器 minecraft:register（声明频道）时，回一份 minecraft:register（声明相同频道）
 *   2) 收到 minecraft:brand 时回 brands
 *   3) tags 之后被动等待；若仍无 finish_configuration，则试探性主动发一次 finish_configuration
 * 用法: node push_imm.js [秒数]
 */
const mineflayer = require('mineflayer');
const fs = require('fs');

const OUT = 'F:/wish/Fab-Neo/bot/';
function ts() { return new Date().toISOString().slice(11, 19); }
function log(...a) { console.log(ts(), ...a); }
function varintBuf(n) { const o = []; n = n >>> 0; while (true) { if ((n & 0xffffff80) === 0) { o.push(n); break } o.push((n & 0x7f) | 0x80); n >>>= 7 } return Buffer.from(o); }
function mcStr(s) { const b = Buffer.from(s, 'utf8'); return Buffer.concat([varintBuf(b.length), b]); }
function readVarInt(b, o) { let r = 0, s = 0, x; do { x = b[o++]; r |= (x & 0x7f) << s; s += 7 } while (x & 0x80); return [r, o]; }
function readUtf(b, o) { const [len, o2] = readVarInt(b, o); return [b.slice(o2, o2 + len).toString('utf8'), o2 + len]; }
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
let gotTags = false, sentFinish = false;
let spawns = 0, logins = 0;

const bot = mineflayer.createBot({ host: 'mc.mcme.uno', username: 'TextValue', auth: 'offline', version: '1.21.1', hideErrors: false });

const _write = bot._client.write.bind(bot._client);
bot._client.write = function (name, params) { if (afterImm) log('TX ' + name); return _write(name, params); };

function replyRegister() { if (repliedOnce) return; repliedOnce = true; log('>>> 回复 390 通道'); bot._client.write('custom_payload', { channel: 'neoforge:register', data: QUERY }); }

bot._client.on('custom_payload', (d) => {
  const ch = d.channel;
  if (ch === 'neoforge:register') { replyRegister(); return; }
  if (ch === 'neoforge:network') { log('*** 协商通过'); return; }
  if (afterImm && ch === 'minecraft:register' && d.data) {
    // 服务器声明了频道，客户端回同样的声明
    log('RX minecraft:register -> 回相同声明');
    bot._client.write('custom_payload', { channel: 'minecraft:register', data: d.data });
  }
  if (afterImm && ch === 'minecraft:brand' && d.data) {
    log('RX minecraft:brand -> 回 "fabric"');
    const b = Buffer.concat([varintBuf(6), Buffer.from('fabric')]);
    bot._client.write('custom_payload', { channel: 'minecraft:brand', data: b });
  }
});

bot._client.on('packet', (data, meta) => {
  const n = meta && meta.name || '?';
  if (afterImm) log('RX ' + n);
  if (n === 'tags' && afterImm && !gotTags) { gotTags = true; log('*** 收到 tags -> 3s 后试探发 finish_configuration'); setTimeout(tryFinish, 3000); }
  if (/^login$|game_join|join_game/i.test(n)) { logins++; log('*** [login] ' + n + ' #' + logins); }
});

function tryFinish() {
  if (sentFinish) return; sentFinish = true;
  log('>>> 试探性主动发 finish_configuration');
  bot._client.write('finish_configuration', {});
}

bot.on('spawn', () => { spawns++; log('*** [spawn] #' + spawns + ' @ ' + ts()); if (!sentImm) { sentImm = true; setTimeout(() => { afterImm = true; log('>>> /server imm'); bot.chat('/server imm'); }, 3000); } });
bot.on('messagestr', (m) => { const s = String(m); if (/unable to connect|could ?n.?t connect|invalid|kick|disconnect|no such server/i.test(s)) log('!!! ' + s.slice(0, 160)); });
bot.on('end', (r) => { log('EVENT end ' + r); finish(); });
bot.on('error', (e) => log('EVENT error ' + (e && e.message)));

function finish() { log('=== 结论 === spawn=' + spawns + ' login=' + logins); setTimeout(() => process.exit(0), 300); }
const secs = parseInt(process.argv[2] || '90', 10);
setTimeout(() => { log('TIMEOUT'); finish(); }, secs * 1000);
