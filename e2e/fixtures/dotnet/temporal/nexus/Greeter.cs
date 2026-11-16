using NexusRpc;
using NexusRpc.Handlers;

namespace DotnetFixture;

[NexusService("FixtureGreeter")]
public interface IGreeter
{
    [NexusOperation("echo")]
    string Echo(string value);

    [NexusOperation("reject")]
    string Reject(string value);
}

[NexusServiceHandler(typeof(IGreeter))]
public class Greeter(WorkerLabel label)
{
    [NexusOperationHandler]
    public IOperationHandler<string, string> Echo() =>
        OperationHandler.Sync<string, string>((_, value) => $"{label.Value}:nexus:{value}");

    [NexusOperationHandler]
    public IOperationHandler<string, string> Reject() =>
        OperationHandler.Sync<string, string>(
            (Func<OperationStartContext, string, string>)((_, _) =>
                throw OperationException.CreateFailed("rejected by fixture")));
}
