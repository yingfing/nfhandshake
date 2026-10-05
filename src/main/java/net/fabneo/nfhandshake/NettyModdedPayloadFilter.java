package net.fabneo.nfhandshake;

import io.netty.channel.ChannelHandler;
import io.netty.channel.ChannelHandlerContext;
import io.netty.channel.ChannelInboundHandlerAdapter;
import io.netty.util.ReferenceCountUtil;
import net.minecraft.network.protocol.common.ClientboundCustomPayloadPacket;

/**
 * 真正挂在 {@code ChannelPipeline} 上的入站处理器。
 *
 * <p>插入位置：{@code pipeline.addBefore(HandlerNames.PACKET_HANDLER, "nfhandshake_filter", ...)}。
 * {@code HandlerNames.PACKET_HANDLER} 就是 Minecraft 自己的 {@code Connection} 处理器
 * （{@code Connection} 本体是 {@code SimpleChannelInboundHandler<Packet<?>>}），
 * 所以本处理器会在 Minecraft 处理数据包之前拿到已经解码好的 {@code Packet} 对象。
 *
 * <p>丢弃方式：<b>不调用 {@code ctx.fireChannelRead(msg)}</b>，并释放引用计数，
 * 数据包不会继续向下传播，也不会回包 —— 即需求文档所说的「静默丢弃」。
 *
 * <p>为什么不做「解码器之前的字节级拦截」：见 {@code NfHandshakeClient.shouldDrop} 的注释 ——
 * 1.21.11 的 {@code ClientboundCustomPayloadPacket} 用 {@code DiscardedPayload} 作未知 ID 回退，
 * 解码阶段不会抛 {@code DecoderException}；而在 {@code PacketDecoder} 之前只有裸 {@code ByteBuf}，
 * 必须靠包 ID 猜测才能定位命名空间，任何偏移误算都会误伤原版数据包。
 */
@ChannelHandler.Sharable
public class NettyModdedPayloadFilter extends ChannelInboundHandlerAdapter {

	public static final String NAME = "nfhandshake_filter";

	public static final NettyModdedPayloadFilter INSTANCE = new NettyModdedPayloadFilter();

	@Override
	public void channelRead(ChannelHandlerContext ctx, Object msg) throws Exception {
		if (msg instanceof ClientboundCustomPayloadPacket packet
				&& NfHandshakeClient.shouldDrop(packet.payload())) {
			ReferenceCountUtil.release(msg);
			return;
		}

		super.channelRead(ctx, msg);
	}
}
