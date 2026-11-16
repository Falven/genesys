using Microsoft.CodeAnalysis;
using static Genesys.Analysis.NativeSymbols;

namespace Genesys.Analysis;

internal sealed record RegistrationPlan(IReadOnlyList<Registration> Registrations, Diagnostics Diagnostics)
{
    public static RegistrationPlan Create(DefinitionAnalysis analysis, ProjectContext project)
    {
        var diagnostics = new Diagnostics();
        var collisions = analysis.Identities
            .Where(identity => identity.Name != null && identity.Automatic
                && analysis.Registrations.Any(registration => registration.Kind == identity.Kind
                    && SymbolEqualityComparer.Default.Equals(registration.Type, identity.Type)))
            .GroupBy(identity => (identity.Kind, identity.Name))
            .Where(group => group.Count() > 1);
        foreach (var collision in collisions)
        {
            var combined = project.HasHosting || collision.Key.Kind == "workflow"
                || (collision.Key.Kind == "activity" && collision.All(identity => HasOnlyStaticActivities(identity.Type)));
            diagnostics.Add(new(
                "dotnet.generated-registration-collision",
                combined ? "error" : "warning",
                $"Combining these definitions in one native Worker would register {collision.Key.Kind} '{collision.Key.Name}' more than once. Explicit separate native Worker scopes remain valid: {string.Join(", ", collision.Select(identity => identity.Symbol))}.",
                new(collision.First().Path)));
        }
        return new(analysis.Registrations, diagnostics);
    }
}
