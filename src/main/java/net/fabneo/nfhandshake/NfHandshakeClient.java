package net.fabneo.nfhandshake;

import java.util.Set;

import io.netty.channel.Channel;
import io.netty.channel.ChannelPipeline;
import net.fabneo.nfhandshake.mixin.ClientCommonPacketListenerImplAccessor;
import net.fabneo.nfhandshake.mixin.ConnectionAccessor;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.networking.v1.ClientConfigurationConnectionEvents;
import net.fabricmc.fabric.api.client.networking.v1.ClientConfigurationNetworking;
import net.fabricmc.fabric.api.client.networking.v1.ClientPlayConnectionEvents;
import net.fabricmc.fabric.api.networking.v1.PayloadTypeRegistry;
import net.minecraft.client.multiplayer.ClientCommonPacketListenerImpl;
import net.minecraft.network.Connection;
import net.minecraft.network.HandlerNames;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.network.protocol.common.custom.DiscardedPayload;
import net.minecraft.resources.Identifier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * 配置阶段握手适配器 + Netty 层负载过滤器安装。
 *
 * <p>本类做三件事：
 * <ol>
 *   <li>在配置阶段开始（{@code ClientConfigurationConnectionEvents.START}）时，向服务器发送一个
 *       {@code channels} 为<b>空集</b>的 {@code c:register} 负载。</li>
 *   <li>在配置阶段与游戏阶段初始化时，把 {@link NettyModdedPayloadFilter} 注入到
 *       {@code ChannelPipeline} 的 {@code packet_handler} 之前。</li>
 *   <li>在数据包处理层（Mixin）与 Netty 层双重静默丢弃非 {@code minecraft} 命名空间的入站负载。</li>
 * </ol>
 *
 * <p><b>协议依据（均来自本机 NeoForge 21.1.248 产物逆向，非猜测）：</b>
 * <ul>
 *   <li>{@code c:register} 的 ID 为 {@code Identifier.fromNamespaceAndPath("c", "register")}
 *       —— NeoForge {@code CommonRegisterPayload.java:28}。</li>
 *   <li>线格式 {@code VAR_INT version | STRING_UTF8 protocol.id() | collection(HashSet, Identifier) channels}
 *       —— 同文件 30-34 行。</li>
 *   <li>服务端只在客户端声明了 {@code c:version}/{@code c:register} 时才注册这两个会阻塞等待的任务
 *       —— NeoForge {@code ConfigurationInitialization.java:49}。</li>
 * </ul>
 */
public class NfHandshakeClient implements ClientModInitializer {
	public static final String MOD_ID = "nfhandshake";
	public static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);

	private static final String MINECRAFT_NAMESPACE = "minecraft";

	@Override
	public void onInitializeClient() {
		// 注册 C2S 负载类型，否则 ClientConfigurationNetworking.send 会抛 IllegalArgumentException
		PayloadTypeRegistry.configurationC2S()
				.register(CommonRegisterPayload.TYPE, CommonRegisterPayload.STREAM_CODEC);

		ClientConfigurationConnectionEvents.START.register((handler, client) -> {
			try {
				ClientConfigurationNetworking.send(
						new CommonRegisterPayload(1, CommonRegisterPayload.PLAY_PHASE, Set.of()));
				LOGGER.info("[{}] 已发送空 c:register (version=1, phase=play, channels=[])", MOD_ID);
			} catch (Throwable t) {
				LOGGER.warn("[{}] 发送 c:register 失败", MOD_ID, t);
			}
		});

		// 配置阶段 / 游戏阶段都装上 Netty 过滤器
		ClientConfigurationConnectionEvents.INIT.register((handler, client) -> installNettyFilter(handler));
		ClientPlayConnectionEvents.INIT.register((handler, client) -> installNettyFilter(handler));
	}

	/**
	 * 把 {@link NettyModdedPayloadFilter} 插入到 {@code packet_handler} 之前。
	 *
	 * <p>{@code Connection.channel} 是 private 字段，{@code ClientCommonPacketListenerImpl.connection}
	 * 也是，所以经由两个 accessor mixin 取到 {@code ChannelPipeline}。
	 * 整段用 try/catch 包住：即使某个版本的管线结构变化，也只会留下一条警告日志，不会影响连接。
	 */
	private static void installNettyFilter(ClientCommonPacketListenerImpl handler) {
		try {
			Connection connection = ((ClientCommonPacketListenerImplAccessor) handler).nfhandshake$getConnection();
			if (connection == null) {
				return;
			}

			Channel channel = ((ConnectionAccessor) connection).nfhandshake$getChannel();
			if (channel == null) {
				return;
			}

			ChannelPipeline pipeline = channel.pipeline();
			if (pipeline.get(NettyModdedPayloadFilter.NAME) != null) {
				return;
			}

			pipeline.addBefore(HandlerNames.PACKET_HANDLER, NettyModdedPayloadFilter.NAME,
					NettyModdedPayloadFilter.INSTANCE);
			LOGGER.info("[{}] 已注入 Netty 过滤器: before '{}'", MOD_ID, HandlerNames.PACKET_HANDLER);
		} catch (Throwable t) {
			LOGGER.warn("[{}] 注入 Netty 过滤器失败（不影响连接）", MOD_ID, t);
		}
	}

	/**
	 * 判断一个入站自定义负载是否应当被静默丢弃。
	 *
	 * <p>判定规则：命名空间不是 {@code minecraft} 即丢弃。
	 *
	 * <p>关于 {@link DiscardedPayload}：Minecraft 1.21.11 的
	 * {@code ClientboundCustomPayloadPacket.STREAM_CODEC} 使用
	 * {@code CustomPacketPayload.codec(FallbackProvider, List<TypeAndCodec>)}，并以
	 * {@code DiscardedPayload.codec(MAX_PAYLOAD_SIZE)} 作为回退。未知 ID 会被解码成
	 * {@code DiscardedPayload}，<b>不会</b>抛 {@code DecoderException}。而
	 * {@code DiscardedPayload.type().id()} 仍返回原始 ID，所以下面的命名空间判断对它同样有效。
	 */
	public static boolean shouldDrop(CustomPacketPayload payload) {
		if (payload == null) {
			return false;
		}

		Identifier id = payload.type().id();
		if (id == null) {
			return false;
		}

		if (!MINECRAFT_NAMESPACE.equals(id.getNamespace())) {
			if (payload instanceof DiscardedPayload) {
				LOGGER.info("[{}] 丢弃未知负载（DiscardedPayload）: {}", MOD_ID, id);
			} else {
				LOGGER.info("[{}] 丢弃非 minecraft 命名空间负载: {}", MOD_ID, id);
			}
			return true;
		}

		return false;
	}
}
