using System.Text.Json;
using System.Text.Json.Nodes;
using System.Xml.Linq;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.Operations;

var input = JsonNode.Parse(File.ReadAllText(args[0]))!.AsObject();
var sources = input["sources"]!.AsObject().ToDictionary(x => x.Key, x => x.Value!.GetValue<string>());
var package = input["package"]!;
var root = package["root"]!.GetValue<string>();
var packageId = package["id"]!.GetValue<string>();
var suffix = input["suffix"]!.GetValue<string>();
var entries = input["entries"]!.AsArray().ToDictionary(x => x!["path"]!.GetValue<string>(), x => x!);
var definitions = new List<object>();
var diagnostics = new List<object>();
var emissionDiagnostics = new List<object>();
var workers = new List<object>();
var artifacts = new List<object>();
var registration = new List<(string Kind, INamedTypeSymbol Type)>();
var identities = new List<(string Kind, string? Name, string Symbol, string Path, INamedTypeSymbol Type, bool Automatic)>();
var safe = true;
object Location(string path, SyntaxNode? node = null)
{
    var position = node?.GetLocation().GetLineSpan().StartLinePosition;
    return new { path, line = position?.Line + 1, column = position?.Character + 1 };
}
void Report(string code, string message, string path, bool error = false)
{
    diagnostics.Add(new { code = "dotnet." + code, severity = error ? "error" : "warning", message, source = Location(path) });
    if (error) safe = false;
}
bool Within(string path) => root == "." || path.StartsWith(root + "/", StringComparison.Ordinal);
string GeneratedPath(string name) => root == "." ? name : root + "/" + name;
var manifests = package["manifests"]!.AsArray().Select(x => x!.GetValue<string>()).ToArray();
var projectPath = manifests.Length == 1 ? manifests[0] : "";
XElement? project = null;
if (!projectPath.EndsWith(".csproj", StringComparison.Ordinal))
    Report("project-unresolved", "Automatic analysis requires one C# SDK project in this package. F#/VB and ambiguous project inclusion remain available through native assembly; this is a tooling limit.", root, true);
else
    project = XDocument.Parse(sources[projectPath]).Root!;
string Property(string name) => project?.Elements().Where(x => x.Name.LocalName == "PropertyGroup")
    .Elements().LastOrDefault(x => x.Name.LocalName == name)?.Value.Trim() ?? "";
if (project != null)
{
    if (project.Attribute("Sdk")?.Value is not ("Microsoft.NET.Sdk" or "Microsoft.NET.Sdk.Worker" or "Microsoft.NET.Sdk.Web"))
        Report("project-sdk", "The project SDK cannot be resolved statically; use explicit native assembly.", projectPath, true);
    if (project.Descendants().Any(x => x.Attribute("Condition") != null || x.Name.LocalName is "Import" or "Compile" or "ProjectReference") ||
        project.Descendants().Any(x => x.Value.Contains("$(", StringComparison.Ordinal)) ||
        Property("EnableDefaultCompileItems") == "false" || Property("EnableDefaultItems") == "false" ||
        Property("TargetFrameworks") != "")
        Report("project-evaluation-required", "Conditional/imported properties, custom source inclusion, project references, or multiple target frameworks require native MSBuild evaluation. Static analysis does not execute MSBuild hooks. Generated registration and launch are withheld; explicit native assembly remains valid.", projectPath, true);
    foreach (var path in sources.Keys.Where(x => x.EndsWith(".props", StringComparison.Ordinal) || x.EndsWith(".targets", StringComparison.Ordinal)))
        if ((path.EndsWith("Directory.Build.props", StringComparison.Ordinal) || path.EndsWith("Directory.Build.targets", StringComparison.Ordinal)) &&
            (Path.GetDirectoryName(path) is "" || root == Path.GetDirectoryName(path) || root.StartsWith(Path.GetDirectoryName(path) + "/", StringComparison.Ordinal)))
            Report("project-import-unresolved", $"Native inherited build settings in {path} require evaluation; static analysis does not execute them.", projectPath, true);
}
var sdkVersion = project?.Descendants().FirstOrDefault(x => x.Name.LocalName == "PackageReference" && x.Attribute("Include")?.Value == "Temporalio")?.Attribute("Version")?.Value;
if (sdkVersion != "1.22.0")
    Report("sdk-version", $"Registration APIs were checked against Temporalio 1.22.0. The project version is {sdkVersion ?? "unresolved"}; native build must establish compatibility.", projectPath.Length == 0 ? root : projectPath);
