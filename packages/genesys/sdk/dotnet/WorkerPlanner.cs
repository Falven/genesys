using Microsoft.CodeAnalysis.CSharp;

namespace Genesys.Analysis;

internal static class WorkerPlanner
{
    public static IReadOnlyList<WorkerProgram> Create(
        AnalysisInput input, ProjectContext project, CSharpCompilation compilation,
        Diagnostics diagnostics, bool registrationHasErrors)
    {
        if (!project.Exists || project.Property("OutputType") is not ("Exe" or "WinExe"))
            return [];
        var entryPoint = compilation.GetEntryPoint(default);
        if (entryPoint == null)
        {
            diagnostics.Report("entrypoint-unresolved", "Roslyn could not resolve a unique native Main/top-level entrypoint. Build/start commands are withheld.", project.Path, true);
            return [];
        }
        if (diagnostics.HasErrors || registrationHasErrors)
            return [];
        var names = input.Entries.Where(entry => entry.Role == "worker")
            .Select(entry => entry.WorkerName).Where(name => name != null).Distinct().ToArray();
        if (names.Length > 1)
        {
            diagnostics.Report("entrypoint-name-ambiguous", "Several named Worker directories compile into one executable project. Native executable ownership is ambiguous; split native projects or preserve explicit launch.", project.Path, true);
            return [];
        }
        var assemblyName = project.Property("AssemblyName") is ""
            ? Path.GetFileNameWithoutExtension(project.Path)
            : project.Property("AssemblyName");
        if (assemblyName.IndexOfAny(['/', '\\', ':']) >= 0
            || project.Property("PublishAot") == "true" || project.Property("SelfContained") == "true")
        {
            diagnostics.Report("launch-unresolved", "Custom/native executable output requires explicit native launch; automatic launch handles framework-dependent .NET DLL output.", project.Path, true);
            return [];
        }
        var production = input.Mode == "production";
        var framework = project.Property("TargetFramework");
        var runtimeIdentifier = project.Property("RuntimeIdentifier");
        if (production)
        {
            var unsupportedSetting = new[] { "PublishAot", "SelfContained", "PublishSelfContained", "PublishSingleFile", "PublishTrimmed" }
                .FirstOrDefault(name => project.Property(name).Equals("true", StringComparison.OrdinalIgnoreCase));
            if (unsupportedSetting != null)
            {
                diagnostics.Report("publish-layout-unsupported", $"The project sets {unsupportedSetting}=true. Genesys production publishing supports framework-dependent DLL output. Use native publish for this layout.", project.Path, true);
                return [];
            }
            var hasExplicitDeploymentMode = project.Property("SelfContained") != ""
                || project.Property("PublishSelfContained") != "";
            var netVersion = framework.Split('-')[0];
            var legacyFramework = netVersion.StartsWith("netcoreapp", StringComparison.Ordinal)
                || (netVersion.StartsWith("net", StringComparison.Ordinal)
                    && Version.TryParse(netVersion[3..], out var version) && version.Major < 8);
            if (runtimeIdentifier != "" && legacyFramework && !hasExplicitDeploymentMode)
            {
                diagnostics.Report("publish-layout-unsupported", "This target framework can infer self-contained publish from RuntimeIdentifier. Set PublishSelfContained=false for framework-dependent output, or use native publish.", project.Path, true);
                return [];
            }
        }
        var source = entryPoint.Locations.FirstOrDefault(location => location.IsInSource)?.SourceTree?.FilePath ?? project.Path;
        var outputDirectory = ".gsys/dotnet/" + input.Suffix;
        var assemblyPath = outputDirectory + "/" + assemblyName;
        NativeOutput? nativeOutput = null;
        if (production)
        {
            var runtime = framework == "" ? ".NET" : framework;
            nativeOutput = new(
                [outputDirectory, assemblyPath + ".dll", assemblyPath + ".runtimeconfig.json"],
                new(runtimeIdentifier == "" ? runtime : $"{runtime} (RID {runtimeIdentifier})"),
                project.Property("GenerateDependencyFile").Equals("false", StringComparison.OrdinalIgnoreCase)
                    ? null
                    : [new(assemblyPath + ".deps.json", "dotnet-deps")],
                ["Install a compatible .NET runtime as specified in the published .runtimeconfig.json."]);
        }
        return [new(
            input.Package.Id + ":" + project.Path,
            names.FirstOrDefault() ?? Path.GetFileNameWithoutExtension(project.Path),
            "dotnet", input.Package.Id, new(source),
            [new("dotnet", ["publish", project.Path, "-c", "Release", "-o", outputDirectory], ".")],
            new("dotnet", [assemblyPath + ".dll"], "."),
            new("unavailable",
                "ExecuteAsync/startup is not polling evidence. Attribute native Worker heartbeats to this generation, then observe successful polling for every intended instance. Dynamic instance coverage and native connection settings remain unknown.",
                ["Temporal Worker heartbeat host/PID/start time", "instance-scoped last_successful_poll_time"]),
            nativeOutput)];
    }
}
