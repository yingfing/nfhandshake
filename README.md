# nfhandshake

让 **Fabric 客户端** 进入 **NeoForge 服务器** 的模组。

目标环境：Minecraft **1.21.11** + Fabric Loader **0.19.5** + Fabric API **0.141.6+1.21.11**
配合 [ViaFabricPlus](https://github.com/ViaVersion/ViaFabricPlus) 做版本协议翻译（1.21.11 ↔ 1.21.1）。

---

## 为什么需要它

NeoForge 服务器在**配置阶段**会要求客户端声明自定义通道（`c:register`）。
若服务端存在**非 optional** 的负载，而客户端没有声明，就会断线并提示：

> You are trying to connect to a server that is running NeoForge, but you are not.
> Please install NeoForge Version: ... to connect to this server.

本模组解决两件事：

1. **握手适配** —— 在配置阶段正确应答，让配置流程走完
2. **静默丢弃** —— 丢弃服务端发来的非 `minecraft` 命名空间负载，不刷警告、不崩溃

---

## 已验证的结论（重要）

### ✅ 可行的路线：声明服务端全部通道 + `optional=true`

实测（用 mineflayer 机器人连真实 NeoForge 21.1.248 服务器）已完整通过：

| 里程碑 | 结果 |
|---|---|
| 协商通过（收到 `neoforge:network`） | ✅ |
| 配置阶段完成（`finish_configuration`） | ✅ |
| 进入游戏（`login` 包） | ✅ |
| 收到位置包、可操作 | ✅ |
| `spawn` 事件（真正进入世界） | ✅ |

做法：把服务端的**全部通道**连同其**真实 version / flow** 一并返回，并把
`optional` 置为 `true`。即伪装成一个"拥有全部通道的 NeoForge 客户端"。

服务端通道表可用**错误驱动学习**获得：先发空表，从服务端返回的
`flow.*.missing` / `version.mismatch` 报错中逐通道学出真实值，迭代几轮即可补齐。

### ❌ 不可行的路线：空 `c:register` 装 vanilla

NeoForge `PayloadRegistrar` 默认 `private boolean optional = false;`，且其注释明写：

> If any non-optional payloads are missing during a connection attempt, the connection will fail.

**只要服务端有一个非 optional 负载缺失就断线，这是服务端属性，客户端改不了。**
当前仓库代码走的是这条路（空 channels），**用于参考协议结构，实际会被踢**。

---

## 当前代码状态

| 模块 | 说明 |
|---|---|
| `NfHandshakeClient` | 入口：注册负载类型、配置阶段发送、注入 Netty 过滤器 |
| `CommonRegisterPayload` | 复刻 NeoForge `c:register` 的线格式（VAR_INT / UTF8 / HashSet） |
| `NettyModdedPayloadFilter` | Netty 层 `ChannelInboundHandlerAdapter`，丢弃非 `minecraft` 负载 |
| `ClientCommonPacketListenerImplMixin`<br>`ClientConfigurationPacketListenerImplMixin` | 两个 `handleCustomPayload` 注入点，`priority = 1`，HEAD 处 `ci.cancel()` |
| `ClientCommonPacketListenerImplAccessor`<br>`ConnectionAccessor` | 打开 `connection`、`channel` 私有字段 |

⚠️ 当前实现发送的是 **空 channels 的 `c:register`**（即上表中"不可行"的路线）。
要落地"可行路线"，需改为发送服务端完整通道表（version/flow 真实 + `optional=true`）。

---

## 构建

需要 **JDK 25**（Loom 1.18.2 的 classpath 依赖要求 JVM ≥ 25；编译目标为 Java 21）。

若本机默认 JDK 不是 25，编辑 `gradle.properties` 取消注释并指定：

```properties
org.gradle.java.home=/path/to/your/jdk25
```

然后：

```bash
./gradlew build          # 或用你自己的 gradle
```

产物：`build/libs/nfhandshake-1.0.0.jar`

> 若 `services.gradle.org` 不通，可改用国内镜像源或本地 Gradle 发行版。

---

## 安装

把 jar 放进对应版本的 **mods 目录**（注意版本隔离，不是全局 mods）。

---

## 关于协议考证

本项目的 Mixin 注入点、字段/方法映射均取自 **Mojang 官方映射（mojmap）**，可自行复核：

```
net.minecraft.client.multiplayer.ClientCommonPacketListenerImpl -> hia
    net.minecraft.network.Connection connection -> b
    180:192:void handleCustomPayload(ClientboundCustomPayloadPacket) -> a

net.minecraft.client.multiplayer.ClientConfigurationPacketListenerImpl -> hib
    70:71:void handleCustomPayload(CustomPacketPayload) -> a

net.minecraft.network.Connection -> wu
    io.netty.channel.Channel channel -> k
```

另：`DiscardedPayload -> ace`、`CustomPacketPayload$Type -> acd$b`。
1.21.11 对未知 ID 有 `DiscardedPayload` 回退，**不会**抛 `DecoderException`，
因此在 `handleCustomPayload` 处取消即可，无需做解码前的字节级拦截。

---

## 参考

- [ViaFabricPlus](https://github.com/ViaVersion/ViaFabricPlus) —— 版本协议翻译
- [NeoForge](https://github.com/neoforged/NeoForge) —— 服务端网络协议实现
- [Fabric API](https://github.com/FabricMC/fabric-api) —— 事件与网络 API

---

## 许可

本项目用于学习与公益目的，欢迎改进与分发。