var hasHosting = project?.Descendants().Any(x => x.Name.LocalName == "PackageReference" && x.Attribute("Include")?.Value == "Temporalio.Extensions.Hosting") == true;
var symbols = Property("DefineConstants").Split(';', StringSplitOptions.RemoveEmptyEntries).Append("TRACE").ToList();
var framework = Property("TargetFramework");
if (framework.StartsWith("net", StringComparison.Ordinal) && Version.TryParse(framework[3..], out var frameworkVersion))
{
    symbols.Add("NET"); symbols.Add("NETCOREAPP"); symbols.Add($"NET{frameworkVersion.Major}_{frameworkVersion.Minor}");
    for (var major = 5; major <= frameworkVersion.Major; major++) symbols.Add($"NET{major}_0_OR_GREATER");
    foreach (var version in new[] { "1_0", "1_1", "2_0", "2_1", "2_2", "3_0", "3_1" }) symbols.Add("NETCOREAPP" + version + "_OR_GREATER");
}
var parseOptions = new CSharpParseOptions(LanguageVersion.Latest, preprocessorSymbols: symbols);
var trees = sources.Where(x => Within(x.Key) && x.Key.EndsWith(".cs", StringComparison.Ordinal) && !x.Key.EndsWith(".g.cs", StringComparison.Ordinal))
    .Select(x => CSharpSyntaxTree.ParseText(x.Value, parseOptions, x.Key)).ToList();
if (Property("ImplicitUsings") is "enable" or "true")
    trees.Add(CSharpSyntaxTree.ParseText("global using System; global using System.Collections.Generic; global using System.IO; global using System.Linq; global using System.Net.Http; global using System.Threading; global using System.Threading.Tasks;", parseOptions, "<native-implicit-usings>"));
var referencePaths = ((string)AppContext.GetData("TRUSTED_PLATFORM_ASSEMBLIES")!).Split(Path.PathSeparator)
    .Concat(Directory.GetFiles(AppContext.BaseDirectory, "*.dll")).Distinct(StringComparer.Ordinal);
var references = referencePaths.Select(x => MetadataReference.CreateFromFile(x));
var compilation = CSharpCompilation.Create("GenesysStaticAnalysis", trees, references,
    new CSharpCompilationOptions(OutputKind.ConsoleApplication, mainTypeName: Property("StartupObject") is "" ? null : Property("StartupObject")));
AttributeData? Attribute(ISymbol symbol, string name) => symbol.GetAttributes().FirstOrDefault(x => x.AttributeClass?.ToDisplayString() == name);
string MetadataName(INamedTypeSymbol type) => type.ContainingType != null ? MetadataName(type.ContainingType) + "+" + type.MetadataName :
    (type.ContainingNamespace.IsGlobalNamespace ? "" : type.ContainingNamespace.ToDisplayString() + ".") + type.MetadataName;
