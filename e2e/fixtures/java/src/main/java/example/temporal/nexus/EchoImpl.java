package example.temporal.nexus;

import io.nexusrpc.OperationException;
import io.nexusrpc.handler.OperationHandler;
import io.nexusrpc.handler.OperationImpl;
import io.nexusrpc.handler.ServiceImpl;

@ServiceImpl(service = Echo.class)
public class EchoImpl {
    private final String prefix;

    public EchoImpl(String prefix) {
        this.prefix = prefix;
    }

    @OperationImpl
    public OperationHandler<String, String> echo() {
        return OperationHandler.sync((context, details, value) -> prefix + ":" + value);
    }

    @OperationImpl
    public OperationHandler<String, String> reject() {
        return OperationHandler.sync((context, details, value) -> {
            throw OperationException.failed(prefix + " rejected " + value);
        });
    }
}
