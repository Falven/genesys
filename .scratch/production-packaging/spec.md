# Genesys production packaging specification

Status: ready-for-agent

## Problem Statement

Developers need native application output that they can distribute and run through their existing tools.
Generated registration must accompany the application that consumes it.
Developers also need clear information about startup, dependencies, target environments, and installation constraints.

Existing versioned builds provide registration, native build commands, output records, and startup information.
Those workspaces do not establish a portable or self-contained application package.
The current deployment example does not define the production output contract for every supported SDK.

A repository can contain unrelated Worker applications.
Shared directories, languages, and package manifests do not establish which programs belong together.
Automatic application grouping would interfere with the author's native build and deployment choices.

## Solution

`gsys build` generates registration and produces native application output through supported native build and packaging tools.
Authors determine application grouping and packaging through their native tooling.
They use existing native tasks or scripts to call `gsys build` and compose additional steps.

Each application output includes the generated registration that it consumes and the application dependencies required by its native packaging contract.
The output format can differ by SDK and target environment.
Generated metadata records available build information, and documentation states known runtime requirements.

Building remains separate from startup and deployment.
Users start native programs and supply runtime settings through their chosen tools.
Genesys does not generate infrastructure configuration, build container images, or operate production processes.

## User Stories

1. As a developer, I want native application output from `gsys build`, so that I can distribute it through existing tools.
2. As a developer, I want generated registration included with its application, so that the deployed code contains matching definitions.
3. As a developer, I want directory discovery to update registration, so that I do not maintain separate registration lists.
4. As an application author, I want native packaging settings respected, so that I control my application output.
5. As an application author, I want unrelated applications in one repository, so that repository organization does not force deployment grouping.
6. As an application author, I want shared manifests without forced grouping, so that native workspaces remain usable.
7. As an application author, I want several entrypoints in one application when appropriate, so that I control program composition.
8. As an application author, I want several SDK Workers in one program, so that native process layouts remain available.
9. As an application author, I want library dependencies handled by native tooling, so that discovery does not create deployment units from libraries.
10. As a developer, I want support for every Genesys-supported SDK language, so that packaging does not impose one application language.
11. As a developer, I want native artifact formats, so that packaging fits my language and target environment.
12. As a developer, I want native package rules preserved, so that shared source and dependencies remain usable.
13. As a developer, I want native tasks to invoke `gsys build`, so that I can compose my existing build sequence.
14. As a developer, I want enclosing build scripts excluded from automatic invocation, so that build composition cannot recursively invoke itself.
15. As a developer, I want language-specific native tools, so that I do not need a universal script format.
16. As a developer, I want required build failures reported, so that a failed command cannot appear successful.
17. As a developer, I want packaging failures to fail the build, so that incomplete required steps remain visible.
18. As a developer, I want failed candidates isolated, so that a failed build preserves the last successful result.
19. As a developer, I want authored source preserved, so that generation does not overwrite my application.
20. As a developer, I want output locations recorded, so that I can find native artifacts without a universal archive format.
21. As an operator, I want source-build metadata, so that I can associate output with its recorded inputs.
22. As an operator, I want available target information, so that I can select a suitable runtime environment.
23. As an operator, I want startup commands and working directories recorded, so that I can start the native programs correctly.
24. As an operator, I want argument boundaries preserved, so that recorded commands retain their native meaning.
25. As an operator, I want available dependency information, so that I can inspect what the native build includes.
26. As an operator, I want known runtime requirements documented, so that I can supply external runtimes and system libraries.
27. As an operator, I want installation constraints documented, so that I do not relocate output that requires fixed paths.
28. As a developer, I want builds without a complete runtime inventory, so that unavailable metadata does not block valid native output.
29. As an operator, I want build success distinguished from deployment readiness, so that I do not infer unsupported runtime guarantees.
30. As an application author, I want native Temporal options retained, so that I control connections, registration, concurrency, and lifecycle.
31. As an operator, I want runtime settings supplied at startup, so that deployment credentials do not become build metadata.
32. As an operator, I want direct native startup, so that production does not require a Genesys supervisor.
33. As an operator, I want my existing infrastructure tools, so that Genesys does not manage processes, replicas, resources, or secrets.
34. As an operator, I want container construction under my control, so that I choose image contents, base images, and registries.
35. As an operator, I want native versioning controls retained, so that build identifiers do not silently change Temporal routing.
36. As an operator, I want required earlier builds retained, so that active or pinned executions keep their required code.
37. As an operator, I want readiness separated from retirement, so that a ready replacement does not remove a required version.
38. As a developer, I want examples of native build and startup, so that I can understand the output without infrastructure tooling.
39. As a maintainer, I want SDK-specific limitations documented, so that unsupported tooling does not appear to be an SDK restriction.
40. As a maintainer, I want existing build and generation components reused, so that production packaging does not introduce another execution model.

