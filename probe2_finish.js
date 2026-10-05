/**
 * 硬碰突破实验：imm 重配置收到 tags 后，服务器不发 finish_configuration。
 * 尝试客户端主动发 finish_configuration，看服务器是否据此切 play 并下发 imm 的 login。
 * 用法: node probe2_finish.js [秒数]
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
let gotTags = false, sentFinish = false;
let spawns = 0, logins = 0;
const cfgPkts = [];

const bot = mineflayer.createBot({ host: 'mc.mcme.uno', username: 'TextValue', auth: 'offline', version: '1.21.1', hideErrors: false });
bot._client.on('finish_configuration', () => log('!!! 收到服务器 finish_configuration'));
bot._client.on('state', (n, o) => log('### STATE ' + o + ' -> ' + n));
bot._client.on('login', () => { logins++; log('!!! LOGIN #' + logins); });

const _write = bot._client.write.bind(bot._client);
bot._client.write = function (name, params) { if (afterImm && name !== 'keep_alive') log('TX ' + name); return _write(name, params); };

function replyRegister() { if (repliedOnce) return; repliedOnce = true; log('>>> 回 neoforge:register'); bot._client.write('custom_payload', { channel: 'neoforge:register', data: QUERY }); }
bot._client.on('custom_payload', (d) => { if (d.channel === 'neoforge:register') replyRegister(); else if (d.channel === 'neoforge:network') log('*** 协商通过'); });
bot._client.on('packet', (data, meta) => {
  const n = meta && meta.name || '?';
  if (meta && meta.state === 'configuration') { cfgPkts.push(ts() + ' ' + n); if (afterImm) log('CFG RX ' + n); }
  if (afterImm && meta && meta.state === 'play') { cfgPkts.push(ts() + ' PLAY ' + n); if (/map_chunk|level_chunk|spawn_entity|entity_metadata|set_entity_data|login|game_event|respawn|initialize_world_border|set_default_spawn|keep_alive/i.test(n)) log('PLAY RX ' + n); }
  if (n === 'tags' && afterImm && !gotTags) { gotTags = true; log('*** 收到 tags -> 5s 后主动发 finish_configuration'); setTimeout(tryFinish, 5000); }
  if (/^login$|game_join|join_game/i.test(n)) { logins++; log('*** [login] ' + n + ' #' + logins); }
});
function tryFinish() {
  if (sentFinish) return; sentFinish = true;
  log('>>> 主动发 finish_configuration + 切 state=play');
  bot._client.write('finish_configuration', {});
  try { bot._client.state = 'play'; } catch (e) { log('    切 state 失败: ' + e.message); }
}

bot.on('spawn', () => { spawns++; log('*** [spawn] #' + spawns + ' @ ' + ts()); if (!sentImm) { sentImm = true; setTimeout(() => { afterImm = true; log('>>> /server imm'); bot.chat('/server imm'); }, 3000); } });
bot.on('messagestr', (m) => { const s = String(m); if (/unable to connect|could ?n.?t connect|invalid|kick|disconnect|no such server/i.test(s)) log('!!! ' + s.slice(0, 160)); });
bot.on('end', (r) => { log('EVENT end ' + r); finish(); });
bot.on('error', (e) => log('EVENT error ' + (e && e.message)));

function finish() { log('=== 结论 === spawn=' + spawns + ' login=' + logins + ' sentFinish=' + sentFinish); fs.writeFileSync(OUT + 'probe2_finish.json', JSON.stringify({ spawns, logins, sentFinish, cfgPkts }, null, 2)); setTimeout(() => process.exit(0), 300); }
const secs = parseInt(process.argv[2] || '90', 10);
setTimeout(() => { log('TIMEOUT'); finish(); }, secs * 1000);
