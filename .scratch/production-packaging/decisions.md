# Production packaging decisions

This record contains accepted planning decisions through Q8.
SDK-specific build and output details remain to specify.
This record does not authorize implementation or deployment.

The [production packaging specification](spec.md) consolidates these decisions for implementation.

## Accepted decisions

### Q1: Native Worker applications form the package units

Genesys independently builds and packages user-defined native Worker applications.
Q4 clarifies that directory conventions and native package context do not determine application grouping.
An entrypoint identifies how to start a program.
It does not require a separate package for each entrypoint, SDK Worker, Task Queue, or deployment.

Packages include generated registration and required application dependencies.
Native application code and deployment tools retain control over Worker configuration, process layout, scaling, and versioning.
The goal is independently deployable packages that preserve native Temporal deployment patterns.

### Q2: Native tools produce deployable packages

Genesys produces deployable application packages through native build and packaging tools.
Each package includes the generated registration that its application consumes.

Generated metadata records available information about:

- The source build.
- The target environment.
- Supported startup commands.
- Included dependencies.
- External runtime requirements.

Q8 establishes that this metadata is not a complete runtime inventory.

Native application code retains Temporal configuration.
Deployment tools supply runtime settings and manage processes, replicas, resources, secrets, and releases.

The contract applies to every Genesys-supported SDK language.
Package formats and runtime requirements can differ by language and deployment target.

### Q3: Infrastructure configuration remains outside Genesys

Genesys builds application packages and records the information needed to run them.
Users manage deployment through their chosen infrastructure tools.
Users can include deployment configuration in their repositories and reference generated packages.
Genesys does not generate or manage that configuration.

Examples demonstrate package creation and native startup without requiring Compose or another infrastructure tool.

### Q4: Users determine application grouping

A repository can contain multiple unrelated Worker applications.
Users decide which programs belong together and how to package and deploy them.

Directory conventions identify sources for discovery.
Native package context supplies language, dependency, and build information.
Neither establishes a deployment group.

Genesys generates registration and builds packages according to the user's native build and packaging settings.
Genesys must not combine Workers because they share a repository, directory, language, or package manifest.
This rejects the proposed default application boundary based on a native package or project.

### Q5: The build command produces native application output

`gsys build` produces native application build output through the user's native build and packaging tools.
It does not require a universal package format or Docker image.
The output includes the generated registration that the application consumes.
Generated metadata records available information about the source build, target environment, startup commands, included dependencies, and external runtime requirements.

Genesys reports success after the required build and packaging steps complete.
Building remains separate from starting programs.
Users decide how to distribute and deploy the output.

### Q6: Users construct container images

Genesys produces native application artifacts and records their runtime requirements and installation-path constraints.
Users build container images through their existing tools.
Genesys does not require a container image or manage image construction, base-image selection, or registry publication.

### Q7: Native tasks compose the build

`gsys build` generates registration and produces native application output through supported native build and packaging tools.
Authors use existing native tasks or scripts to call `gsys build` and compose additional steps.
Genesys does not require a universal script format or `package.json` across languages.
Genesys must not automatically invoke an enclosing build script that calls `gsys build`.

Application grouping, packaging choices, and distribution remain under the user's native tooling.
Do not add `gsys build ... -- <executable> [arguments...]`.
Command forwarding requires a concrete requirement before reconsideration.

### Q8: Record available metadata

Record available build metadata and document known runtime requirements.
Do not require a complete runtime inventory.
Fail when required build or packaging steps fail.
Build success does not guarantee deployment readiness.

## Existing behavior retained

Retain the existing `.gsys/` artifact convention and versioned build publication rules.
Keep earlier builds while active or retained Workers require them.
Readiness alone does not authorize retirement or removal of an earlier build.
These are existing constraints, not a new production orchestration feature.

Keep native startup separate from building.
Do not add an application-group selector or deployment configuration model to resolve grouping that belongs to native tooling.

## Remaining specification work

- Specify supported native build and packaging steps for each SDK.
- Ensure those steps do not invoke an enclosing script that calls `gsys build`.
- Describe native output locations, startup commands, and known runtime requirements.
- Record available target and dependency information without promising a complete inventory.
- Demonstrate package creation and native startup without infrastructure tooling.

SDK-specific implementation details do not establish additional application concepts or configuration formats.