## Implementation Decisions

- **Command contract.** Retain `gsys build` as the native application build command. It generates registration and executes supported native build and packaging steps. Report success only after the required steps complete. Do not add arbitrary executable forwarding, a separate required packaging command, or a production startup command.

- **Composition ownership.** Authors use native tasks or scripts to call the command and compose additional steps. Genesys must not automatically invoke an enclosing build script that calls `gsys build`. Native scripts remain optional. Genesys does not require a universal script convention or JavaScript package manifest across languages.

- **Native pipeline selection.** SDK tooling selects supported native operations and respects applicable native build and packaging settings. Compilation and packaging remain language-specific. Do not replace native configuration with a Genesys target, runtime, or application-group schema. Report unsupported required operations clearly rather than substituting a different application output.

- **Application ownership.** Users decide which programs belong together and how to package them. Directory conventions identify discovery sources. Package context supplies language, dependency, and build information. Neither establishes a deployment group. A shared repository, directory, language, or manifest must not cause Genesys to combine Workers into an application package.

- **Entrypoint distinction.** An entrypoint identifies how to start a program. It does not require a separate application package. A program can construct multiple native SDK Workers. Build-command deduplication or shared workspace analysis does not establish an application or deployment boundary.

- **SDK coverage.** The contract applies to every Genesys-supported SDK language, including Go, Java, .NET, PHP, Python, Ruby, Rust, and TypeScript. Use native build and packaging mechanisms for each language. Document the supported commands, outputs, and runtime requirements. Do not reduce coverage to one language or require identical artifact formats.

- **Registration inclusion.** Generate native imports and registration before the consuming native build step. Application output must contain the registration it consumes, as native code or its compiled result. Preserve explicit native assembly, native definition identities, and application-owned dependency construction. Packaging does not assign every discovered definition to every Worker.

- **Dependencies.** Native tooling controls application dependency resolution and inclusion. Preserve required runtime assets and application dependencies according to the native packaging contract. Runtimes, toolchains, and system libraries can remain external requirements where appropriate. A dependency manifest alone does not prove that every dependency is present in runtime output.

- **Output contract.** Produce the native application artifacts supported by the selected native settings. There is no mandatory archive, container image, or common executable format. Record output locations without inferring deployment membership from their directory layout. Users determine distribution and deployment.

- **Existing component boundaries.** Extend native build planning, build execution, artifact recording, and SDK documentation where required. Reuse discovery and registration generation. Preserve the distinction between static inspection and native build steps that can execute authored code. Do not introduce a production execution interface or supervisor.

- **Publication.** Retain isolated versioned builds and the existing generated-artifact convention. Publish the successful result after required generation, build, packaging, and record-writing steps complete. Failure leaves the previous published result selected. Cleanup affects only owned candidate artifacts under the existing rules.

- **Installation paths.** Preserve native requirements for absolute paths and relative workspace layout. Do not rename a completed workspace whose output depends on its build location. Document fixed locations and accompanying files required for native startup. Do not promise relocation, cross-platform execution, or a self-contained runtime package without evidence.

- **Available metadata.** Record the source build, target environment, supported startup commands, included dependencies, and external runtime requirements where information is available. Preserve existing input, tool, command, and output records. These records describe build results and do not configure deployment. Keep build-host information distinct from an artifact target when native settings establish a different target.

- **Metadata limits.** Do not require a complete runtime inventory or introduce a completeness gate. Document known runtime requirements. Missing metadata does not establish the absence of a dependency or requirement. Do not invent missing values. Required native build or packaging failures still fail the command.

