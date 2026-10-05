package net.fabneo.nfhandshake;

import java.util.HashSet;
import java.util.Set;

import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.network.codec.ByteBufCodecs;
import net.minecraft.network.codec.StreamCodec;
import net.minecraft.network.protocol.common.custom.CustomPacketPayload;
import net.minecraft.resources.Identifier;

/**
 * {@code c:register} 负载。
 *
 * <p>本类逐字段复刻 NeoForge 的
 * {@code net.neoforged.neoforge.network.payload.CommonRegisterPayload}，
 * 以保证线格式字节级兼容（NeoForge 端 {@code onCommonRegister} 会用同一个
 * {@code StreamCodec} 解析）。
 *
 * <p>对应的 NeoForge 原始定义（21.1.x 分支）：
 * <pre>
 * public record CommonRegisterPayload(int version, ConnectionProtocol protocol, Set&lt;Identifier&gt; channels)
 *         implements CustomPacketPayload {
 *     public static final Identifier ID = Identifier.fromNamespaceAndPath("c", "register");
 *     public static final StreamCodec&lt;FriendlyByteBuf, CommonRegisterPayload&gt; STREAM_CODEC = StreamCodec.composite(
 *             ByteBufCodecs.VAR_INT, CommonRegisterPayload::version,
 *             ByteBufCodecs.STRING_UTF8.map(CommonRegisterPayload::protocolById, ConnectionProtocol::id),
 *                     CommonRegisterPayload::protocol,
 *             ByteBufCodecs.collection(HashSet::new, Identifier.STREAM_CODEC), CommonRegisterPayload::channels,
 *             CommonRegisterPayload::new);
 * }
 * </pre>
 *
 * <p>差异说明：本实现把 {@code protocol} 字段直接用 {@code String} 承载。因为 NeoForge 侧的
 * 编码就是 {@code ConnectionProtocol::id}（即 {@code "play"} / {@code "configuration"}），
 * 解码是 {@code protocolById(String)}，所以用字符串走线完全等价。
 */
public record CommonRegisterPayload(int version, String phase, Set<Identifier> channels)
		implements CustomPacketPayload {

	public static final Identifier ID = Identifier.fromNamespaceAndPath("c", "register");

	public static final CustomPacketPayload.Type<CommonRegisterPayload> TYPE =
			new CustomPacketPayload.Type<>(ID);

	/** {@code ConnectionProtocol.PLAY.id()} */
	public static final String PLAY_PHASE = "play";

	/** {@code ConnectionProtocol.CONFIGURATION.id()} */
	public static final String CONFIGURATION_PHASE = "configuration";

	public static final StreamCodec<FriendlyByteBuf, CommonRegisterPayload> STREAM_CODEC = StreamCodec.composite(
			ByteBufCodecs.VAR_INT, CommonRegisterPayload::version,
			ByteBufCodecs.STRING_UTF8, CommonRegisterPayload::phase,
			ByteBufCodecs.collection(HashSet::new, Identifier.STREAM_CODEC), CommonRegisterPayload::channels,
			CommonRegisterPayload::new);

	@Override
	public CustomPacketPayload.Type<CommonRegisterPayload> type() {
		return TYPE;
	}
}
