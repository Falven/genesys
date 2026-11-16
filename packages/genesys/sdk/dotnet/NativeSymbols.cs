using Microsoft.CodeAnalysis;

namespace Genesys.Analysis;

internal static class NativeSymbols
{
    public static AttributeData? Attribute(ISymbol symbol, string name) =>
        symbol.GetAttributes().FirstOrDefault(attribute => attribute.AttributeClass?.ToDisplayString() == name);

    public static string MetadataName(INamedTypeSymbol type)
    {
        if (type.ContainingType != null)
            return MetadataName(type.ContainingType) + "+" + type.MetadataName;
        var prefix = type.ContainingNamespace.IsGlobalNamespace
            ? ""
            : type.ContainingNamespace.ToDisplayString() + ".";
        return prefix + type.MetadataName;
    }

    private static bool IsTask(ITypeSymbol type)
    {
        for (var current = type as INamedTypeSymbol; current != null; current = current.BaseType)
        {
            if (current.ContainingNamespace.ToDisplayString() == "System.Threading.Tasks" && current.Name == "Task")
                return true;
        }
        return false;
    }

    public static IEnumerable<IMethodSymbol> Methods(INamedTypeSymbol type)
    {
        var hidden = new HashSet<string>(StringComparer.Ordinal);
        for (var current = type; current != null; current = current.BaseType)
        {
            foreach (var method in current.GetMembers().OfType<IMethodSymbol>())
            {
                var key = method.Name + "(" + string.Join(",", method.Parameters.Select(parameter => parameter.Type.ToDisplayString())) + ")";
                if (!hidden.Add(key))
                    continue;
                if (!SymbolEqualityComparer.Default.Equals(current, type)
                    && (method.DeclaredAccessibility == Accessibility.Private || method.IsStatic))
                    continue;
                yield return method;
            }
        }
    }

    public static bool HasOnlyStaticActivities(INamedTypeSymbol type) =>
        Methods(type).Where(method => Attribute(method, "Temporalio.Activities.ActivityAttribute") != null)
            .All(method => method.IsStatic);

    public static string ActivityName(IMethodSymbol method) =>
        IsTask(method.ReturnType) && method.Name.Length > 5 && method.Name.EndsWith("Async", StringComparison.Ordinal)
            ? method.Name[..^5]
            : method.Name;
}
