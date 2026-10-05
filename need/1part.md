把前面所有讨论收拢一下，你真正需要的是一个**四层架构的 Fabric 客户端模组**。每一层解决一个独立的问题，缺一不可。

### 🧱 第一层：版本协议翻译（ViaFabricPlus 负责）

你的客户端是 **1.21.11**，服务器是 **1.21.1**。Minecraft 原生协议在不同版本间不兼容，这一层必须存在。

**你不需要写代码。** 直接安装 **ViaFabricPlus**，它会把 1.21.11 客户端的网络协议“降级”到 1.21.1，让 Minecraft 原生层面的通信能够建立。

**这一层的关键产出**：你的客户端能收到服务器发来的 `minecraft:register` 包，也能向服务器发送数据包。

### 🧱 第二层：加载器握手伪造（你的模组核心）

ViaFabricPlus 只管 Minecraft 原生协议，不管 NeoForge 的加载器握手。NeoForge 服务器在配置阶段会期待客户端回复 `c:register`（`CommonRegisterPayload`），你不回复，服务器就踢你。

**你的模组需要做的**：

在 Fabric API 的 `ClientConfigurationConnectionEvents.START` 事件中，构造并发送一个 `c:register` 包：

```java
ClientConfigurationConnectionEvents.START.register((handler, client) -> {
    CommonRegisterPayload payload = new CommonRegisterPayload(
        0,          // version，NeoForge 未使用
        "play",     // phase
        Set.of()    // channels，空集——关键在这里
    );
    ClientConfigurationNetworking.send(payload);
});
```

**为什么 channels 必须是空集**：这是让服务器把你标记为“非模组化客户端”的唯一方式。NeoForge 的 `NetworkRegistry` 在协商时会检测：如果客户端声明的通道与服务器注册的通道没有交集，且客户端没有声明任何模组通道，服务器就会将连接归类为 `vanilla/other`。之后，服务器**不应该**向这个连接发送模组专用数据包。

**这一层的关键产出**：服务器认为你是一个“干净的”客户端，握手通过，允许你进入游戏阶段。

### 🧱 第三层：游戏阶段数据包静默丢弃（你的模组兜底）

即使服务器把你标记为 `vanilla/other`，少数模组（尤其是机械动力这种大型模组）可能不遵守约定，仍然向所有连接广播数据包。或者，服务器在配置阶段之后仍然发送某些模组通道的注册信息。

**你的模组需要做的**：

在 Netty 的 `ChannelPipeline` 中插入一个自定义 `ChannelHandler`，**在 Minecraft 的包解码器之前**拦截入站数据。判断逻辑：

- 如果包的命名空间是 `minecraft`，放行。
- 如果包的命名空间不是 `minecraft`（如 `create`、`neoforge`），**在解码器读取 payload 之前直接丢弃**。

**关键技巧**：不能等到包对象构造出来再丢弃，因为解码阶段就会因为找不到对应的 `StreamCodec` 而抛出 `DecoderException`，连接直接崩溃。你需要在**字节层面**消耗掉这个包，或者阻止解码器处理它。

**参考实现**：ViaFabricPlus 自己在 `ClientCommonNetworkHandler` 的 `onCustomPayload` 方法中做了类似的事，它的 Mixin 优先级比 Fabric API 更高，确保在 Fabric 的包处理逻辑之前介入。你可以参考它的注入点和丢弃逻辑。

**这一层的关键产出**：即使服务器误发模组数据包，你的客户端也不会崩溃，只是静默忽略。

### 🧱 第四层：原版交互完整性（不需要额外代码）

这一层是你最终的目标：与服务器上的原版内容正常交互。方块、生物、物品、聊天、容器——这些全部走 `minecraft` 命名空间的原版协议，ViaFabricPlus 已经处理了版本翻译，你的模组不需要干预。

**唯一可能出问题的地方**：如果服务器端的机械动力模组修改了原版方块的行为（比如给某个原版方块添加了新的交互逻辑），而这些逻辑依赖模组数据包来同步状态，那么你的客户端可能看到的是“未修改”的原版行为。但这是**服务器端模组的设计问题**，不是你的模组能解决的。

### 📋 最终交付物清单

| 组件 | 类型 | 是否需要你开发 | 作用 |
|------|------|----------------|------|
| ViaFabricPlus | 现成模组 | 否 | 版本协议翻译（1.21.11 → 1.21.1） |
| 握手伪造模块 | 你的 Fabric 模组 | 是 | 发送空 `c:register`，通过 NeoForge 握手 |
| Netty 拦截器 | 你的 Fabric 模组 | 是 | 解码前丢弃非 `minecraft` 命名空间的数据包 |
| 原版交互 | 无需代码 | 否 | ViaFabricPlus + 原版协议自动处理 |

### 🎯 一句话总结

你需要的模组是一个 **“NeoForge 握手伪装 + 非原版数据包静默丢弃”** 的 Fabric 客户端模组，配合 ViaFabricPlus 使用。它的核心逻辑只有两件事：**在配置阶段回复一个空 channels 的 `c:register`**，以及**在游戏阶段于 Netty 层拦截并丢弃所有非 `minecraft` 命名空间的入站数据包**。整个模组的代码量不大，难点在于找到正确的 Mixin 注入点和 Netty Handler 插入位置。