# nfhandshake —— 实现说明与协议证据链

> 产物：`build/libs/nfhandshake-1.0.0.jar`（10,503 字节，Fabric 客户端模组）
> 目标环境：Minecraft **1.21.11** + Fabric Loader **0.19.5** + Fabric API **0.141.6+1.21.11**
> 对手方：NeoForge **21.1.248**（Minecraft 1.21.1）服务器

---

## 0. 先看结论（重要）

需求文档 `need/2how to made.md` 里的代码**在这个版本一行都编译不过**，而且它的**核心前提是错的**。下面是逐条对照。

| 需求文档的说法 | 实测结论 | 证据 |
|---|---|---|
| `net.minecraft.resources.ResourceLocation` | 1.21.11 已改名为 **`net.minecraft.resources.Identifier`** | `ref/client-1.21.11-mojmap.txt` 中 `DiscardedPayload.lambda$codec$1(int, net.minecraft.resources.Identifier, FriendlyByteBuf)` |
| `new CustomPacketPayload.Id<>(...)` | **该类不存在**。正确是 `new CustomPacketPayload.Type<>(Identifier)` | 映射：`CustomPacketPayload$Type -> acd$b`，构造器 `void <init>(net.minecraft.resources.Identifier)` |
| `CustomPayloadS2CPacket` / `onCustomPayload` | 这是 **Yarn 命名**。Mojang 下是 `ClientboundCustomPayloadPacket` / `ClientCommonPacketListenerImpl.handleCustomPayload` | 映射 `net.minecraft.network.protocol.common.ClientboundCustomPayloadPacket -> abi` |
| 不解码前丢弃，否则 `DecoderException` 崩溃 | **不会崩**。1.21.11 用 `DiscardedPayload` 作回退，未知 ID 静默解码成丢弃负载 | `CustomPacketPayload.codec(FallbackProvider, List)` + `DiscardedPayload` 存在 |
| 发空 `c:register` 就能让服务端判定为 `vanilla/other` | **错**。`connectionType` 只由客户端是否发送 `ModdedNetworkQueryPayload` 决定 | 见 §2.2 字节码 |
| `c:register` 的 `phase` 是任意字符串 | 线格式是 `ConnectionProtocol.id()`，只有 `"play"` / `"configuration"` | NeoForge `CommonRegisterPayload.java:30-34` |

**这个模组仍然有用**，但作用点变了 —— 见 §4。

---

## 1. 构建环境

| 项 | 值 | 来源 |
|---|---|---|
| Minecraft | 1.21.11 | `versions\1.21.11-Fabric 0.19.5\*.json` 的 `clientVersion` |
| Fabric Loader | 0.19.5 | `libraries\net\fabricmc\fabric-loader\0.19.5` |
| Fabric API | 0.141.6+1.21.11 | `mods\fabric-api-0.141.6+1.21.11.jar` |
| Loom | 1.18.2（插件 id `net.fabricmc.fabric-loom-remap`） | `maven.fabricmc.net` maven-metadata |
| Gradle | 9.7.1 | 本机 `services.gradle.org` 不通，改从 `mirrors.cloud.tencent.com/gradle/` 下载 |
| **Loom 要求 JVM ≥ 25** | 用 `F:\java\java25` | 首次用 java21 构建报错：`Dependency requires at least JVM runtime version 25` |
| 映射 | `loom.officialMojangMappings()` | `ref/client-1.21.11-mojmap.txt` 即官方 `client.txt`，11,779,287 字节 |

> 本机客户端 jar `versions\1.21.11-Fabric 0.19.5\1.21.11-Fabric 0.19.5.jar` 的 SHA1 = `BA2DF812C2D12E0219C489C4CD9A5E1F0760F5BD`，与 version json 里 vanilla `client.jar` 的 SHA1 **完全一致** —— 所以本机就有未混淆前的原版字节码可直接取证。

### 复现命令

```powershell
$env:JAVA_HOME='F:\java\java25'
F:\wish\Fab-Neo\tools\gradle-dist\gradle-9.7.1\bin\gradle.bat -p F:\wish\Fab-Neo build --no-daemon
```

