using DotnetFixture;
using Genesys.Generated;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Temporalio.Client;
using Temporalio.Extensions.Hosting;
using Temporalio.Worker;
using Temporalio.Worker.Interceptors;
using Temporalio.Workflows;

var address = RequiredEnvironment("TEMPORAL_ADDRESS");
var space = RequiredEnvironment("TEMPORAL_NAMESPACE");
var mode = Environment.GetEnvironmentVariable("GENESYS_DOTNET_MODE") ?? "raw";
var queue = $"dotnet-{mode}";

if (args is ["probe", var generation])
{
    var client = await TemporalClient.ConnectAsync(new(address) { Namespace = space });
    await ClientProbe.RunAsync(client, queue, generation);
    return;
}

if (mode == "hosted")
{
    var host = Host.CreateApplicationBuilder();
    host.Services.AddTemporalClient(clientTargetHost: address, clientNamespace: space);
    host.Services.AddSingleton(new WorkerLabel("hosting-dependency"));
    host.Services.AddScoped<Definitions.Formatter>();
    host.Services.AddScoped<Greeter>();
    host.Services.AddHostedTemporalWorker(queue).AddGenesys().ConfigureOptions(ConfigureOptions);
    await host.Build().RunAsync();
}
else
{
    var label = new WorkerLabel("supplied-instance");
    var options = new TemporalWorkerOptions(queue)
        .AddGenesysWorkflows()
        .AddGenesysStaticActivities()
        .AddGenesysActivities(new Definitions.Formatter(label))
        .AddGenesysNexus(new Greeter(label));
    ConfigureOptions(options);

    using var stopped = new CancellationTokenSource();
    Console.CancelKeyPress += (_, interrupt) =>
    {
        interrupt.Cancel = true;
        stopped.Cancel();
    };
    var client = await TemporalClient.ConnectAsync(new(address) { Namespace = space });
    using var worker = new TemporalWorker(client, options);
    try
    {
        await worker.ExecuteAsync(stopped.Token);
    }
    catch (OperationCanceledException) when (stopped.IsCancellationRequested)
    {
    }
}

static void ConfigureOptions(TemporalWorkerOptions options)
{
    options.Interceptors = new IWorkerInterceptor[] { new DecorationInterceptor() };
    options.AddWorkflow(WorkflowDefinition.Create(
        typeof(AuthoredJob), "explicit-job", _ => new AuthoredJob("authored-factory")));
}

static string RequiredEnvironment(string key) =>
    Environment.GetEnvironmentVariable(key) ?? throw new InvalidOperationException($"Missing {key}");
