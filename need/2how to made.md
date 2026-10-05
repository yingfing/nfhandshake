下面是从零开始实现这个模组的完整技术方案。整个模组只需要两个核心类：**一个握手伪造类**和**一个Netty拦截器**。

---

## 1. 项目基础结构

### 1.1 build.gradle 关键配置

```groovy
dependencies {
    minecraft "com.mojang:minecraft:1.21.1"
    mappings "net.fabricmc:yarn:1.21.1+build.3:v2"
    modImplementation "net.fabricmc:fabric-loader:0.16.x"
    modImplementation "net.fabricmc.fabric-api:fabric-api:0.115.x+1.21.1"
    
    // Mixin 支持（Fabric Loom 自动配置，但需要确保 mixin 配置正确）
}

mixin {
    defaultRefmapName = "your-mod-id-refmap.json"
}
```

### 1.2 fabric.mod.json 配置

```json
{
  "id": "your-mod-id",
  "version": "1.0.0",
  "environment": "client",
  "entrypoints": {
    "client": ["com.yourmod.YourModClient"]
  },
  "mixins": ["your-mod-id.mixins.json"],
  "depends": {
    "fabricloader": ">=0.16.0",
    "fabric-api": "*",
    "minecraft": "~1.21.1"
  }
}
```

### 1.3 Mixin 配置文件 (your-mod-id.mixins.json)

```json
{
  "required": true,
  "minVersion": "0.8",
  "package": "com.yourmod.mixin",
  "compatibilityLevel": "JAVA_21",
  "client": [
    "MixinClientCommonNetworkHandler"
  ],
  "injectors": {
    "defaultRequire": 1
  }
}
```


## 2. 第一层：握手伪造（发送空 c:register）

### 2.1 核心逻辑

NeoForge 服务器在配置阶段会向客户端发送 `c:register` 负载。NeoForge 客户端在收到此负载后，会回复一个 `CommonRegisterPayload`。你的 Fabric 模组需要在正确时机构造并发送一个格式相同的回复，且 `channels` 为空集。

### 2.2 代码实现

```java
package com.yourmod;

import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.networking.v1.ClientConfigurationConnectionEvents;
import net.fabricmc.fabric.api.client.networking.v1.ClientConfigurationNetworking;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.ResourceLocation;

import java.util.Set;

public class YourModClient implements ClientModInitializer {

    // NeoForge 的 c:register 负载 ID
    private static final CustomPacketPayload.Id<NeoForgeRegisterPayload> REGISTER_ID = 
        new CustomPacketPayload.Id<>(ResourceLocation.parse("c:register"));

    @Override
    public void onInitializeClient() {
        // 监听服务器发来的 c:register 负载
        ClientConfigurationNetworking.registerGlobalReceiver(
            REGISTER_ID,
            (payload, context) -> {
                // 收到服务器的 c:register 后，回复一个空的 channels 集合
                var emptyRegister = new NeoForgeRegisterPayload(
                    0,          // version，NeoForge 未使用
                    "play",     // phase，NeoForge 只处理 play 阶段
                    Set.of()    // channels，空集——关键！
                );
                context.responseSender().sendPacket(emptyRegister);
            }
        );
    }
}
```

### 2.3 关于 ClientConfigurationConnectionEvents

Fabric API 的 `ClientConfigurationConnectionEvents.START` 事件在连接已初始化、可以开始收发配置阶段数据包时触发。但**不要用 INIT 事件**，那个阶段连接仍处于 LOGIN 状态，无法发送数据包。

实际上，上面的代码使用了更精确的方式：**监听服务器发来的 `c:register` 负载，在收到后立即回复**。这是 NeoForge 客户端本身的行为模式——Neo 客户端是在**收到服务器的 `c:register` 后才回复的**。

### 2.4 为什么 channels 必须是空集

NeoForge 的 `NetworkRegistry` 在协商时会检测：如果客户端声明的通道与服务器注册的通道**没有交集**，且客户端**没有声明任何模组通道**，服务器就会调用 `initializeOtherConnection()` 将连接标记为 `vanilla/other`。之后，服务器**不应该**向这个连接发送模组专用数据包。


## 3. 第二层：Netty 数据包拦截（静默丢弃非原版包）

### 3.1 为什么需要这一层

即使服务器把你标记为 `vanilla/other`，少数模组仍可能向所有连接广播数据包。更关键的是，**即使包被丢弃，如果解码器已经尝试解析了 payload，连接就会因 `DecoderException` 崩溃**。因此必须在**解码器之前**拦截。

### 3.2 Mixin 注入点

参考 ViaFabricPlus 的实现，它在 `ClientCommonNetworkHandler` 的 `onCustomPayload` 方法上注入，且**优先级设为 1**（高于 Fabric API），确保在 Fabric 的包处理逻辑之前介入：

```java
@Mixin(value = ClientCommonNetworkHandler.class, priority = 1)
public abstract class MixinClientCommonNetworkHandler {

    @Inject(
        method = "onCustomPayload(Lnet/minecraft/network/packet/s2c/common/CustomPayloadS2CPacket;)V",
        at = @At("HEAD"),
        cancellable = true
    )
    private void interceptModdedPayload(CustomPayloadS2CPacket packet, CallbackInfo ci) {
        var payloadId = packet.payload().getId().id();
        
        // 如果命名空间不是 minecraft，直接取消处理
        if (!payloadId.getNamespace().equals("minecraft")) {
            // 静默丢弃，不交给下游解码器
            ci.cancel();
        }
    }
}
```

