namespace Genesys.Analysis;

internal sealed class Diagnostics
{
    private readonly List<AnalysisDiagnostic> items = [];

    public IReadOnlyList<AnalysisDiagnostic> Items => items;
    public bool HasErrors { get; private set; }

    public void Report(string code, string message, string path, bool error = false)
    {
        items.Add(new("dotnet." + code, error ? "error" : "warning", message, new(path)));
        HasErrors |= error;
    }

    public void Add(AnalysisDiagnostic diagnostic)
    {
        items.Add(diagnostic);
        HasErrors |= diagnostic.Severity == "error";
    }
}
