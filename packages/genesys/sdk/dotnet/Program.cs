using Genesys.Analysis;

var input = Protocol.Read(args[0]);
var diagnostics = new Diagnostics();
var project = ProjectContext.Inspect(input, diagnostics);
var compilation = SourceCompilation.Create(input, project);
var definitions = new DefinitionAnalyzer(input, compilation, diagnostics).Analyze();
var registration = RegistrationPlan.Create(definitions, project);
var workers = WorkerPlanner.Create(input, project, compilation, diagnostics, registration.Diagnostics.HasErrors);
var artifacts = diagnostics.HasErrors || registration.Diagnostics.HasErrors
    ? []
    : RegistrationEmitter.Emit(input, project, registration);
var output = new AnalyzerOutput(
    new(definitions.Definitions, diagnostics.Items, workers),
    new(artifacts, diagnostics.Items.Concat(registration.Diagnostics.Items)));
Console.Write(Protocol.Write(output));
