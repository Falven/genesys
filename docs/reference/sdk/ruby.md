---
title: "Ruby SDK"
description: "Use generated registration with a native Ruby Worker and build its runtime dependencies with Bundler."
---

Genesys generates native Workflow and Activity collections. Pass them to your
own `Temporalio::Worker.new` along with its Client, Task Queue, and options.

## Prerequisites

- Ruby on `PATH` with the standard-library Ripper parser. The reviewed
  [Temporal Ruby SDK 1.11.0](https://github.com/temporalio/sdk-ruby/releases/tag/v1.11.0)
  requires Ruby 3.3 or newer.
- Bundler when your application uses a `Gemfile`. Install the Bundler version
  selected by your lockfile when applicable.

`gsys inspect` sends source text to Ripper with `RUBYOPT` and `RUBYLIB`
removed. It leaves project files unloaded, Gemfiles unevaluated, and application
constructors and factories uncalled. Syntax newer than the parser runtime
receives a source-linked diagnostic.

## Place and name definitions

Put native subclasses in `temporal/workflows/` and `temporal/activities/` within
a Ruby package. A file can supply several definitions. Genesys recognizes
package-local inheritance and direct superclass aliases. Names default to the
unqualified class name. Set `workflow_name` or `activity_name` with a literal
String or Symbol to override it. Native dynamic definitions remain nameless.
Signals, Queries, Updates, validators, and their state and visibility stay on
the authored Workflow class.

A Gemfile or gemspec establishes package context. Nested packages have
independent indexes. Literal `require_relative` can bring source dependencies
across a package boundary. The referenced definitions stay in their original
registration scope. Computed relative imports and load-path-dependent external
`require` resolution remain outside static analysis.

Computed or escaped names, conditional configuration, and reopened classes leave
identities unresolved. Use explicit native assembly for runtime metaprogramming,
external inheritance, private constants, and conditional forms Genesys cannot
resolve. Genesys reports source-linked diagnostics for those limits. Native SDK
validation still applies when the Worker registers its definitions.

## Attach registration to a Worker

Genesys writes `.gsys/ruby/registration.rb`, a registration file for each
eligible definition source, and `.gsys/ruby/manifest.json` under the Ruby
package root in the published build. The manifest records the package and
per-source module names. Each module exposes `WORKFLOWS` and
`activities(...)`. Modules also expose `ACTIVITIES` when their collections
need no instance arguments. Require the generated file from the same build as
the authored source. Generated imports use `require_relative`, and generated
module names stay independent of native Temporal identities.

| Activity form                                                                       | Generated registration                                                                                                       |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Class with zero-argument construction                                               | Passes the class to the SDK.                                                                                                 |
| One unambiguous public instance constant                                            | Passes the authored instance.                                                                                                |
| Public `Definition::Info` constant                                                  | Passes the native Info object with its authored block, instance, or factory.                                                 |
| Accessible class with required constructor arguments or several candidate instances | Accepts one instance through a parameter of `activities(...)`. The manifest and generated signature comments name its class. |

The SDK creates a class-based Activity instance for each execution and can reuse
an instance you supply across executions. The package-level method forwards
instances to the source collections. Add further native entries to the Worker
arrays when explicit assembly is needed. Genesys checks collisions in statically
readable literal Worker arrays separately for Workflows and Activities.
Computed arrays, including generated aggregates when consumed by the Worker,
leave static collision coverage incomplete. The SDK validates the actual
arrays. Independent Workers can use the same identities.

Put the Worker in a recognized `workers/<name>/` directory or a Ruby package's
`bin/` or `exe/` directory. Add a Ruby shebang to an extensionless entrypoint.
Genesys recognizes top-level `Temporalio::Worker.run_all`, a local
`Temporalio::Worker.new` assignment followed by `run`, and chained
`Worker.new(...).run`. Use explicit native startup or a development executable
override if the launch path cannot be resolved.

This example constructs an Activity instance and passes it to generated
registration. Create the following files.

```text
ruby-greetings/
├── Gemfile
├── bin/
│   └── worker
└── temporal/
    ├── activities/greeting_activity.rb
    └── workflows/greeting_workflow.rb
```

Create `Gemfile`.

```ruby
source 'https://rubygems.org'
gem 'temporalio', '1.11.0'
```

Create `temporal/activities/greeting_activity.rb`.

```ruby
require 'temporalio/activity'

class GreetingActivity < Temporalio::Activity::Definition
  def initialize(prefix)
    @prefix = prefix
  end

  def execute(name)
    "#{@prefix}, #{name}"
  end
end
```

Create `temporal/workflows/greeting_workflow.rb`.

```ruby
require 'temporalio/workflow'

class GreetingWorkflow < Temporalio::Workflow::Definition
  def execute(name)
    Temporalio::Workflow.execute_activity(
      GreetingActivity,
      name,
      start_to_close_timeout: 5
    )
  end
end
```

Create `bin/worker`.

```ruby
#!/usr/bin/env ruby

require 'json'
require 'temporalio/worker'
require_relative '../.gsys/ruby/registration'

manifest = JSON.parse(File.read(File.join(__dir__, '../.gsys/ruby/manifest.json')))
registration = Object.const_get(manifest.fetch('module'))
client = Temporalio::Client.connect(
  ENV.fetch('TEMPORAL_ADDRESS', 'localhost:7233'),
  ENV.fetch('TEMPORAL_NAMESPACE', 'default')
)
worker = Temporalio::Worker.new(
  client: client,
  task_queue: 'ruby-greetings',
  workflows: registration::WORKFLOWS,
  activities: registration.activities(GreetingActivity.new('Hello'))
)
worker.run(shutdown_signals: ['SIGINT', 'SIGTERM'])
```

## Build and start the application

From the project root, run the build.

```sh
gsys build
```

With a Gemfile, Genesys runs `bundle install` from the copied package root.
It supplies `BUNDLE_PATH=vendor/bundle` if Bundler has no configured path,
system gem setting, shared-gem setting, or enabled deployment mode. Bundler
applies the authored sources, groups, platform rules, and lockfile settings.
Any `BUNDLE_GEMFILE` override must be relative to the package root and resolve
inside the selected project. If Bundler creates or changes a lockfile, it
does so in the versioned workspace. Genesys runs `ruby -c` on parsed sources
and the generated package registration. Development builds use `bundle check`
with a Gemfile.

Static analysis can report the generated `require_relative` in `bin/worker`
as outside the source inventory. Check the published workspace for the generated
files after the build succeeds.

Read the selected build manifest at `.gsys/compile/manifest.json` and follow
its `manifestPath`. Use the selected Worker's `start.cwd`, `start.executable`,
`start.args`, and any `start.env` values. For this example, with Temporal
already running and the default bundle path, run this command from the recorded
working directory.

```sh
BUNDLE_PATH=vendor/bundle bundle exec ruby -- bin/worker
```

Keep the effective Bundler settings if the install uses a custom path. Without a
Gemfile, the start command is `ruby -- <entrypoint>`. Provide the gems the program
loads in that case. The build records native tool versions, registration paths,
and available dependency metadata. Its artifact inventory includes changed or
new files from the gem install.

Keep the source, generated files, and workspace-local gems in their relative
layout. External gem paths and system gem directories remain runtime
dependencies. Keep the workspace at its build location when Bundler settings
or gems use absolute paths. Native gems require a matching Ruby ABI, operating
system, CPU architecture, and linked system libraries.

## Capability and platform limits

Ruby SDK 1.11.0 publishes native gems for ARM64 and x64 on macOS and Linux.
Choose the correct gem when you install the bundle. Use the Linux gem under WSL.
Native MinGW Windows is unsupported. For musl-based Linux, follow the SDK's
Protobuf instructions. Compiling source dependencies can require a compiler and
development headers. See the SDK's
[platform support](https://github.com/temporalio/sdk-ruby/tree/v1.11.0#platform-support).

The reviewed SDK disables Nexus service registration. Nexus entries receive an
SDK feature-limit diagnostic. The generated inputs use the released
[Workflow definition](https://github.com/temporalio/sdk-ruby/blob/v1.11.0/temporalio/lib/temporalio/workflow/definition.rb),
[Activity definition](https://github.com/temporalio/sdk-ruby/blob/v1.11.0/temporalio/lib/temporalio/activity/definition.rb),
and [Worker](https://github.com/temporalio/sdk-ruby/blob/v1.11.0/temporalio/lib/temporalio/worker.rb) APIs.

Native build checks covered default and authored Bundler paths on macOS arm64
with Ruby 3.4.8 and Bundler 2.6.9. Prior Linux arm64 checks under Ruby 3.4.12,
Bundler 2.6.9, and SDK 1.11.0 ran generated Workflows and Activities from two
published builds. macOS and Windows execution and workspace relocation remain
unverified.

For readiness, the supervisor needs a recent native Worker heartbeat tied to the
owned host, PID and process start time, plus successful polling for each known
Worker instance. Starting a Worker does not supply that evidence. Dynamic Worker
coverage can remain unknown. Retirement also requires native evidence about
drainage and pinning.

## Next steps

See [Native Registration](../../concepts/native-registration.md) for how to
combine generated and explicit registration. Find deployment and platform
guidance in the [documentation index](../../README.md).