### 3.3 但 Mixin 注入在 onCustomPayload 可能不够早

`onCustomPayload` 已经被调用时，payload 可能已经被解码成对象了。更安全的做法是**在 Netty Pipeline 层面插入 Handler**，放在 `MINECRAFT_DECODER` 之前：

```java
public class PacketFilterHandler extends ChannelInboundHandlerAdapter {

    @Override
    public void channelRead(ChannelHandlerContext ctx, Object msg) throws Exception {
        if (msg instanceof ByteBuf buf) {
            // 读取包 ID（前几个字节是 VarInt 包 ID）
            int packetId = readVarInt(buf);
            
            // 检查这个包 ID 是否对应一个模组自定义负载
            // 如果客户端没有注册这个包的编解码器，就不要传给解码器
            if (!isKnownPacket(packetId)) {
                // 消耗掉字节，丢弃这个包
                buf.release();
                return; // 不调用 ctx.fireChannelRead(msg)
            }
            
            // 重置读取索引，放行
            buf.resetReaderIndex();
        }
        super.channelRead(ctx, msg);
    }
}
```

**插入 Handler 的时机**：在连接建立时（`ChannelInitializer` 阶段）或通过 `ClientConfigurationConnectionEvents.INIT` 获取到 `ClientConfigurationPacketListenerImpl` 后，操作其底层的 `Connection` 的 `ChannelPipeline`：

```java
// 在 INIT 事件中注入
ClientConfigurationConnectionEvents.INIT.register((handler, client) -> {
    var connection = ((ClientConfigurationPacketListenerImplAccessor) handler).getConnection();
    var channel = ((ConnectionAccessor) connection).getChannel();
    channel.pipeline().addBefore("decoder", "packet_filter", new PacketFilterHandler());
});
```

ViaFabricPlus 本身就是在 `ClientCommonNetworkHandler` 的 Mixin 中处理自定义负载的，其丢弃逻辑是**在业务层取消**（`ci.cancel()`），而不是在 Netty 层。如果你的场景中 `onCustomPayload` 的取消足够早，可以先尝试这种方式。如果仍然崩溃，再下移到 Netty Pipeline。


## 4. 第三层：ViaFabricPlus 兼容性

### 4.1 ViaFabricPlus 对自定义负载的处理

ViaFabricPlus 会**透传命名空间不是 `minecraft` 的负载**，让它们落到 Fabric API 的负载处理流程中。这意味着你的 Mixin 注入点需要在 ViaFabricPlus 的 Handler **之后**执行，才能拦截到这些包。

ViaFabricPlus 的 Mixin 优先级是 `1`，你的 Mixin 如果需要更晚执行，可以设置优先级为 `2` 或更低（数字越大优先级越低）。

### 4.2 与 ViaFabricPlus 的事件顺序

ViaFabricPlus 通过 `IdlePacketExecutor` 等机制在协议层做版本翻译。你的 `ClientConfigurationNetworking` 接收器会在 ViaFabricPlus 完成协议翻译**之后**触发。因此：

- 服务器发来的 `c:register`（NeoForge 格式）→ ViaFabricPlus 透传 → 你的接收器收到 → 你回复空 `c:register`
- 服务器发来的模组数据包 → ViaFabricPlus 透传 → 你的 Mixin 拦截并丢弃


## 5. 测试与调试

### 5.1 验证握手是否成功

在 NeoForge 服务器端日志中搜索 `initializeOtherConnection` 或 `vanilla/other`。如果服务器在配置阶段完成后将你的连接标记为 vanilla，说明握手伪造成功。

### 5.2 验证数据包拦截

在你的 Mixin 中添加日志：

```java
if (!payloadId.getNamespace().equals("minecraft")) {
    LOGGER.info("Dropped modded payload: {}", payloadId);
    ci.cancel();
}
```

如果连接不再因 `DecoderException` 崩溃，且日志中出现了被丢弃的 `create:xxx` 包，说明拦截生效。

### 5.3 常见问题排查

| 症状 | 可能原因 | 解决 |
|------|----------|------|
| 连接在配置阶段被踢 | `c:register` 未发送或格式错误 | 检查 `ClientConfigurationNetworking.registerGlobalReceiver` 是否正确注册 |
| 连接在进入游戏后立即崩溃 | 模组数据包在解码阶段抛出异常 | 将 Mixin 注入点下移到 Netty Pipeline 的 `MINECRAFT_DECODER` 之前 |
| 服务器仍然发送模组数据包 | `initializeOtherConnection` 未被调用 | 确认 `channels` 确实是空集，且 `phase` 为 `"play"` |
| Mixin 未生效 | 优先级低于 ViaFabricPlus 或 Fabric API | 设置 `priority = 2` 或更低（数字越大越晚执行） |


## 6. 最终项目结构

```
your-mod/
├── build.gradle
├── src/main/
│   ├── java/com/yourmod/
│   │   ├── YourModClient.java          // 入口，注册握手回复
│   │   ├── NeoForgeRegisterPayload.java // c:register 负载定义
│   │   ├── PacketFilterHandler.java     // Netty 拦截器
│   │   └── mixin/
│   │       └── MixinClientCommonNetworkHandler.java
│   └── resources/
│       ├── fabric.mod.json
│       └── your-mod-id.mixins.json
```

整个模组的核心代码量大约在 **150-200 行**左右。难点在于**找到正确的 Mixin 注入点**和**确保拦截发生在解码之前**。建议先实现握手回复，确认连接能通过配置阶段，再逐步添加 Netty 拦截逻辑。