# Ruby native registration

Genesys parses Ruby with the standard-library Ripper parser. Discovery sends source text to the packaged parser over stdin. It does not require project files, evaluate Gemfiles, load gems, call factories, or instantiate definitions. `RUBYOPT` and `RUBYLIB` are removed from the parser environment. Use the application's Ruby runtime on `PATH`; syntax newer than that runtime produces a source-linked error.

The inspected release is [temporalio 1.11.0](https://github.com/temporalio/sdk-ruby/releases/tag/v1.11.0), which requires Ruby 3.3 or newer. Registration uses these released APIs:

- [Workflow::Definition](https://github.com/temporalio/sdk-ruby/blob/v1.11.0/temporalio/lib/temporalio/workflow/definition.rb): subclass registration, `workflow_name`, `workflow_dynamic`, and native Workflow initialization and handlers.
- [Activity::Definition](https://github.com/temporalio/sdk-ruby/blob/v1.11.0/temporalio/lib/temporalio/activity/definition.rb): classes, existing instances, and `Definition::Info` objects with application-owned blocks and factories.
- [Worker](https://github.com/temporalio/sdk-ruby/blob/v1.11.0/temporalio/lib/temporalio/worker.rb): `workflows:` and `activities:` arrays, `run`, and `run_all`. This release sets `enable_nexus: false` and has no Nexus service registration parameter. A Nexus entry receives an SDK capability diagnostic; Genesys does not synthesize a service handler.

Multiple classes per file are supported. Names use the native unqualified class name unless a literal String or Symbol override is present. Native dynamic definitions remain nameless. A computed or escaped name, conditional configuration, or reopened class has an unresolved identity. Signals, Queries, Updates, validators, and ordinary methods stay on their Workflow class. The generator does not rewrite method visibility or Workflow state.

Static inheritance follows package-local subclasses and direct superclass aliases. Nested Gemfile/gemspec packages have independent indexes. Literal `require_relative` imports can include referenced source across a package boundary; imported definitions do not become registration entries in the consuming package. Computed relative imports and load-path-dependent external `require` resolution remain static tooling limits. Runtime metaprogramming, external inheritance, conditional declarations, private constants, and ambiguous construction keep explicit native assembly and diagnostics. Inspection cannot prove every mutation of a Ruby class or module. Native SDK validation remains authoritative.

## Generated inputs

Each package receives `.gsys/ruby/registration.rb`, one registration file per definition source, and `.gsys/ruby/manifest.json`. The manifest records the generated Ruby module names. A package module exposes `WORKFLOWS` and an `activities(...)` method; its per-source modules expose the same inputs. `ACTIVITIES` remains available only when the collection needs no instance arguments. These are ordinary inputs to `Temporalio::Worker.new(workflows: ..., activities: ...)`. Authored Worker code requires the generated file from its corresponding build and selects the native registration scope. Package aggregation is optional; source placement does not assign Workers or Task Queues.

Generated files use `require_relative`, so source imports resolve inside the corresponding versioned build. Hashes determine file and module names reproducibly; they do not determine Temporal identities. Package modules have separate namespaces.

For Activities, the generator uses the class when native zero-argument construction is available. If the definition source has one unambiguous public constant holding an existing instance, the generated array uses that instance. `Definition::Info` constants retain their authored block, instance, or factory. For an accessible Activity class with required constructor parameters or several candidate instances, `activities(instance_0, ...)` accepts one application-owned instance per class. The generated signature comments and manifest record the corresponding native class for each parameter. The package method forwards those instances to its source collections; adding another definition updates the generated collection without another authored list. Ruby retains its native distinction between a class instantiated for each execution and an existing instance shared across executions. Inaccessible, conditional, or reopened classes still require explicit native assembly and receive a diagnostic. Genesys never creates constructor arguments, invokes a factory during discovery, or creates a dependency container. The application can combine generated arrays with explicit native registration.

Collision checks apply to literal registration arrays in authored `Worker.new` calls, separately for Workflows and Activities. Computed arrays are reported as unresolved. Equal names in independent Workers are allowed. Native Worker validation checks generated aggregate arrays when application code consumes them.

## Worker programs and builds

Worker source belongs in a recognized named Worker directory or the native Ruby `bin`/`exe` directory under Ruby package context. Extensionless files additionally require a Ruby shebang. Discovery recognizes direct top-level `Temporalio::Worker.run_all`, a local variable assigned `Temporalio::Worker.new` followed by `run`, and chained `Worker.new(...).run`. It does not launch arbitrary helper files that mention a Worker. Unresolved launch paths retain the executable override and receive a diagnostic; no authored startup script is required.

With a Gemfile, build commands run `bundle check` and Ruby syntax checks, and startup uses `bundle exec ruby <entrypoint>`. Otherwise startup uses `ruby <entrypoint>`. Commands use argument arrays and the package root as working directory. Build execution can evaluate native package code; static inspection cannot. The application retains native dependency installation, connection options, queue names, plugins, and shutdown signals.

Worker construction and `run` do not prove readiness. A supervisor needs recent Worker heartbeats attributed to the owned host/PID/start time and successful polling for each known Worker instance. Dynamic instance coverage stays unknown. Native deployment drainage remains a separate retirement condition. Generated registration adds no readiness markers or lifecycle wrapper.

## Validation limits

TypeScript type checking and Ruby syntax checking validate the adapter and parser. No tests, test harnesses, assertion-based checks, Worker startup, Temporal service calls, or application-code discovery were run. Source review and dependency installation do not establish end-to-end runtime compatibility for an application or older SDK releases.
