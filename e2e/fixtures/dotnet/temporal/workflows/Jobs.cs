using Temporalio.Exceptions;
using Temporalio.Workflows;
using NativeWorkflow = Temporalio.Workflows.WorkflowAttribute;

namespace DotnetFixture;

[NativeWorkflow(Name)]
public class Greeting
{
    private const string Name = "dotnet-greeting";
    private string? message;

    [WorkflowSignal("finish")]
    public Task FinishAsync(string value)
    {
        message = value;
        return Task.CompletedTask;
    }

    [WorkflowRun]
    public async Task<string[]> RunAsync(string endpoint)
    {
        await Workflow.WaitConditionAsync(() => message != null);
        var activityOptions = new ActivityOptions { StartToCloseTimeout = TimeSpan.FromSeconds(5) };
        var decorated = await Workflow.ExecuteActivityAsync<string>("decorate", new[] { message }, activityOptions);
        var finished = await Workflow.ExecuteActivityAsync<string>("Finish", new[] { decorated }, activityOptions);
        var tagged = await Workflow.ExecuteActivityAsync<string>("Tag", new[] { finished }, activityOptions);

        var nexus = Workflow.CreateNexusWorkflowClient("FixtureGreeter", endpoint);
        var echoed = await nexus.ExecuteNexusOperationAsync<string>("echo", message);
        string outcome;
        try
        {
            outcome = await nexus.ExecuteNexusOperationAsync<string>("reject", message);
        }
        catch (NexusOperationFailureException error) when (error.InnerException?.Message == "rejected by fixture")
        {
            outcome = "rejected by fixture";
        }
        return new[] { tagged, echoed, outcome };
    }
}

[Workflow]
public class AuthoredJob
{
    private readonly string value;

    public AuthoredJob(string value)
    {
        InspectionCanary.Mark("factory");
        this.value = value;
    }

    [WorkflowRun]
    public Task<string> RunAsync() => Task.FromResult(value);
}
