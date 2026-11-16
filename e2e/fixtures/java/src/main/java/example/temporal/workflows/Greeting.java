package example.temporal.workflows;

import io.temporal.workflow.SignalMethod;
import io.temporal.workflow.WorkflowInterface;
import io.temporal.workflow.WorkflowMethod;

@WorkflowInterface
public interface Greeting {
    @WorkflowMethod(name = "Java" + "Greeting")
    String run(String name);

    @SignalMethod(name = "ContinueGreeting")
    void resume(String value);

    @WorkflowInterface
    interface Before {
        @WorkflowMethod(name = "BeforeBuild")
        String run();
    }
}
