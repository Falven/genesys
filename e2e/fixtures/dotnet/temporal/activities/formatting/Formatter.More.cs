using Temporalio.Activities;

namespace DotnetFixture;

public static partial class Definitions
{
    public sealed partial class Formatter
    {
        [Activity]
        private string Tag(string input) => $"{input}:partial";
    }
}
