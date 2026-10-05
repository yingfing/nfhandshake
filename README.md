# nfhandshake 交接文档 —— Fabric 客户端进 NeoForge 服务器

> 交接原因：上一轮会话上下文爆炸（2881 行日志，模型从 flash 连续切换到 reasoner/chat/minimax 仍未跑完）。
> 本文把**已验证的事实**固化下来，新会话读这一份即可继续，不必重读历史。
> 交接时间：2026-10-05

---

## 0. 一句话现状

**"硬碰"方案握手层完全成功，但游戏阶段证伪了：** 机器人能骗过 NeoForge 协商（390 通道），但 `/server imm` 跨服重配置后，子服下发的 `registry_data`（NeoForge 模组注册表）被 mineflayer 的 1.21.1 解析器抛 `PartialReadError` 解崩，**流程卡死在 configuration 阶段，从未到达第二次 login/spawn**。没有踢人、没有断线——就是解不动模组数据。
结论：**通用/Fabric 客户端靠伪造握手进 NeoForge 子服玩生存，在游戏数据层面走不通**（这恰好印证了原 README 没被推翻的那半句：模组负载需要对应解码器）。

当前工作区的 Fabric mod（`nfhandshake`，空 `c:register` 装 vanilla）**两条路都被实测否定**。

### 0.1 实测铁证时间线（mc.mcme.uno, 离线账号 TextValue）
```
13:21:44  大厅 spawn #1（代理大厅，非 imm）
13:21:47  发送 /server imm
13:21:48  start_configuration   ← 子服要求重走配置
13:21:48  回复 390 通道 → 协商通过 (neoforge:network 26606 B)  ✅ 握手再次成功
13:21:48  select_known_packs / registry_data ×22
13:21:48  PartialReadError (nbtMapper/SlotComponent)  ← 解模组注册表崩了
……        此后到超时无任何包，无 login / 无 spawn #2 / 无踢人
```
- 证据文件：`bot/imm_trace.js`（诊断脚本）、`bot/imm_trace_result.json`、前一轮 `bot/count_spawn_result.json`（仅 1 次 spawn）、`bot/verify_network.bin`（大厅协商成功包）。
- 关键判断变量：`negotiation PASSED` 只是配置**开始**；能否玩取决于 `registry_data` 之后能否收到 `finish_configuration` + 第二次 `login`+`spawn`，而这一步失败了。

### 0.2 真正能玩生存的可行路径（按把握排序）
1. **NeoForge 客户端直连**：你 `PonderSMP` 实例本就是 NeoForge 21.1.248，版本完全匹配，100% 能进 imm。
2. **ViaFabricPlus 实测**：`1.21.11-Fabric 0.19.5` 实例已带 ViaFabricPlus 4.4.15，理论上能把未知负载当 passthrough——**需人手在该实例里实测进 imm 能否不崩**（机器人层面已证伪，但人手客户端 + VF+ 是另一回事）。
3. 伪造握手：已证伪（见 0.1）。

---

## 1. 目标（用户原话）

> 「啥玩意我只想进去玩生存而不是进不去在外面等着 我的意思是用fabric客户端进入neoforge服务器」

即：**用 1.21.11 的 Fabric 客户端，进入 NeoForge 21.1.248（MC 1.21.1）的服务器玩生存。**
不是用 NeoForge 客户端进（那个本来就能进），也不是"在外面等着"。

---

## 2. 目标服务器（已确认）

| 项 | 值 | 证据 |
|---|---|---|
| 地址 | `mc.mcme.uno` | `iterate3.js:36` |
| 子服务器 | `imm`（通过 `/server imm` 进入） | 实测日志 |
| 加载器 | **NeoForge 21.1.248** | 服务器拒绝消息原文 |
| MC 版本 | 1.21.1 | `PonderSMP.json` |
| 代理 | BungeeCord/Velocity | 抓包见 `legacy:pnchat`、`pnban`、`floodgate:transfer`、`geyserextras:fog` |
| 模组量 | 390 个自定义通道 | `learned.json` |

服务器拒绝 vanilla 客户端的原话：
```
Unable to connect to imm: 你正在尝试连接一个安装了 NeoForge 的服务器，
但是你没有安装。为了连接到此服务器，请安装 NeoForge 版本 21.1.248。
```

**关键陷阱**：大厅是 Forge-no-mods，发 `neoforge:register` 它不理；必须 `/server imm` 之后才进入真正的 NeoForge 子服。

