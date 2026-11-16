package example.temporal.lib;

import com.google.protobuf.ByteString;
import io.temporal.api.common.v1.Payload;
import io.temporal.payload.codec.PayloadCodec;
import java.util.List;

public class AuthoredCodec implements PayloadCodec {
    public static final String MARKER = "genesys-java-codec";

    public List<Payload> encode(List<Payload> payloads) {
        return payloads.stream().map(payload -> payload.toBuilder()
                .putMetadata(MARKER, ByteString.copyFromUtf8("authored")).build()).toList();
    }

    public List<Payload> decode(List<Payload> payloads) {
        return payloads.stream().map(payload -> payload.toBuilder().removeMetadata(MARKER).build()).toList();
    }
}
