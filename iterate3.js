const mineflayer = require('mineflayer')
const fs = require('fs')

const OUT = 'F:/wish/Fab-Neo/bot/'
function ts () { return new Date().toISOString().slice(11, 19) }
function log (...a) { console.log(ts(), ...a) }

function varint (n) { const o = []; n = n >>> 0; while (true) { if ((n & 0xffffff80) === 0) { o.push(n); break } o.push((n & 0x7f) | 0x80); n >>>= 7 } return Buffer.from(o) }
function mcStr (s) { const b = Buffer.from(s, 'utf8'); return Buffer.concat([varint(b.length), b]) }
function flowOrd (s) { if (s === null || s === undefined) return null; const u = String(s).toUpperCase(); if (u.includes('SERVERBOUND')) return 0; if (u.includes('CLIENTBOUND')) return 1; return null }

function buildComponent (id, version, fo, optional) {
  const p = [mcStr(id), mcStr(version || '')]
  if (fo === null || fo === undefined) p.push(Buffer.from([0x00]))
  else p.push(Buffer.concat([Buffer.from([0x01]), varint(fo)]))
  p.push(Buffer.from([optional ? 0x01 : 0x00]))
  return Buffer.concat(p)
}
function buildQuery (proto, list) {
  const p = [varint(1), varint(proto), varint(list.length)]
  for (const c of list) p.push(buildComponent(c.id, c.version, c.flow, true))
  return Buffer.concat(p)
}

// load the table learned last run
const spec = JSON.parse(fs.readFileSync(OUT + 'learned.json', 'utf8'))
const PROTO = parseInt(process.env.PROTO || '1', 10)
const table = Object.entries(spec).map(([id, v]) => ({ id, version: v.version || '', flow: flowOrd(v.flowOrd !== undefined && v.flowOrd !== null ? (v.flowOrd === 0 ? 'SERVERBOUND' : 'CLIENTBOUND') : v.flow) }))
const QUERY = buildQuery(PROTO, table)
log('loaded ' + table.length + ' channels, query payload ' + QUERY.length + ' B')

let replied = false
let passed = false
const seen = {}

const bot = mineflayer.createBot({ host: 'mc.mcme.uno', username: 'TextValue', auth: 'offline', version: '1.21.1', hideErrors: false })

bot._client.on('custom_payload', (data) => {
  const ch = data.channel
  const hex = data.data ? data.data.toString('hex') : ''

  if (ch === 'neoforge:register' && !replied) {
    replied = true
    log('>>> reply full learned table (' + QUERY.length + ' B)')
    bot._client.write('custom_payload', { channel: 'neoforge:register', data: QUERY })
    return
  }

  if (ch === 'neoforge:network') {
    passed = true
    log('*** negotiation PASSED (neoforge:network, ' + data.data.length + ' B)')
    fs.writeFileSync(OUT + 'network_payload.bin', data.data)
    return
  }

  // after we pass, log EVERY custom payload the server sends
  if (passed) {
    log('<<< ' + ch + '  len=' + data.data.length + '  hex=' + hex.slice(0, 160))
    log('    ascii=' + data.data.toString('latin1').replace(/[^\x20-\x7e]/g, '.').slice(0, 200))
    fs.writeFileSync(OUT + ('pkt_' + ch.replace(/[^a-z0-9_]/gi, '_') + '.bin'), data.data)
    if (hex.startsWith('00') || data.data.length < 40) {
      log('    FULL HEX=' + hex)
    }
  }
})

// log every packet name once, and counts, after passing
bot._client.on('packet', (d, m) => {
  if (!passed) return
  seen[m.name] = (seen[m.name] || 0) + 1
  if (seen[m.name] === 1) log('PKT ' + m.name + '  ' + JSON.stringify(d).slice(0, 200))
})

bot.on('spawn', () => { log('EVENT spawn'); setTimeout(() => { log('SEND /server imm'); bot.chat('/server imm') }, 14000) })
bot.on('end', (r) => { log('EVENT end:', r); setTimeout(() => process.exit(0), 300) })
bot.on('error', (e) => log('EVENT error:', e && e.message))

setTimeout(() => { log('TIMEOUT passed=' + passed + '  packets=' + JSON.stringify(seen)); process.exit(0) }, 150000)
