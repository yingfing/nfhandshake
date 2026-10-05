/**
 * 抓取 /server imm 后的 registry_data：
 *   - 正常解析出来的 registry_data：从 packet 事件取 buffer 存盘
 *   - protodef 解析失败（PartialReadError）的畸形包：从 'partialPacket' 事件取原始 chunk 存盘
 * 同时统计 spawn/login 次数，看这次流是否不再卡死（能否进 imm）。
 *
 * 用法: node dump_registry.js [秒数]
 */
const mineflayer = require('mineflayer');
const fs = require('fs');
const path = require('path');

const OUT = 'F:/wish/Fab-Neo/bot/';
const DUMP = path.join(OUT, 'registry_dump');
fs.mkdirSync(DUMP, { recursive: true });

function ts() { return new Date().toISOString().slice(11, 19); }
function log(...a) { console.log(ts(), ...a); }

function varint(b, o) { let r = 0, s = 0, x; do { x = b[o++]; r |= (x & 0x7f) << s; s += 7 } while (x & 0x80); return [r, o]; }
function utf(b, o) { const [len, o2] = varint(b, o); return [b.slice(o2, o2 + len).toString('utf8'), o2 + len]; }

function varintBuf(n) { const o = []; n = n >>> 0; while (true) { if ((n & 0xffffff80) === 0) { o.push(n); break } o.push((n & 0x7f) | 0x80); n >>>= 7 } return Buffer.from(o); }
function mcStr(s) { const b = Buffer.from(s, 'utf8'); return Buffer.concat([varintBuf(b.length), b]); }
function flowOrd(s) { const u = String(s || '').toUpperCase(); if (u.includes('SERVERBOUND')) return 0; if (u.includes('CLIENTBOUND')) return 1; return null; }
function buildComponent(id, version, fo, optional) {
  const p = [mcStr(id), mcStr(version || '')];
  if (fo === null || fo === undefined) p.push(Buffer.from([0x00]));
  else p.push(Buffer.concat([Buffer.from([0x01]), varintBuf(fo)]));
  p.push(Buffer.from([optional ? 0x01 : 0x00]));
  return Buffer.concat(p);
}
function buildQuery(proto, list) {
  const p = [varintBuf(1), varintBuf(proto), varintBuf(list.length)];
  for (const c of list) p.push(buildComponent(c.id, c.version, c.flow, true));
  return Buffer.concat(p);
}

const spec = JSON.parse(fs.readFileSync(OUT + 'learned.json', 'utf8'));
const PROTO = parseInt(process.env.PROTO || '1', 10);
const table = Object.entries(spec).map(([id, v]) => ({ id, version: v.version || '', flow: flowOrd(v.flowOrd !== undefined && v.flowOrd !== null ? (v.flowOrd === 0 ? 'SERVERBOUND' : 'CLIENTBOUND') : v.flow) }));
const QUERY = buildQuery(PROTO, table);

let repliedOnce = false, sentImm = false;
const spawnTimes = [], loginTimes = [];
let registryCount = 0, partialCount = 0;
const registryIds = [];

const bot = mineflayer.createBot({ host: 'mc.mcme.uno', username: 'TextValue', auth: 'offline', version: '1.21.1', hideErrors: false });

function replyRegister() {
  if (repliedOnce) return; repliedOnce = true;
  log('>>> [register] 回复 390 通道 (' + QUERY.length + ' B)');
  bot._client.write('custom_payload', { channel: 'neoforge:register', data: QUERY });
}

bot._client.on('custom_payload', (data) => {
  if (data.channel === 'neoforge:register') { replyRegister(); return; }
  if (data.channel === 'neoforge:network') { log('*** 协商通过 (neoforge:network, ' + data.data.length + ' B)'); return; }
});

// 正常解析出来的 registry_data
bot._client.on('packet', (data, meta, buffer) => {
  if (meta && meta.name === 'registry_data') {
    registryCount++;
    const fn = path.join(DUMP, 'reg_' + String(registryCount).padStart(3, '0') + '.bin');
    fs.writeFileSync(fn, buffer);
    // 试着读出第一个 registry id（registry_data 结构：先读一个 "minecraft:registry" 之类的顶层？）
    try {
      let o = 0;
      // 1.21.1 registry_data: rootTag NBT (named) —— 这里 buffer 是包体（已从 packet buffer 切好，含 packet id 已去？
      // packet 'buffer' 是去掉 length+id 后的 payload
      const [n, o2] = varint(buffer, 0); // 元素个数? 实际是 NBT root
      log('<<< registry_data #' + registryCount + ' len=' + buffer.length + ' (首个字节=' + buffer[0].toString(16) + ')');
    } catch (e) { log('    读取失败: ' + e.message); }
  }
  if (/^login$|game_join|join_game/i.test(meta && meta.name || '')) { loginTimes.push(ts()); log('*** [login] ' + meta.name + ' #' + loginTimes.length); }
});

// 畸形包（PartialReadError）原始 chunk
bot._client.on('partialPacket', (chunk, msg) => {
  partialCount++;
  const fn = path.join(DUMP, 'partial_' + String(partialCount).padStart(3, '0') + '.bin');
  fs.writeFileSync(fn, chunk);
  log('!!! 畸形包 #' + partialCount + ' len=' + chunk.length + ' : ' + msg);
});

bot.on('spawn', () => {
  spawnTimes.push(ts());
  log('*** [spawn] #' + spawnTimes.length + ' @ ' + ts());
  if (!sentImm) { sentImm = true; setTimeout(() => { replyRegister.imm = true; log('>>> 发送 /server imm'); bot.chat('/server imm'); }, 3000); }
});
bot.on('messagestr', (m) => { const s = String(m); if (/unable to connect|could ?n.?t connect|invalid|kick|disconnect|no such server/i.test(s)) log('!!! 失败: ' + s.slice(0, 200)); });
bot.on('end', (r) => { log('EVENT end: ' + r); finish(); });
bot.on('error', (e) => log('EVENT error: ' + (e && e.message)));

function finish() {
  log('======== dump 结论 ========');
  log('  spawn: ' + spawnTimes.length + (spawnTimes.length ? ' @ ' + spawnTimes.join(',') : ''));
  log('  login: ' + loginTimes.length);
  log('  registry_data(正常): ' + registryCount + '  partial(畸形): ' + partialCount);
  fs.writeFileSync(OUT + 'dump_result.json', JSON.stringify({ spawnTimes, loginTimes, registryCount, partialCount }, null, 2));
  setTimeout(() => process.exit(0), 300);
}

const secs = parseInt(process.argv[2] || '110', 10);
setTimeout(() => { log('TIMEOUT ' + secs + 's'); finish(); }, secs * 1000);
