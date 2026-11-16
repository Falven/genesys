package example.temporal.nexus;

import io.nexusrpc.Operation;
import io.nexusrpc.Service;

@Service(name = "EchoService")
public interface Echo {
    @Operation(name = "Echo")
    String echo(String value);

    @Operation(name = "Reject")
    String reject(String value);
}