- **Provenance limits.** Keep recorded build identities separate from Temporal deployment identities. Do not claim byte-identical artifacts, reproducible environments, complete dependency closure, or runtime compatibility from successful generation or compilation. Preserve the existing handling that avoids publishing arbitrary environment values as metadata.

- **Native startup.** Record available native executable, argument, and working-directory information. Preserve argument boundaries. Production starts the native program through user tooling. Build publication does not start Workers, start a Temporal Service, watch source, or establish readiness.

- **Temporal ownership.** Native application code retains connections, credentials, registration consumption, Task Queues, concurrency, converters, interceptors, and lifecycle behavior. Existing tooling manages Namespaces, Schedules, Nexus endpoints, and Temporal versioning. Package structure does not assign execution order, child Workflow relationships, or task routing.

- **Operational ownership.** Deployment tools supply runtime settings and manage processes, replicas, resources, secrets, networking, and releases. Genesys does not generate or manage their configuration. Users may keep that configuration in the same repository and reference native output.

- **Version retention.** Retain builds required by active or retained Worker versions under existing ownership and retention rules. Include known external consumers in retention decisions. Build success and replacement readiness do not authorize retirement. Native Temporal rules and user deployment tooling remain authoritative for version routing and retirement.

- **Examples and documentation.** Demonstrate package creation and native startup without requiring infrastructure tooling. Explain native output files, included registration, available metadata, known dependencies, and installation constraints. Describe startup requirements without adding an execution wrapper. Existing infrastructure examples do not become a production configuration generator.

## Testing Decisions

The user excluded tests for this work.
Do not add or run tests, introduce test harnesses, or create assertion-based self-checks for this specification.
This specification requires no test seams, test modules, or test-specific interfaces.
Existing test work from other efforts remains outside this scope.

Implementation verification can use ordinary native builds, type checks, formatting, artifact inspection, and code review.
Prefer the existing public build command and its native output as the verification boundary.
Inspect the result that a user consumes rather than adding interfaces solely for verification.
Existing versioned builds and SDK examples provide the implementation precedent.

Record which checks actually ran and their limits.
Do not describe artifact inspection or a successful native build as executed runtime compatibility evidence.
Publishing this specification does not require building applications or starting Workers.

## Out of Scope

- Product implementation or deployment during specification publication.
- Tests, test harnesses, assertion-based self-checks, and new test seams.
- Application grouping inferred from directories, languages, repositories, or package manifests.
- A Genesys application-group selector, deployment schema, or universal package format.
- A required startup script, universal build script, or package manifest shared across SDK languages.
- Arbitrary native command forwarding through `gsys build`.
- Automatic invocation of an enclosing script that calls `gsys build`.
- Infrastructure configuration generation, production process management, and GitOps controllers.
- Container-image construction, base-image selection, and registry publication.
- A new production start, deploy, or supervision command.
- Mandatory complete dependency or runtime inventories.
- Automatic changes to Task Queues, Temporal deployment identities, version routing, or pinned executions.
- New readiness or retirement mechanisms and changes to existing development-session behavior.
- Guarantees of relocation, cross-platform execution, minimal package contents, or byte-reproducible native artifacts without evidence.
- Unrelated SDK refactors and changes to other implementation efforts.

## Further Notes

This specification is the implementation-facing synthesis of accepted production packaging decisions Q1–Q8.
The [decision record](decisions.md) preserves their rationale and corrections.
It extends the [framework specification](../project-definition/spec.md) for native application output and packaging.
It does not replace the existing discovery, native-interface, development, or version-retention contracts.

The domain glossary remains authoritative.
Accepted architecture decisions preserve native Temporal interfaces and separate readiness from retirement eligibility.

Current build tooling already generates registration, runs native commands, inventories outputs, and publishes versioned records.
SDK-specific planning still needs to satisfy the clarified composition and packaging contract.
The existing TypeScript planner can select an authored build script automatically.
That behavior needs review against the prohibition on invoking an enclosing script that calls `gsys build`.

Document exact SDK-specific native operations and output requirements during implementation.
Those details must remain within this contract and must not introduce another application configuration model.
The specification status is `ready-for-agent`.
Publication does not claim completed implementation.
