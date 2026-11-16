using Temporalio.Workflows;

namespace DotnetFixture;

[Workflow]
public class RetiredJob
{
    [WorkflowRun]
    public Task<string> RunAsync() => Task.FromResult("retired");
}
