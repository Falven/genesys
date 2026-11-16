using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;

namespace Genesys.Analysis;

internal static class SourceCompilation
{
    public static CSharpCompilation Create(AnalysisInput input, ProjectContext project)
    {
        var parseOptions = new CSharpParseOptions(LanguageVersion.Latest, preprocessorSymbols: DefinedSymbols(project));
        var sources = input.Sources.Where(source =>
            (input.Package.Root == "." || source.Key.StartsWith(input.Package.Root + "/", StringComparison.Ordinal))
            && source.Key.EndsWith(".cs", StringComparison.Ordinal)
            && !source.Key.EndsWith(".g.cs", StringComparison.Ordinal));
        var trees = sources.Select(source => CSharpSyntaxTree.ParseText(source.Value, parseOptions, source.Key)).ToList();
        if (project.Property("ImplicitUsings") is "enable" or "true")
        {
            const string implicitUsings = "global using System; global using System.Collections.Generic; global using System.IO; global using System.Linq; global using System.Net.Http; global using System.Threading; global using System.Threading.Tasks;";
            trees.Add(CSharpSyntaxTree.ParseText(implicitUsings, parseOptions, "<native-implicit-usings>"));
        }
        var referencePaths = ((string)AppContext.GetData("TRUSTED_PLATFORM_ASSEMBLIES")!).Split(Path.PathSeparator)
            .Concat(Directory.GetFiles(AppContext.BaseDirectory, "*.dll"))
            .Distinct(StringComparer.Ordinal);
        var references = referencePaths.Select(path => MetadataReference.CreateFromFile(path));
        var startupObject = project.Property("StartupObject");
        var options = new CSharpCompilationOptions(OutputKind.ConsoleApplication,
            mainTypeName: startupObject == "" ? null : startupObject);
        return CSharpCompilation.Create("GenesysStaticAnalysis", trees, references, options);
    }

    private static IEnumerable<string> DefinedSymbols(ProjectContext project)
    {
        var symbols = project.Property("DefineConstants")
            .Split(';', StringSplitOptions.RemoveEmptyEntries).Append("TRACE").ToList();
        var framework = project.Property("TargetFramework");
        if (!framework.StartsWith("net", StringComparison.Ordinal)
            || !Version.TryParse(framework[3..], out var version))
            return symbols;
        symbols.Add("NET");
        symbols.Add("NETCOREAPP");
        symbols.Add($"NET{version.Major}_{version.Minor}");
        for (var major = 5; major <= version.Major; major++)
            symbols.Add($"NET{major}_0_OR_GREATER");
        foreach (var coreVersion in new[] { "1_0", "1_1", "2_0", "2_1", "2_2", "3_0", "3_1" })
            symbols.Add("NETCOREAPP" + coreVersion + "_OR_GREATER");
        return symbols;
    }
}