bool IsTask(ITypeSymbol type)
{
    for (var current = type as INamedTypeSymbol; current != null; current = current.BaseType)
        if (current.ContainingNamespace.ToDisplayString() == "System.Threading.Tasks" && current.Name == "Task") return true;
    return false;
}
IEnumerable<IMethodSymbol> Methods(INamedTypeSymbol type)
{
    var hidden = new HashSet<string>(StringComparer.Ordinal);
    for (var current = type; current != null; current = current.BaseType)
        foreach (var method in current.GetMembers().OfType<IMethodSymbol>())
        {
            var key = method.Name + "(" + string.Join(",", method.Parameters.Select(x => x.Type.ToDisplayString())) + ")";
            if (!hidden.Add(key)) continue;
            if (!SymbolEqualityComparer.Default.Equals(current, type) && (method.DeclaredAccessibility == Accessibility.Private || method.IsStatic)) continue;
            yield return method;
        }
}
void Define(string kind, ISymbol symbol, INamedTypeSymbol owner, AttributeData attribute, string path, JsonNode entry, SyntaxNode node, string defaultName)
{
    var dynamic = attribute.NamedArguments.Any(x => x.Key == "Dynamic" && Equals(x.Value.Value, true));
    var unresolved = attribute.ConstructorArguments.Any(x => x.Kind == TypedConstantKind.Error) || attribute.NamedArguments.Any(x => x.Value.Kind == TypedConstantKind.Error);
    var name = attribute.ConstructorArguments.FirstOrDefault().Value as string ?? defaultName;
    if (symbol is IMethodSymbol { MethodKind: MethodKind.AnonymousFunction } && attribute.ConstructorArguments.FirstOrDefault().Value == null && !dynamic)
    {
        unresolved = true;
        Report("lambda-name-required", "The native SDK requires an explicit Activity name on a non-dynamic lambda.", path, true);
    }
    if (kind == "nexus")
    {
        var contract = attribute.ConstructorArguments.FirstOrDefault().Value as INamedTypeSymbol;
        var service = contract == null ? null : Attribute(contract, "NexusRpc.NexusServiceAttribute");
        if (service == null) unresolved = true;
        else
        {
            var explicitName = service.NamedArguments.FirstOrDefault(x => x.Key == "Name").Value.Value as string;
            name = explicitName ?? service.ConstructorArguments.FirstOrDefault().Value as string ?? contract!.Name;
            if (explicitName == null && service.ConstructorArguments.FirstOrDefault().Value == null && name.Length > 1 && name[0] == 'I' && char.IsUpper(name[1])) name = name[1..];
        }
    }
    var display = symbol.ToDisplayString();
    var state = unresolved ? "unresolved" : dynamic ? "dynamic" : "resolved";
    definitions.Add(new
    {
        id = packageId + ":" + kind + ":" + MetadataName(owner) + ":" + display + ":" + node.SpanStart,
        source = Location(path, node),
        entryId = entry["id"]!.GetValue<string>(),
        language = "dotnet",
        kind,
        symbol = display,
        identity = new
        {
            name = state == "resolved" ? name : null,
            state,
            reason = unresolved ? "Attribute constant or Nexus service contract cannot be bound statically." : dynamic ? "Native dynamic catch-all definition." : null
        },
        construction = kind == "activity" && !symbol.IsStatic || kind == "nexus" ? new { symbol = owner.ToDisplayString(), reason = "Application-owned instance or native dependency injection registration is required." } : null,
    });
    if (unresolved) Report("identity-unresolved", $"Cannot bind native identity for {display}; preserve explicit native assembly.", path, true);
    identities.Add((kind, state == "resolved" ? name : state == "dynamic" ? "<dynamic>" : null, display, path, owner,
        symbol is not IMethodSymbol method || method.MethodKind == MethodKind.Ordinary));
}
var seen = new HashSet<string>(StringComparer.Ordinal);
foreach (var tree in trees)
{
    if (!entries.TryGetValue(tree.FilePath, out var entry) || entry["role"]!.GetValue<string>() == "worker") continue;
    foreach (var error in tree.GetDiagnostics().Where(x => x.Severity == DiagnosticSeverity.Error))
        Report("syntax", error.ToString(), tree.FilePath, true);
    var model = compilation.GetSemanticModel(tree);
    foreach (var declaration in tree.GetRoot().DescendantNodes().OfType<TypeDeclarationSyntax>())
    {
        if (model.GetDeclaredSymbol(declaration) is not INamedTypeSymbol type) continue;
        var role = entry["role"]!.GetValue<string>();
        if (!seen.Add(role + ":" + MetadataName(type))) continue;
        var workflow = Attribute(type, "Temporalio.Workflows.WorkflowAttribute");
        var nexus = Attribute(type, "NexusRpc.Handlers.NexusServiceHandlerAttribute");
        var activities = Methods(type).Where(x => Attribute(x, "Temporalio.Activities.ActivityAttribute") != null).ToArray();
        if ((role == "workflow" && workflow != null) || (role == "activity" && activities.Length > 0) || (role == "nexus" && nexus != null))
        {
            if (type.IsGenericType || (type.IsAbstract && !type.IsStatic) || type.TypeKind == TypeKind.Interface)
            {
                Report("contract-or-open-type", $"{type} is a contract, abstract type, or open generic type. It is not automatically registered; concrete native implementations remain available.", tree.FilePath);
                continue;
            }
            registration.Add((role, type));
            if (role == "workflow") Define(role, type, type, workflow!, tree.FilePath, entry, declaration, type.Name);
            if (role == "nexus") Define(role, type, type, nexus!, tree.FilePath, entry, declaration, type.Name);
            if (role == "activity")
                foreach (var method in activities)
                {
                    var node = method.DeclaringSyntaxReferences.FirstOrDefault()?.GetSyntax() ?? declaration;
                    var methodPath = node.SyntaxTree.FilePath;
                    var name = IsTask(method.ReturnType) && method.Name.Length > 5 && method.Name.EndsWith("Async", StringComparison.Ordinal) ? method.Name[..^5] : method.Name;
                    Define(role, method, type, Attribute(method, "Temporalio.Activities.ActivityAttribute")!, methodPath, entry, node, name);
                }
        }
        foreach (var attribute in declaration.DescendantNodes().OfType<AttributeSyntax>())
            if (model.GetSymbolInfo(attribute).Symbol == null)
                Report("attribute-unresolved", $"Attribute {attribute.Name} could not be bound. Application dependencies, generators, or native build settings may be required; no authored assemblies are loaded.", tree.FilePath, true);
    }
    if (entry["role"]!.GetValue<string>() == "activity")
        foreach (var node in tree.GetRoot().DescendantNodes().Where(x => x is LocalFunctionStatementSyntax or LambdaExpressionSyntax))
        {
            var method = node is LocalFunctionStatementSyntax local ? model.GetDeclaredSymbol(local) : (model.GetOperation(node) as IAnonymousFunctionOperation)?.Symbol;
            var attribute = method == null ? null : Attribute(method, "Temporalio.Activities.ActivityAttribute");
            if (attribute == null || method?.ContainingType == null) continue;
            var name = IsTask(method.ReturnType) && method.Name.Length > 5 && method.Name.EndsWith("Async", StringComparison.Ordinal) ? method.Name[..^5] : method.Name;
            Define("activity", method, method.ContainingType, attribute, tree.FilePath, entry, node, name);
            Report("delegate-assembly", "Attributed local functions and lambdas retain authored delegate registration; generated type registration cannot capture their lexical state.", tree.FilePath);
        }
}
foreach (var tree in trees)
{
    var model = compilation.GetSemanticModel(tree);
    foreach (var invocation in tree.GetRoot().DescendantNodes().OfType<InvocationExpressionSyntax>())
    {
        if (model.GetOperation(invocation) is not IInvocationOperation operation) continue;
        var owner = operation.TargetMethod.ContainingType.ToDisplayString();
        if (owner == "Temporalio.Workflows.WorkflowDefinition" && operation.TargetMethod.Name == "Create" && operation.Arguments.Length == 3)
        {
            var typeArgument = operation.Arguments.FirstOrDefault(x => x.Parameter?.Name == "type")?.Value as ITypeOfOperation;
            if (typeArgument?.TypeOperand is INamedTypeSymbol type)
            {
                registration.RemoveAll(x => x.Kind == "workflow" && SymbolEqualityComparer.Default.Equals(x.Type, type));
                Report("explicit-workflow-factory", $"{type} has an authored WorkflowDefinition.Create override. Its attribute identity is only the declaration default; registration identities/scopes and creator overrides remain in native assembly. It is excluded from generated registration.", tree.FilePath);
            }
            else Report("explicit-workflow-factory-unresolved", "A native WorkflowDefinition.Create override has an unresolved type. Generated registration is withheld to preserve its factory and naming semantics.", tree.FilePath, true);
        }
        if (owner == "Temporalio.Activities.ActivityDefinition" && operation.TargetMethod.Name is "Create" or "CreateWithoutAttribute")
            Report("explicit-activity-definition", "Explicit native ActivityDefinition construction remains authored; its invoker, name overrides, and registration scope are not replaced by generated type registration.", tree.FilePath);
    }
}
foreach (var collision in identities.Where(x => x.Name != null && x.Automatic && registration.Any(r => r.Kind == x.Kind && SymbolEqualityComparer.Default.Equals(r.Type, x.Type))).GroupBy(x => (x.Kind, x.Name)).Where(x => x.Count() > 1))
{
    var combined = hasHosting || collision.Key.Kind == "workflow" || (collision.Key.Kind == "activity" && collision.All(x => Methods(x.Type).Where(m => Attribute(m, "Temporalio.Activities.ActivityAttribute") != null).All(m => m.IsStatic)));
    emissionDiagnostics.Add(new
    {
        code = "dotnet.generated-registration-collision",
        severity = combined ? "error" : "warning",
        source = Location(collision.First().Path),
        message = $"Combining these definitions in one native Worker would register {collision.Key.Kind} '{collision.Key.Name}' more than once. Explicit separate native Worker scopes remain valid: {string.Join(", ", collision.Select(x => x.Symbol))}."
    });
    if (combined) safe = false;
}
var entryPoint = compilation.GetEntryPoint(default);
if (project != null && Property("OutputType") is "Exe" or "WinExe")
{
    if (entryPoint == null)
        Report("entrypoint-unresolved", "Roslyn could not resolve a unique native Main/top-level entrypoint. Build/start commands are withheld.", projectPath, true);
    else if (safe)
    {
        var source = entryPoint.Locations.FirstOrDefault(x => x.IsInSource)?.SourceTree?.FilePath ?? projectPath;
        var names = entries.Values.Where(x => x["role"]!.GetValue<string>() == "worker").Select(x => x["workerName"]?.GetValue<string>()).Where(x => x != null).Distinct().ToArray();
        if (names.Length > 1)
            Report("entrypoint-name-ambiguous", "Several named Worker directories compile into one executable project. Native executable ownership is ambiguous; split native projects or preserve explicit launch.", projectPath, true);
        else
        {
            var assemblyName = Property("AssemblyName") is "" ? Path.GetFileNameWithoutExtension(projectPath) : Property("AssemblyName");
            if (assemblyName.IndexOfAny(new[] { '/', '\\', ':' }) >= 0 || Property("PublishAot") == "true" || Property("SelfContained") == "true")
                Report("launch-unresolved", "Custom/native executable output requires explicit native launch; automatic launch handles framework-dependent .NET DLL output.", projectPath, true);
            else workers.Add(new
            {
                id = packageId + ":" + projectPath,
                name = names.FirstOrDefault() ?? Path.GetFileNameWithoutExtension(projectPath),
                language = "dotnet",
                packageId,
                source = Location(source),
                build = new[] { new { executable = "dotnet", args = new[] { "publish", projectPath, "-c", "Release", "-o", ".gsys/dotnet/" + suffix }, cwd = "." } },
                start = new { executable = "dotnet", args = new[] { ".gsys/dotnet/" + suffix + "/" + assemblyName + ".dll" }, cwd = "." },
                readiness = new { state = "unavailable", description = "ExecuteAsync/startup is not polling evidence. Attribute native Worker heartbeats to this generation, then observe successful polling for every intended instance. Dynamic instance coverage and native connection settings remain unknown.", evidence = new[] { "Temporal Worker heartbeat host/PID/start time", "instance-scoped last_successful_poll_time" } },
            });
        }
    }
}
if (safe && registration.Count > 0)
{
    var code = new System.Text.StringBuilder("// Generated by Genesys. Native SDK validation and application construction remain authoritative.\n#nullable enable\nnamespace Genesys.Generated\n{\n    public static class Registration_" + suffix + "\n    {\n");
    string TypeExpression(INamedTypeSymbol type) => "typeof(Registration_" + suffix + ").Assembly.GetType(" + JsonSerializer.Serialize(MetadataName(type)) + ", throwOnError: true)!";
    if (hasHosting)
    {
        code.Append("        public static global::Temporalio.Extensions.Hosting.ITemporalWorkerServiceOptionsBuilder AddGenesys(this global::Temporalio.Extensions.Hosting.ITemporalWorkerServiceOptionsBuilder builder)\n        {\n");
        foreach (var (kind, type) in registration)
        {
            var method = kind == "workflow" ? "AddWorkflow" : kind == "activity" ? "ApplyTemporalActivities" : "ApplyNexusService";
            code.Append("            global::Temporalio.Extensions.Hosting.TemporalWorkerServiceOptionsBuilderExtensions.").Append(method).Append("(builder, ").Append(TypeExpression(type)).Append(");\n");
        }
        code.Append("            return builder;\n        }\n");
    }
    {
        code.Append("        public static global::Temporalio.Worker.TemporalWorkerOptions AddGenesysWorkflows(this global::Temporalio.Worker.TemporalWorkerOptions options)\n        {\n");
        foreach (var (_, type) in registration.Where(x => x.Kind == "workflow")) code.Append("            options.AddWorkflow(").Append(TypeExpression(type)).Append(");\n");
        code.Append("            return options;\n        }\n");
        var staticTypes = registration.Where(x => x.Kind == "activity" && Methods(x.Type).Where(m => Attribute(m, "Temporalio.Activities.ActivityAttribute") != null).All(m => m.IsStatic)).ToArray();
        code.Append("        public static global::Temporalio.Worker.TemporalWorkerOptions AddGenesysStaticActivities(this global::Temporalio.Worker.TemporalWorkerOptions options)\n        {\n");
        foreach (var (_, type) in staticTypes) code.Append("            options.AddAllActivities(").Append(TypeExpression(type)).Append(", null);\n");
        code.Append("            return options;\n        }\n");
        foreach (var kind in new[] { "activity", "nexus" })
        {
            var methodName = kind == "activity" ? "AddGenesysActivities" : "AddGenesysNexus";
            code.Append("        public static global::Temporalio.Worker.TemporalWorkerOptions ").Append(methodName).Append("(this global::Temporalio.Worker.TemporalWorkerOptions options, object instance)\n        {\n");
            foreach (var (_, type) in registration.Where(x => x.Kind == kind && !staticTypes.Any(y => SymbolEqualityComparer.Default.Equals(y.Type, x.Type))))
            {
                code.Append("            if (instance.GetType() == ").Append(TypeExpression(type)).Append(")\n                return options.");
                if (kind == "activity") code.Append("AddAllActivities(").Append(TypeExpression(type)).Append(", instance);\n");
                else code.Append("AddNexusService(instance);\n");
            }
            code.Append("            throw new global::System.ArgumentException(\"Instance type is not a discovered ").Append(kind).Append(" type. Preserve explicit native registration for other types.\", nameof(instance));\n        }\n");
        }
    }
    code.Append("    }\n}\n");
    artifacts.Add(new { path = GeneratedPath("GenesysRegistration.g.cs"), content = code.ToString(), kind = "registration" });
}
Console.Write(JsonSerializer.Serialize(new { analysis = new { definitions, diagnostics, workers }, emission = new { artifacts, diagnostics = diagnostics.Concat(emissionDiagnostics) } }, new JsonSerializerOptions { DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull }));
