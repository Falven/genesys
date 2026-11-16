using NativeActivity = Temporalio.Activities.ActivityAttribute;

namespace DotnetFixture;

public record WorkerLabel(string Value);

public abstract class FormatterBase
{
    protected FormatterBase(WorkerLabel label)
    {
        InspectionCanary.Mark("constructor");
        Label = label;
    }

    protected WorkerLabel Label { get; }

    [NativeActivity("decorate")]
    protected string Decorate(string input) => $"{Label.Value}:{input}";
}

public static partial class Definitions
{
    public sealed partial class Formatter(WorkerLabel label) : FormatterBase(label)
    {
        [NativeActivity]
        private Task<string> FinishAsync(string input) => Task.FromResult($"{input}:private");
    }
}
