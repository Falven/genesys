# Genesys

Genesys uses directory conventions to identify native Temporal definitions and prepare their registration.

## Language

**Discovery root**:
A source directory whose contents follow the Genesys discovery convention.
_Avoid_: Runtime root, deployment root

**Entry**:
A source file whose recognized path identifies its role in discovery.
An entry can expose multiple native Temporal definitions.
_Avoid_: Definition count, Worker, execution

**Definition**:
Authored application logic that implements a Temporal primitive through its native SDK.
_Avoid_: Execution, generated artifact

**Nexus service handler**:
A native implementation of a named Nexus service and its operation handlers.
_Avoid_: Workflow definition, standalone operation registration

**Identity**:
A public name that a native Temporal definition or registration mechanism exposes to callers.
_Avoid_: Source path, Workflow ID

**Source ownership**:
The relationship between a definition and its associated source files.
_Avoid_: Worker placement, deployment ownership

**Generated registration**:
Native imports and SDK-specific registration code that Genesys produces from discovered definitions.
_Avoid_: Framework configuration, Worker group, Task Queue

**Package context**:
The module rules, dependencies, and build settings that apply to a definition's source language.
_Avoid_: Task Queue, runtime selector

**Manifest**:
A generated record of discovered definitions or generated registration artifacts.
_Avoid_: Application configuration, deployment specification

**Generated artifact**:
An output that Genesys derives from authored source and package context.
_Avoid_: Authored definition, runtime state

**Native assembly**:
Application code that constructs or registers definitions through the Temporal SDK.
_Avoid_: Framework execution model

**Worker launch**:
The operation that starts an authored native Worker program in its required environment.
_Avoid_: Discovery, Workflow start

**Worker entrypoint**:
The native program entry used to start one or more Temporal Workers.
_Avoid_: Workflow definition, Task Queue, required startup script

**Development session**:
The Workers, logs, status, and development operations that one Genesys supervisor owns.
_Avoid_: Workflow execution, Temporal Namespace

**Supervisor reuse**:
A development invocation that uses a responding supervisor without owning its lifecycle.
_Avoid_: Worker startup, new session, Temporal connection
