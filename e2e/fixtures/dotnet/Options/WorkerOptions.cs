using System.Runtime.CompilerServices;
using Temporalio.Activities;
using Temporalio.Worker.Interceptors;

namespace DotnetFixture;

public sealed class DecorationInterceptor : IWorkerInterceptor
{
    public ActivityInboundInterceptor InterceptActivity(ActivityInboundInterceptor next) =>
        new DecorationInbound(next);

    private sealed class DecorationInbound(ActivityInboundInterceptor next) : ActivityInboundInterceptor(next)
    {
        public override async Task<object?> ExecuteActivityAsync(ExecuteActivityInput input)
        {
            var result = await base.ExecuteActivityAsync(input);
            return ActivityExecutionContext.Current.Info.ActivityType == "decorate"
                ? $"intercepted:{result}"
                : result;
        }
    }
}

internal static class InspectionCanary
{
    [ModuleInitializer]
    internal static void Initialize() => Mark("module");

    internal static void Mark(string eventName)
    {
        var marker = Environment.GetEnvironmentVariable("GENESYS_DOTNET_INSPECTION_MARKER");
        if (marker != null)
            File.AppendAllText(marker, eventName + Environment.NewLine);
    }
}
