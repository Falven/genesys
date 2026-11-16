using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.CodeAnalysis;

namespace Genesys.Analysis;

internal sealed record AnalysisInput(
    PackageContext Package,
    SourceEntry[] Entries,
    Dictionary<string, string> Sources,
    string Suffix,
    string? Mode = null);

internal sealed record PackageContext(string Id, string Root, string[] Manifests);
internal sealed record SourceEntry(string Id, string Path, string Role, string? WorkerName = null);
internal sealed record SourceLocation(string Path, int? Line = null, int? Column = null)
{
    public static SourceLocation From(string path, SyntaxNode? node = null)
    {
        var position = node?.GetLocation().GetLineSpan().StartLinePosition;
        return new(path, position?.Line + 1, position?.Character + 1);
    }
}

internal sealed record AnalysisDiagnostic(string Code, string Severity, string Message, SourceLocation Source);
internal sealed record DefinitionIdentity(string? Name, string State, string? Reason);
internal sealed record DefinitionConstruction(string Symbol, string Reason);
internal sealed record Definition(
    string Id,
    SourceLocation Source,
    string EntryId,
    string Language,
    string Kind,
    string Symbol,
    DefinitionIdentity Identity,
    DefinitionConstruction? Construction);

internal sealed record NativeCommand(string Executable, string[] Args, string Cwd);
internal sealed record Readiness(string State, string Description, string[] Evidence);
internal sealed record NativeTarget(string Runtime);
internal sealed record NativeDependency(string Path, string Kind);
internal sealed record NativeOutput(
    string[] Paths,
    NativeTarget Target,
    NativeDependency[]? Dependencies,
    string[] RuntimeRequirements);
internal sealed record WorkerProgram(
    string Id,
    string Name,
    string Language,
    string PackageId,
    SourceLocation Source,
    NativeCommand[] Build,
    NativeCommand Start,
    Readiness Readiness,
    NativeOutput? NativeOutput = null);

internal sealed record GeneratedArtifact(string Path, string Content, string Kind);
internal sealed record AnalysisResult(
    IReadOnlyList<Definition> Definitions,
    IReadOnlyList<AnalysisDiagnostic> Diagnostics,
    IReadOnlyList<WorkerProgram> Workers);
internal sealed record EmissionResult(
    IReadOnlyList<GeneratedArtifact> Artifacts,
    IEnumerable<AnalysisDiagnostic> Diagnostics);
internal sealed record AnalyzerOutput(AnalysisResult Analysis, EmissionResult Emission);

internal static class Protocol
{
    private static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        RespectRequiredConstructorParameters = true,
    };

    public static AnalysisInput Read(string path) =>
        JsonSerializer.Deserialize<AnalysisInput>(File.ReadAllText(path), Options)
        ?? throw new JsonException("Analysis input must be an object.");

    public static string Write(AnalyzerOutput output) => JsonSerializer.Serialize(output, Options);
}
