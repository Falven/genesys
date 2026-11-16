using System.Text.Json;
using Temporalio.Client;

namespace DotnetFixture;

internal static class ClientProbe
{
    public static async Task RunAsync(TemporalClient client, string taskQueue, string generation)
    {
        var endpoint = $"dotnet-{Guid.NewGuid()}";
        await client.OperatorService.CreateNexusEndpointAsync(new()
        {
            Spec = new()
            {
                Name = endpoint,
                Target = new()
                {
                    Worker = new() { Namespace = client.Options.Namespace, TaskQueue = taskQueue },
                },
            },
        });

        WorkflowOptions Options() => new(Guid.NewGuid().ToString(), taskQueue)
        {
            ExecutionTimeout = TimeSpan.FromSeconds(30),
        };

        var greeting = await client.StartWorkflowAsync("dotnet-greeting", new[] { endpoint }, Options());
        await greeting.SignalAsync("finish", new[] { "Genesys" });
        var workflow = await greeting.GetResultAsync<string[]>();
        var authored = await client.ExecuteWorkflowAsync<string>("explicit-job", Array.Empty<object>(), Options());
        var version = await client.ExecuteWorkflowAsync<string>(generation, Array.Empty<object>(), Options());
        Console.WriteLine(JsonSerializer.Serialize(new { workflow, authored, version }));
    }
}
