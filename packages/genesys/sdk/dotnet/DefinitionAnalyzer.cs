using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.CodeAnalysis.CSharp.Syntax;
using Microsoft.CodeAnalysis.Operations;
using static Genesys.Analysis.NativeSymbols;

namespace Genesys.Analysis;

internal sealed record Registration(string Kind, INamedTypeSymbol Type);
internal sealed record RegistrationIdentity(
    string Kind, string? Name, string Symbol, string Path, INamedTypeSymbol Type, bool Automatic);
internal sealed record DefinitionAnalysis(
    IReadOnlyList<Definition> Definitions,
    IReadOnlyList<Registration> Registrations,
    IReadOnlyList<RegistrationIdentity> Identities);

internal sealed class DefinitionAnalyzer(
    AnalysisInput input,
    CSharpCompilation compilation,
    Diagnostics diagnostics)
{
    private readonly List<Definition> definitions = [];
    private readonly List<Registration> registrations = [];
    private readonly List<RegistrationIdentity> identities = [];
    private readonly HashSet<string> seenTypes = new(StringComparer.Ordinal);

    public DefinitionAnalysis Analyze()
    {
        var entries = input.Entries.ToDictionary(entry => entry.Path);
        foreach (var tree in compilation.SyntaxTrees)
        {
            if (entries.TryGetValue(tree.FilePath, out var entry) && entry.Role != "worker")
                AnalyzeTree(tree, entry);
        }
        foreach (var tree in compilation.SyntaxTrees)
            PreserveAuthoredRegistration(tree);
        return new(definitions, registrations, identities);
    }

    private void AnalyzeTree(SyntaxTree tree, SourceEntry entry)
    {
        foreach (var error in tree.GetDiagnostics().Where(item => item.Severity == DiagnosticSeverity.Error))
            diagnostics.Report("syntax", error.ToString(), tree.FilePath, true);

        var model = compilation.GetSemanticModel(tree);
        foreach (var declaration in tree.GetRoot().DescendantNodes().OfType<TypeDeclarationSyntax>())
            AnalyzeType(declaration, model, entry);
        if (entry.Role == "activity")
            AnalyzeDelegates(tree, model, entry);
    }

    private void AnalyzeType(TypeDeclarationSyntax declaration, SemanticModel model, SourceEntry entry)
    {
        if (model.GetDeclaredSymbol(declaration) is not INamedTypeSymbol type)
            return;
        var role = entry.Role;
        if (!seenTypes.Add(role + ":" + MetadataName(type)))
            return;
        var path = declaration.SyntaxTree.FilePath;
        var workflow = Attribute(type, "Temporalio.Workflows.WorkflowAttribute");
        var nexus = Attribute(type, "NexusRpc.Handlers.NexusServiceHandlerAttribute");
        var activities = Methods(type)
            .Where(method => Attribute(method, "Temporalio.Activities.ActivityAttribute") != null)
            .ToArray();
        var recognized = (role == "workflow" && workflow != null)
            || (role == "activity" && activities.Length > 0)
            || (role == "nexus" && nexus != null);
        if (recognized)
        {
            if (type.IsGenericType || (type.IsAbstract && !type.IsStatic) || type.TypeKind == TypeKind.Interface)
            {
                diagnostics.Report("contract-or-open-type", $"{type} is a contract, abstract type, or open generic type. It is not automatically registered; concrete native implementations remain available.", path);
                return;
            }
            registrations.Add(new(role, type));
            if (role == "workflow")
                Define(role, type, type, workflow!, path, entry, declaration, type.Name);
            if (role == "nexus")
                Define(role, type, type, nexus!, path, entry, declaration, type.Name);
            if (role == "activity")
            {
                foreach (var method in activities)
                {
                    var node = method.DeclaringSyntaxReferences.FirstOrDefault()?.GetSyntax() ?? declaration;
                    Define(role, method, type, Attribute(method, "Temporalio.Activities.ActivityAttribute")!,
                        node.SyntaxTree.FilePath, entry, node, ActivityName(method));
                }
            }
        }
        foreach (var attribute in declaration.DescendantNodes().OfType<AttributeSyntax>())
        {
            if (model.GetSymbolInfo(attribute).Symbol == null)
                diagnostics.Report("attribute-unresolved", $"Attribute {attribute.Name} could not be bound. Application dependencies, generators, or native build settings may be required; no authored assemblies are loaded.", path, true);
        }
    }

    private void AnalyzeDelegates(SyntaxTree tree, SemanticModel model, SourceEntry entry)
    {
        var nodes = tree.GetRoot().DescendantNodes()
            .Where(node => node is LocalFunctionStatementSyntax or LambdaExpressionSyntax);
        foreach (var node in nodes)
        {
            var method = node is LocalFunctionStatementSyntax local
                ? model.GetDeclaredSymbol(local)
                : (model.GetOperation(node) as IAnonymousFunctionOperation)?.Symbol;
            var attribute = method == null ? null : Attribute(method, "Temporalio.Activities.ActivityAttribute");
            if (attribute == null || method?.ContainingType == null)
                continue;
            Define("activity", method, method.ContainingType, attribute, tree.FilePath, entry, node, ActivityName(method));
            diagnostics.Report("delegate-assembly", "Attributed local functions and lambdas retain authored delegate registration; generated type registration cannot capture their lexical state.", tree.FilePath);
        }
    }

    private void Define(
        string kind, ISymbol symbol, INamedTypeSymbol owner, AttributeData attribute,
        string path, SourceEntry entry, SyntaxNode node, string defaultName)
    {
        var identity = ResolveIdentity(kind, symbol, attribute, path, defaultName);
        var display = symbol.ToDisplayString();
        var construction = (kind == "activity" && !symbol.IsStatic) || kind == "nexus"
            ? new DefinitionConstruction(owner.ToDisplayString(), "Application-owned instance or native dependency injection registration is required.")
            : null;
        definitions.Add(new(
            input.Package.Id + ":" + kind + ":" + MetadataName(owner) + ":" + display + ":" + node.SpanStart,
            SourceLocation.From(path, node), entry.Id, "dotnet", kind, display, identity, construction));
        if (identity.State == "unresolved")
            diagnostics.Report("identity-unresolved", $"Cannot bind native identity for {display}; preserve explicit native assembly.", path, true);
        var collisionName = identity.State == "dynamic" ? "<dynamic>" : identity.Name;
        identities.Add(new(kind, collisionName, display, path, owner,
            symbol is not IMethodSymbol method || method.MethodKind == MethodKind.Ordinary));
    }

    private DefinitionIdentity ResolveIdentity(
        string kind, ISymbol symbol, AttributeData attribute, string path, string defaultName)
    {
        var dynamic = attribute.NamedArguments.Any(argument => argument.Key == "Dynamic" && Equals(argument.Value.Value, true));
        var unresolved = attribute.ConstructorArguments.Any(argument => argument.Kind == TypedConstantKind.Error)
            || attribute.NamedArguments.Any(argument => argument.Value.Kind == TypedConstantKind.Error);
        var name = attribute.ConstructorArguments.FirstOrDefault().Value as string ?? defaultName;
        if (symbol is IMethodSymbol { MethodKind: MethodKind.AnonymousFunction }
            && attribute.ConstructorArguments.FirstOrDefault().Value == null && !dynamic)
        {
            unresolved = true;
            diagnostics.Report("lambda-name-required", "The native SDK requires an explicit Activity name on a non-dynamic lambda.", path, true);
        }
        if (kind == "nexus")
        {
            var contract = attribute.ConstructorArguments.FirstOrDefault().Value as INamedTypeSymbol;
            var service = contract == null ? null : Attribute(contract, "NexusRpc.NexusServiceAttribute");
            if (service == null)
                unresolved = true;
            else
            {
                var explicitName = service.NamedArguments.FirstOrDefault(argument => argument.Key == "Name").Value.Value as string;
                name = explicitName ?? service.ConstructorArguments.FirstOrDefault().Value as string ?? contract!.Name;
                if (explicitName == null && service.ConstructorArguments.FirstOrDefault().Value == null
                    && name.Length > 1 && name[0] == 'I' && char.IsUpper(name[1]))
                    name = name[1..];
            }
        }
        return unresolved
            ? new(null, "unresolved", "Attribute constant or Nexus service contract cannot be bound statically.")
            : dynamic
                ? new(null, "dynamic", "Native dynamic catch-all definition.")
                : new(name, "resolved", null);
    }

    private void PreserveAuthoredRegistration(SyntaxTree tree)
    {
        var model = compilation.GetSemanticModel(tree);
        foreach (var invocation in tree.GetRoot().DescendantNodes().OfType<InvocationExpressionSyntax>())
        {
            if (model.GetOperation(invocation) is not IInvocationOperation operation)
                continue;
            var owner = operation.TargetMethod.ContainingType.ToDisplayString();
            if (owner == "Temporalio.Workflows.WorkflowDefinition"
                && operation.TargetMethod.Name == "Create" && operation.Arguments.Length == 3)
            {
                var typeArgument = operation.Arguments.FirstOrDefault(argument => argument.Parameter?.Name == "type")?.Value as ITypeOfOperation;
                if (typeArgument?.TypeOperand is INamedTypeSymbol type)
                {
                    registrations.RemoveAll(item => item.Kind == "workflow" && SymbolEqualityComparer.Default.Equals(item.Type, type));
                    diagnostics.Report("explicit-workflow-factory", $"{type} has an authored WorkflowDefinition.Create override. Its attribute identity is only the declaration default; registration identities/scopes and creator overrides remain in native assembly. It is excluded from generated registration.", tree.FilePath);
                }
                else
                    diagnostics.Report("explicit-workflow-factory-unresolved", "A native WorkflowDefinition.Create override has an unresolved type. Generated registration is withheld to preserve its factory and naming semantics.", tree.FilePath, true);
            }
            if (owner == "Temporalio.Activities.ActivityDefinition"
                && operation.TargetMethod.Name is "Create" or "CreateWithoutAttribute")
                diagnostics.Report("explicit-activity-definition", "Explicit native ActivityDefinition construction remains authored; its invoker, name overrides, and registration scope are not replaced by generated type registration.", tree.FilePath);
        }
    }
}
