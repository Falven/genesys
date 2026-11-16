package example.temporal.lib;

import io.temporal.client.WorkflowClient;
import io.temporal.client.WorkflowClientOptions;
import io.temporal.client.WorkflowOptions;
import io.temporal.common.converter.CodecDataConverter;
import io.temporal.common.converter.DefaultDataConverter;
import io.temporal.serviceclient.WorkflowServiceStubs;
import io.temporal.serviceclient.WorkflowServiceStubsOptions;
import java.time.Duration;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

public class NativeClient {
    public static final String QUEUE = "genesys-java";

    public static WorkflowServiceStubs service() {
        return WorkflowServiceStubs.newConnectedServiceStubs(WorkflowServiceStubsOptions.newBuilder()
                .setTarget(System.getenv("TEMPORAL_ADDRESS")).build(), Duration.ofSeconds(10));
    }

    public static WorkflowClient client(WorkflowServiceStubs service) {
        return WorkflowClient.newInstance(service, WorkflowClientOptions.newBuilder()
                .setNamespace(System.getenv("TEMPORAL_NAMESPACE"))
                .setDataConverter(new CodecDataConverter(
                        DefaultDataConverter.newDefaultInstance(), List.of(new AuthoredCodec())))
                .build());
    }

    private static WorkflowOptions workflowOptions() {
        return WorkflowOptions.newBuilder().setTaskQueue(QUEUE)
                .setWorkflowId(UUID.randomUUID().toString())
                .setWorkflowExecutionTimeout(Duration.ofSeconds(40)).build();
    }

    public static void main(String[] args) throws Exception {
        var service = service();
        try {
            var client = client(service);
            var greeting = client.newUntypedWorkflowStub("JavaGreeting", workflowOptions());
            var execution = greeting.signalWithStart(
                    "ContinueGreeting", new Object[]{"signal"}, new Object[]{"Genesys"});
            System.out.println(greeting.getResult(45, TimeUnit.SECONDS, String.class));

            var history = client.fetchHistory(execution.getWorkflowId(), execution.getRunId());
            for (var event : history.getEvents()) {
                if (event.hasWorkflowTaskStartedEventAttributes()) {
                    System.out.println(event.getWorkflowTaskStartedEventAttributes().getIdentity());
                    break;
                }
            }
            var payload = history.getLastEvent().getWorkflowExecutionCompletedEventAttributes()
                    .getResult().getPayloads(0);
            System.out.println(payload.getMetadataOrThrow(AuthoredCodec.MARKER).toStringUtf8());

            var revision = client.newUntypedWorkflowStub(args[0], workflowOptions());
            revision.start();
            System.out.println(revision.getResult(45, TimeUnit.SECONDS, String.class));
        } finally {
            service.shutdownNow();
        }
    }
}
