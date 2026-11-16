using System.Xml.Linq;

namespace Genesys.Analysis;

internal sealed class ProjectContext(string path, XElement? project)
{
    public string Path { get; } = path;
    public bool Exists => project != null;
    public bool HasHosting => project?.Descendants().Any(element =>
        element.Name.LocalName == "PackageReference" &&
        element.Attribute("Include")?.Value == "Temporalio.Extensions.Hosting") == true;

    public string Property(string name) => project?.Elements()
        .Where(element => element.Name.LocalName == "PropertyGroup")
        .Elements()
        .LastOrDefault(element => element.Name.LocalName == name)?.Value.Trim() ?? "";

    public static ProjectContext Inspect(AnalysisInput input, Diagnostics diagnostics)
    {
        var manifests = input.Package.Manifests;
        var projectPath = manifests.Length == 1 ? manifests[0] : "";
        XElement? project = null;
        if (!projectPath.EndsWith(".csproj", StringComparison.Ordinal))
            diagnostics.Report("project-unresolved", "Automatic analysis requires one C# SDK project in this package. F#/VB and ambiguous project inclusion remain available through native assembly; this is a tooling limit.", input.Package.Root, true);
        else
            project = XDocument.Parse(input.Sources[projectPath]).Root!;
        var context = new ProjectContext(projectPath, project);
        if (project != null)
        {
            if (project.Attribute("Sdk")?.Value is not ("Microsoft.NET.Sdk" or "Microsoft.NET.Sdk.Worker" or "Microsoft.NET.Sdk.Web"))
                diagnostics.Report("project-sdk", "The project SDK cannot be resolved statically; use explicit native assembly.", projectPath, true);
            if (project.Descendants().Any(element => element.Attribute("Condition") != null
                    || element.Name.LocalName is "Import" or "Compile" or "ProjectReference")
                || project.Descendants().Any(element => element.Value.Contains("$(", StringComparison.Ordinal))
                || context.Property("EnableDefaultCompileItems") == "false"
                || context.Property("EnableDefaultItems") == "false"
                || context.Property("TargetFrameworks") != "")
                diagnostics.Report("project-evaluation-required", "Conditional/imported properties, custom source inclusion, project references, or multiple target frameworks require native MSBuild evaluation. Static analysis does not execute MSBuild hooks. Generated registration and launch are withheld; explicit native assembly remains valid.", projectPath, true);
            foreach (var path in input.Sources.Keys)
            {
                var buildSettings = path.EndsWith("Directory.Build.props", StringComparison.Ordinal)
                    || path.EndsWith("Directory.Build.targets", StringComparison.Ordinal);
                var directory = System.IO.Path.GetDirectoryName(path);
                var inherited = directory is "" || input.Package.Root == directory
                    || input.Package.Root.StartsWith(directory + "/", StringComparison.Ordinal);
                if (buildSettings && inherited)
                    diagnostics.Report("project-import-unresolved", $"Native inherited build settings in {path} require evaluation; static analysis does not execute them.", projectPath, true);
            }
        }
        var sdkVersion = project?.Descendants().FirstOrDefault(element => element.Name.LocalName == "PackageReference"
            && element.Attribute("Include")?.Value == "Temporalio")?.Attribute("Version")?.Value;
        if (sdkVersion != "1.22.0")
            diagnostics.Report("sdk-version", $"Registration APIs were checked against Temporalio 1.22.0. The project version is {sdkVersion ?? "unresolved"}; native build must establish compatibility.", projectPath.Length == 0 ? input.Package.Root : projectPath);
        return context;
    }
}