---

## 3. 硬碰方案：已验证成功（核心资产）

### 3.1 成功日志（原文，来自上一轮会话行 #1556）

```
04:54:12 === ROUND 4 (server query len 1)
04:54:12 --> reply 390 channels, 378 with flow, 390 with version (15624 B)
04:54:12 *** SUCCESS *** received neoforge:network -> negotiation PASSED
```

**服务器接受了机器人作为 NeoForge 客户端。**

### 3.2 方法：错误驱动学习（4 轮）

用 `mineflayer`（Node）连服务器，故意发错，从服务器报错里逐通道学出真实值：

| 轮次 | 发送内容 | 服务器反馈 | 学到 |
|---|---|---|---|
| R1 | 390 个空通道 | — | 全部 **390 个通道 ID** |
| R2 | `version=""`、无 flow | 390 个 `flow.*.missing` | **378 个 flow** |
| R3 | 用学到的表 | `version.mismatch`（如 `moonlight` 要 `"10"`、`vista` 要 `"2"`） | 补齐 **version** |
| R4 | 390 通道 + 真实 version/flow + `optional=true` | **✅ SUCCESS** | — |

### 3.3 弹药：`learned.json`（390 通道，version/flow 零缺失）

```json
{
  "create:toolbox_dispose_all":                     { "flowOrd": 0, "version": "6.0.10" },
  "cookingforblockheads:request_selection_recipes":  { "flowOrd": 0, "version": "cookingforblockheads" },
  "sable:stop_tracking_sub_level":                   { "flowOrd": 1, "version": "1" },
  "refinedstorage:message":                          { "flowOrd": 1, "version": "2.0.9" }
}
```

- `flowOrd`: `0` = SERVERBOUND，`1` = CLIENTBOUND
- 统计：**SERVERBOUND 197 / CLIENTBOUND 181 / 其他 12**，**无 version 缺失 0**
- 按 namespace：create 115、refinedstorage 55、simulated 37、waystones 23、sophisticatedcore 20、curios 17、quark 17、sable 16、computercraft 16、sophisticatedbackpacks 15……（共 24 个）

### 3.4 关键代码（`iterate3.js:21`）

```js
buildComponent(c.id, c.version, c.flow, true)
//                                    ^^^^ optional 硬编码 true
```

**把 390 个通道全部声明为 `optional=true`，但携带真实 version 和 flow。**
这不是"伪装成 vanilla"，而是**伪装成一个拥有全部 390 通道的 NeoForge 客户端**。

### 3.5 `success_network.bin`（26 KB）

服务器协商通过后回发的**确认包**，内含 390 通道列表（UTF8 可见 `create:toolbox_dispose_all` 等）。是协商成功的物证。

---

## 4. 当前 Fabric mod：`nfhandshake` —— 此路已被证明不通