---

## 2. NeoForge 服务端握手：真实流程

所有结论来自本机 `libraries\net\neoforged\neoforge\21.1.248\` 的 jar 反汇编，以及 `1.21.x` 分支源码。

### 2.1 配置阶段任务链

`ConfigurationInitialization.java:46-52`：

```java
@SubscribeEvent
private static void configureModdedClient(RegisterConfigurationTasksEvent event) {
    ServerConfigurationPacketListener listener = event.getListener();
    if (listener.hasChannel(CommonVersionPayload.TYPE) && listener.hasChannel(CommonRegisterPayload.TYPE)) {
        event.register(new CommonVersionTask());
        event.register(new CommonRegisterTask());
    }
    ...
}
```

**服务端只在「客户端已经声明了 `c:version` 和 `c:register` 这两个通道」时，才会注册这两个会阻塞等待回复的任务。**
所以：一个什么都不声明的客户端不会卡在配置阶段；而声明了的客户端**必须**回复，否则一直停在 `CommonVersionTask`。

### 2.2 `connectionType` 是怎么变成 `NEOFORGE` 的

`ServerConfigurationPacketListenerImpl`（NeoForge 二进制补丁后的类）`handleCustomPayload` 反汇编：

```java
public void handleCustomPayload(ServerboundCustomPayloadPacket packet) {
    CustomPacketPayload payload = packet.payload();
    if (payload instanceof ModdedNetworkQueryPayload query) {
        this.connectionType = ConnectionType.NEOFORGE;
        NetworkRegistry.initializeNeoForgeConnection(this, query.queries());
        return;
    }
    super.handleCustomPayload(packet);
}
```

以及 `handlePong`：

```java
public void handlePong(ServerboundPongPacket packet) {
    super.handlePong(packet);
    if (packet.getId() == 0) {
        if (!this.connectionType.isNeoForge()) {
            if (!NetworkRegistry.initializeOtherConnection(this)) return;
        }
        this.runConfiguration();
    }
}
```

**`ModdedNetworkQueryPayload` 是唯一开关。** 发 `c:register` 对它没有任何影响。

### 2.3 真正的门槛：`initializeOtherConnection`

`NetworkRegistry.java:383-403`：

```java
public static boolean initializeOtherConnection(ServerConfigurationPacketListener listener) {
    ...
    for (ConnectionProtocol protocol : PAYLOAD_REGISTRATIONS.keySet()) {
        NegotiationResult negotiationResult = NetworkComponentNegotiator.negotiate(
                PAYLOAD_REGISTRATIONS.get(protocol).entrySet().stream()
                        .map(entry -> new NegotiableNetworkComponent(entry.getKey(), entry.getValue().version(),
                                entry.getValue().flow(), entry.getValue().optional()))
                        .toList(),
                List.of());                       // ← 客户端组件列表是空集
        if (!negotiationResult.success()) {
            listener.disconnect(Component.translatableWithFallback(
                    "neoforge.network.negotiation.failure.vanilla.client.not_supported",
                    "You are trying to connect to a server that is running NeoForge, but you are not. "
                    + "Please install NeoForge Version: %s to connect to this server.", ...));
            return false;
        }
    }
    ...
}
```

配合 `NetworkComponentNegotiator.negotiate` 的规则（`NetworkComponentNegotiator.java:55-97`）：

1. 客户端的 optional 组件若服务端没有 → 从客户端移除；
2. **服务端的 optional 组件若客户端没有 → 从服务端移除**；
3. 剩下的服务端组件非空 → **协商失败**。

代入 `client = List.of()`：第 2 步会移除**所有 optional 的服务端通道**，只剩非 optional 的。**只要还剩一个，就断线。**

而 NeoForge 的默认值恰恰是**非 optional**（`PayloadRegistrar.java:28`）：

```java
public class PayloadRegistrar {
    private boolean optional = false;      // ← 默认强制
```

**结论：能不能进去，取决于服务端那些模组有没有调用 `.optional()`，这是服务端属性，任何客户端模组都改不了。**
（想绕过只有一条路：伪造 `ModdedNetworkQueryPayload` 并声明与服务端**逐通道、逐版本完全一致**的通道集 —— 但客户端在协商前无从得知服务端的通道表，且即便骗过协商也无法解码后续负载，实际不可行。）

### 2.4 服务端根本不会给非 NeoForge 客户端发模组包

`NetworkRegistry.java:425-437`：

```java
public static void checkPacket(Packet<?> packet, ServerCommonPacketListener listener) {
    if (packet instanceof ClientboundCustomPayloadPacket customPayloadPacket) {
        Identifier id = customPayloadPacket.payload().type().id();
        if (BUILTIN_PAYLOADS.containsKey(id) || "minecraft".equals(id.getNamespace())) return;
        if (hasChannel(listener, id)) return;
        throw new UnsupportedOperationException("Payload %s may not be sent to the client!".formatted(id));
    }
}
```

`minecraft` 命名空间放行，其余没协商过的通道**直接抛异常，压根发不出去**。

---

## 3. 我实现的两层

### 3.1 握手层（`ClientConfigurationConnectionEvents.START`）

在配置阶段开始时发送 `channels` 为空集的 `c:register`：

```java
ClientConfigurationConnectionEvents.START.register((handler, client) -> {
    ClientConfigurationNetworking.send(
            new CommonRegisterPayload(1, CommonRegisterPayload.PLAY_PHASE, Set.of()));
});
```

**为什么仍然需要它**：Fabric API 自己带 `AbstractChanneledNetworkAddon.sendInitialChannelRegistrationPacket()` / `createRegisterPayload()` / `onCommonRegisterPacket()`（`javap` 实测），也就是说 **Fabric 客户端本来就会声明 `c:register` 通道**。按 §2.1，这会让 NeoForge 服务端注册 `CommonVersionTask` + `CommonRegisterTask` 并**等我们回复**。这个回包就是让配置阶段能走完的东西。

线格式按 NeoForge 定义逐字段复刻（`CommonRegisterPayload.java`）：

```
VAR_INT version
STRING_UTF8 protocol.id()        // "play" / "configuration"
collection(HashSet, Identifier)  // channels，空集
```

### 3.2 数据包丢弃层 A：Netty `ChannelPipeline`

`NettyModdedPayloadFilter` 是一个挂在管线上的 `ChannelInboundHandlerAdapter`，在配置阶段与游戏阶段 `INIT` 时插入：

```java
pipeline.addBefore(HandlerNames.PACKET_HANDLER, "nfhandshake_filter", NettyModdedPayloadFilter.INSTANCE);
```

`HandlerNames.PACKET_HANDLER` 就是 Minecraft 自己的 `Connection` 处理器（`Connection` 本体是
`SimpleChannelInboundHandler<Packet<?>>`），所以过滤器在 Minecraft 处理数据包之前拿到已解码的 `Packet`。
丢弃方式是**不调用 `ctx.fireChannelRead(msg)` 并释放引用计数** —— 数据包不再向下传播，也不回包，即「静默丢弃」。

拿到管线的路径（两个字段都是 private，靠 accessor mixin 打开）：

| 字段 | 映射依据 | accessor |
|---|---|---|
| `Connection.channel` | `ref\mc-classes\wu.class` → `private io.netty.channel.Channel k` | `ConnectionAccessor` |
| `ClientCommonPacketListenerImpl.connection` | 映射 `net.minecraft.network.Connection connection -> b` | `ClientCommonPacketListenerImplAccessor` |

注入位置与 NeoForge 自身的做法同构（`NetworkFilters.java:46` 用的是
`pipeline.addAfter(HandlerNames.ENCODER, key, filter)`，方向相反）。

### 3.3 数据包丢弃层 B：Mixin（更早、兜底）

注入点取自 1.21.11 官方映射：

```
ClientCommonPacketListenerImpl -> hia:
    180:192:void handleCustomPayload(ClientboundCustomPayloadPacket)
ClientConfigurationPacketListenerImpl -> hib:
    70:71:void handleCustomPayload(CustomPacketPayload)
```

命名空间不是 `minecraft` 就 `ci.cancel()`；`priority = 1` 与 ViaFabricPlus 一致，先于 Fabric API 的负载分发。

### 3.4 为什么没有做「PacketDecoder 之前的字节级拦截」

需求文档要求「在解码器之前丢弃」。这一条在本版本**既不需要、也很危险**：

- **不需要**：`ClientboundCustomPayloadPacket` 的编解码用
  `CustomPacketPayload.codec(FallbackProvider, List<TypeAndCodec>)`，回退实现是
  `DiscardedPayload.codec(MAX_PAYLOAD_SIZE)`。未知 ID 会解码成 `DiscardedPayload`，
  **不会抛 `DecoderException`**（需求文档「会崩溃」的判断不成立）。
- **危险**：在解帧后、`PacketDecoder` 之前，管线里只有一个裸 `ByteBuf`。要判断包内命名空间，
  必须先读 VarInt 包 ID、再比对当前协议的 `ClientboundCustomPayloadPacket` 序号、再解析
  `Identifier`（VarInt 长度前缀 + UTF-8）。任何一步偏移误算都会把原版数据包当成模组包丢掉，
  直接破坏连接。

因此把丢弃点放在「已解码、但 Minecraft 尚未处理」的位置：既满足「Netty 层静默丢弃」，
又没有字节级猜测的风险。

---

## 4. 装上去之后会发生什么

- ✅ 配置阶段不会因为 `c:version`/`c:register` 无人应答而卡住。
- ✅ 服务端误发的非 `minecraft` 负载会被静默丢弃，不刷 Fabric 的 unknown-payload 警告。
- ❌ **如果服务端有任何模组注册了非 optional 的 payload，你依然会被踢**，提示是
  `You are trying to connect to a server that is running NeoForge, but you are not. Please install NeoForge Version: ...`
  这是服务端策略，客户端无法绕过。

### 自己验证服务端通道强制性

在 NeoForge 服务端控制台/日志里搜：

- `neoforge.network.negotiation.failure.vanilla.client.not_supported` → 被强制通道挡住了
- `initializeOtherConnection` / 进入游戏成功 → 说明服务端全是 optional 通道

也可以用本机那份 NeoForge 源码对照：

```powershell
Select-String -Path F:\wish\Fab-Neo\ref\neoforge-src\PayloadRegistrar.java -Pattern 'optional = false'
```

---

## 5. 安装

把 jar 放进 **1.21.11 Fabric** 那个版本的 mods 目录（注意：不是全局 `mods`，PCL2 用的是版本隔离）：

```
F:\Launcherce\.minecraft\versions\1.21.11-Fabric 0.19.5\mods\nfhandshake-1.0.0.jar
```

`ViaFabricPlus-4.4.15.jar` 已在该目录中，无需额外操作。

> 我**没有**替你复制过去 —— 你之前要求「产生的东西全部留在工作区」，所以安装这一步留给你自己决定。

---

## 6. 工作区产物索引

| 路径 | 说明 |
|---|---|
| `build/libs/nfhandshake-1.0.0.jar` | **最终产物**，已重映射为 intermediary |
| `build/libs/nfhandshake-1.0.0-sources.jar` | 源码 jar |
| `src/main/java/net/fabneo/nfhandshake/` | 源码 |
| `ref/client-1.21.11-mojmap.txt` | Mojang 官方混淆映射（全部类名依据） |
| `ref/NetworkRegistry.bytecode.txt` | NeoForge `NetworkRegistry` 反汇编 |
| `ref/SCPLI.bytecode.txt` | 补丁后 `ServerConfigurationPacketListenerImpl` 反汇编 |
| `ref/neoforge-src/` | NeoForge 1.21.x 关键源码 |
| `ref/neoforge-net/` | NeoForge network 包 class |
| `tools/gradle-dist/gradle-9.7.1/` | Gradle 发行版（services.gradle.org 不通） |
