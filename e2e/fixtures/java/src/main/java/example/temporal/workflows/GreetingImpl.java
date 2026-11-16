package example.temporal.workflows;

import example.temporal.activities.Dependent;
import example.temporal.activities.Grouped;
import example.temporal.nexus.Echo;
import io.temporal.activity.ActivityOptions;
import io.temporal.failure.ApplicationFailure;
import io.temporal.failure.NexusOperationFailure;
import io.temporal.workflow.NexusOperationOptions;
import io.temporal.workflow.NexusServiceOptions;
import io.temporal.workflow.Workflow;
import java.time.Duration;

public class GreetingImpl implements Greeting {
    private String state;

    public String run(String name) {
        var activities = ActivityOptions.newBuilder().setStartToCloseTimeout(Duration.ofSeconds(10)).build();
        var grouped = Workflow.newActivityStub(Grouped.class, activities);
        var dependent = Workflow.newActivityStub(Dependent.class, activities);
        var manual = Workflow.newActivityStub(Grouped.Manual.class, activities);
        var nexus = Workflow.newNexusServiceStub(Echo.class, NexusServiceOptions.newBuilder()
                .setEndpoint("genesys-java")
                .setOperationOptions(NexusOperationOptions.newBuilder()
                        .setScheduleToCloseTimeout(Duration.ofSeconds(15)).build())
                .build());

        Workflow.await(() -> state != null);
        return String.join("|", grouped.first(name), grouped.second(), dependent.configured(),
                manual.value(), nexus.echo(state), rejection(nexus));
    }

    private String rejection(Echo nexus) {
        try {
            return nexus.reject(state);
        } catch (NexusOperationFailure failure) {
            if (failure.getCause() instanceof ApplicationFailure cause) {
                return failure.getService() + "/" + failure.getOperation() + ":" + cause.getOriginalMessage();
            }
            throw failure;
        }
    }

    public void resume(String value) {
        state = value;
    }

    public static class BeforeImpl implements Greeting.Before {
        public String run() {
            return "before";
        }
    }
}