位置：`F:\wish\Fab-Neo\src\main\java\net\fabneo\nfhandshake\`
产物：`build/libs/nfhandshake-1.0.0.jar`（可正常构建，`BUILD SUCCESSFUL`）

### 4.1 它做的事

1. 配置阶段发送 **channels 为空集**的 `c:register`，企图让服务器归类为 `vanilla/other`
2. 两个 Mixin（priority=1）在 `handleCustomPayload` HEAD 处丢弃非 `minecraft` 命名空间负载
3. Netty 层 `NettyModdedPayloadFilter` 拦截

### 4.2 为什么必被踢

NeoForge `PayloadRegistrar.java:28` 默认 `private boolean optional = false;`，
且 `:205` 注释明写：
> If any non-optional payloads are missing during a connection attempt, the connection will fail.

**服务端有 390 个通道，只要有一个非 optional 缺失就断线。这是服务端属性，客户端改不了。**
→ 所以"空 channels 装 vanilla"必失败，实测也证实被踢。

### 4.3 附带修正：原 README 的过时论断

`README-原实现说明(被实测推翻).md` §2.3 称：
> 客户端在协商前无从得知服务端的通道表……**实际不可行**。

**这句被实测推翻**：通道表可以用错误驱动学习拿到（4 轮），协商也确实骗过了。
（但该 README 的**映射考证部分仍然有效**，Mixin 注入点、Mojmap 行号都是对的。）

---

## 5. 未完成的事（下一步）

1. **验证"协商通过后能否真正进入游戏"** ← 最关键未知数
   协商过了 ≠ 能玩生存。后面还有配置阶段剩余任务
   （`CommonVersionTask` / `CommonRegisterTask` 应答、注册表同步等）。
   上一轮模型切换后没跑完。
2. **把硬碰方案移植成 Fabric mod**
   需发 15624 字节的 `neoforge:register` 查询包（`ModdedNetworkQueryPayload`），
   而非当前的空 `c:register`。`learned.json` 是现成通道表。
3. **决定客户端实例**
   用户 `PonderSMP` 实例本身就是 NeoForge 21.1.248（版本完全匹配，本来能进）；
   要"用 Fabric 客户端进"，应走 `1.21.11-Fabric 0.19.5`（48 mods）+ ViaFabricPlus。

---

## 6. 环境与工具（已核实可用）

| 工具 | 路径 / 版本 |
|---|---|
| git | `F:\Git\cmd\git.exe`，2.55.0 |
| node | `F:\Program Files\nodejs\node.exe`，v22.22.1 |
| npm/npx | 随 node |
| java | PATH 生效 `f:\java\java21`；另有 java8/11/17/22/25 |
| gradle | **PATH 无**，但工作区自带 `tools\gradle-dist\gradle-9.7.1\bin\gradle.bat` |
| gh | 2.100.0，**已登录 `yingfing`**，scopes: gist/read:org/repo/workflow |
| 7z | `F:\Program Files\7-zip\7z.exe`（不支持 zstd） |
| python | ⚠️ PATH 里是微软商店存根，**不可用**；真 Python `F:\Program Files\Python\python.exe` = 3.10.0 |

**构建命令**（需 JVM ≥ 25，Loom 1.18.2 要求）：
```powershell
$env:JAVA_HOME='F:\java\java25'
F:\wish\Fab-Neo\tools\gradle-dist\gradle-9.7.1\bin\gradle.bat -p F:\wish\Fab-Neo build --no-daemon
```

**跑机器人验证**：
```powershell
Set-Location F:\wish\Fab-Neo\bot
$env:PROTO='1'
& 'F:\Program Files\nodejs\node.exe' iterate3.js
```

---

## 7. 用户硬性约束（务必遵守）

1. **不要全盘扫描磁盘**（用户给 Everything 正是为了防这个）。找文件一律先给目录，用 glob/grep 限定范围。
2. **产生的东西全部留在工作区**，不要散落到电脑各处。
3. 需要联网/写盘的操作（装包、推 GitHub）先征得同意。

---

## 8. 文件索引

| 路径 | 说明 |
|---|---|
| `README.md` | 本文件，交接主文档 |
| `learned.json` | **390 通道表**（version/flow），硬碰弹药 |
| `success_network.bin` | 协商通过后服务器回发的确认包（26 KB，物证） |
| `iterate3.js` | 最后一版迭代脚本（发 390 通道 + optional=true） |
| `README-原实现说明(被实测推翻).md` | 原 README；映射考证有效，§2.3 结论已被推翻 |

原始材料仍在：
- `F:\wish\Fab-Neo\bot\` — 完整机器人工具链（probe.js/iterate.js/learned_spec.json/failure_round*.bin）
- `F:\wish\Fab-Neo\src\` — Fabric mod 源码
- `F:\wish\Fab-Neo\ref\` — Mojmap、NeoForge 源码与字节码
- `F:\wish\Fab-Neo\need\` — 需求文档（`2how to made.md` 里的代码**编译不过**，仅供参考）

---

## 9. 硬碰机器人（mineflayer）实测进展 · 2026-10-06 夜

> 用户要求"硬碰到底"：在 mineflayer 机器人上直接进 imm 子服。已改 mineflayer/protodef 源码逐步逼近，结论如下。

### 9.1 已证实的事实（按时间线）

```
大厅: 登录 → spawn #1（代理大厅，非 imm）
→ 发 /server imm
→ RX start_configuration                ← 跨服重配置
→ TX configuration_acknowledged        ✅ mineflayer 正确回
→ TX settings (client_information)     ✅
→ RX neoforge:register (查询) → TX 回 390 通道 (15624 B)  ✅
→ RX neoforge:network (协商通过, 26606 B)  ✅ 握手成功
→ RX feature_flags / select_known_packs
→ TX select_known_packs                ✅ mineflayer 正确回
→ RX registry_data ×22 + tags          ✅ 全部正常解析（partial=0）
→ （沉默，只有 keep_alive）
→ 超时，无 finish_configuration，无 login #2，无 spawn #2
→ 服务器既不踢也不发 finish_configuration，就是等
```

### 9.2 关键定位（改 protodef + minecraft-protocol 源码后验证）

1. **流没有卡死**：给 `protodef/src/serializer.js` 的 `FullPacketParser` 加 patch——`PartialReadError` 时丢弃该包并 `emit('partialPacket')` 继续，而非死等/判死刑。改后 imm 的 22 个 `registry_data` 全部正常解析（partial=0），但**仍不进 imm** → 卡点不在畸形包。
2. **配置阶段无任何包解析错误**：给 `minecraft-protocol/src/client.js` 的 deserializer error listener 加日志，CONFIG 状态下**零解析错误** → `finish_configuration` 若服务器发了，mineflayer 能解；问题在**服务器根本没发**。
3. **三个 NeoForge always-task 是嫌疑**（源码 `ref/neoforge-src/ConfigurationInitialization.java:59-61` 注册，且 `CheckFeatureFlags/CheckExtensibleEnums/RegistryDataMapNegotiation.java` 已读）：
   - 它们对**非 NeoForge (other) 连接**会直接 `disconnect`（"does not support vanilla clients..."）。
   - 对**已声明为 NEOFORGE 的连接**（我们回了 `neoforge:register` 把 `connectionType` 设成 NEOFORGE）→ 走"发 payload 等客户端 ack"分支：
     - `CheckFeatureFlags` → 发 `FeatureFlagDataPayload`，等 `FeatureFlagAcknowledgePayload`
     - `CheckExtensibleEnums` → 发 `ExtensibleEnumDataPayload`，等 ack
     - `RegistryDataMapNegotiation` → 发 `KnownRegistryDataMapsPayload`，等 ack
   - 但前提是客户端 `hasChannel(对应TYPE)`；我们回的 390 表（learned.json）里**没有** `neoforge:*` 内部通道（grep 确认 0 个），所以服务器认为客户端没声明 → 走"skip/finishCurrentTask"分支（未发这些 payload）。因此这三个 task 应已完成。
4. **结论**：所有可定位的 task 都该完成，服务器却不在 tags 后发 `finish_configuration`。剩余唯一高概率根因是 **vanilla `SynchronizeRegistriesTask` 的某个客户端确认环节**——而 `minecraft-data` 的 **1.21.1 协议定义里根本没有 `select_known_packs` / `acknowledge_known_packs`**（已查 `node_modules/minecraft-data/.../pc/1.21.1/protocol.json`：0 匹配），说明 mineflayer 在这块协议定义有缺口，重配置时客户端漏发/错发某个确认包，服务器据此不推进。

### 9.3 若要继续硬碰（下一步具体路径）

A. **声明 NeoForge 内部通道并回 ack**：在 `neoforge:register` 回应里加入
   `neoforge:feature_flags_data` / `neoforge:extensible_enum_data` / `neoforge:registry_data_map`（实际 TYPE 见各自 `.java` 源码），
   让服务器真的发这三个 payload，然后在 bot 里监听并回对应 AcknowledgePayload。这是把配置流程走完的正路。
B. **修 minecraft-data 1.21.1 的 known_packs schema**：确认 `select_known_packs` 的 C2S 回应包名（1.20.5+ 应为 `acknowledge_known_packs`），补进协议定义，验证重配置是否因此走完。
C. **游戏阶段才是真正的墙**：即便进了 imm（spawn #2），390 个模组的游戏负载 mineflayer 完全不解码 → 进去即崩。这一步等于在 mineflayer 里重造 ViaFabricPlus 的 NeoForge 桥接层，工程量极大。"硬碰进 imm 玩生存"在机器人侧不现实；**人手用 `1.21.11-Fabric` + ViaFabricPlus 实例才是可行路**（VF+ 自带 NeoForge 协议层）。

### 9.4 已对第三方库做的改动（保留，作为诊断资产）

- `bot/node_modules/protodef/src/serializer.js`：`FullPacketParser` 在 `PartialReadError` 时 `emit('partialPacket')` + 丢弃继续。
- `bot/node_modules/minecraft-protocol/src/client.js`：`deserializer.on('error')` 在 CONFIG 状态打印详细错误；`deserializer.on('data')` 包 try/catch 仅吞 `PartialReadError`。
- 诊断脚本：`imm_trace.js` / `dump_registry.js` / `diag_imm.js` / `push_imm.js` / `final_imm.js`（均会打印每包 RX/TX 与 spawn/login 计数）。
