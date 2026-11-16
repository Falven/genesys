---
title: "PHP SDK"
description: "Register native PHP definitions and build and launch a RoadRunner Worker with Genesys."
---

Genesys generates a PHP registration closure for each discovery root with PHP
definitions. Call the closure with a native Worker created by the application.
RoadRunner hosts the Temporal pollers and starts the PHP Worker program.

## Prerequisites

- PHP CLI 8.2 or newer with `curl` and `json` for the reviewed
  [Temporal PHP SDK v2.20](https://github.com/temporalio/sdk-php/releases/tag/v2.20).
  The resolved packages may require other extensions such as `sockets` for the
  RoadRunner PHP worker.
- Composer on `PATH` to install and autoload the application's dependencies.
- For startup, `rr` on `PATH` with the Temporal plugin, built for the runtime
  operating system and architecture. The SDK v2.20 release recommends RoadRunner v3.

`gsys inspect` uses the bundled `php-parser` 3.7.0 and reports the SDK version
from `composer.lock` when present. Inspection leaves application code, Composer,
and RoadRunner idle.

## Place and name definitions

Put native classes under `temporal/workflows/` and `temporal/activities/` inside
a Composer package. A source file can define several classes. Genesys reads
namespaces, imported aliases, grouped imports, native attributes, local
inheritance, and local interfaces. Interfaces, abstract classes, and traits can
supply metadata. Registration targets concrete classes. Composer must be able
to autoload each concrete type. Use a Composer classmap or files entry when
several types share a file and PSR-4 alone cannot locate them.

| Definition | How the SDK derives the identity                                                                                                                                                                                                                                                                                           |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Workflow   | An explicit `WorkflowMethod` name takes precedence. Otherwise, use the short name of the first `WorkflowInterface` class or interface. A Workflow with no entry method uses the SDK's class-name default.                                                                                                                  |
| Activity   | Each public, non-static method on an `ActivityInterface` declaration supplies an Activity. The native reader combines the interface prefix with the method name or its `ActivityMethod` override. Inherited declarations can expose several names for a method. Magic methods need an explicit `ActivityMethod` attribute. |

Signals, Queries, Updates, and validators stay on the authored Workflow class.

Use explicit native assembly when the source depends on external ancestry,
conditional declarations, trait adaptations, Doctrine annotations, custom
readers, enums, or runtime class aliases that Genesys cannot resolve. An
incomplete hierarchy prevents automatic registration for the affected class.
Computed names and competing inherited Workflow metadata remain unresolved for
static analysis. Genesys can still emit the native class registration for an
unresolved name, with incomplete collision coverage. PHP syntax beyond the
parser's PHP 8.4 grammar receives a parser diagnostic.

Duplicate names across implementations in one generated scope produce a
warning and omit that scope's closure. Separate discovery roots can expose equal
names. Use explicit native registration for independent Worker scopes when
automatic aggregation would conflict. The SDK validates collisions within an
Activity class and in each actual Worker scope, including generated and explicit
registrations.

## Attach registration to a Worker

The build manifest records emitted files under
`.gsys/compile/php/<stable-root-id>/registration.php` relative to the published
build root. Load the application's Composer autoloader before requiring the
registration file. Each closure calls `registerWorkflowTypes` and registers
each Activity class once with `registerActivity`, even when the class has
several methods. Pass the native `ReflectionClass` factory callback when
Activity construction needs dependencies. Your callback can return an existing
instance or resolve it through your container. Omit the callback to use the SDK's
default construction.

For a Composer package with one discovery root, use the following layout.

```text
php-greetings/
├── composer.json
├── temporal/
│   ├── activities/GreetingActivity.php
│   └── workflows/GreetingWorkflow.php
└── workers/greetings/
    ├── .rr.yaml
    └── worker.php
```

Create `composer.json`. This example uses a classmap for the authored classes.

```json
{
  "name": "example/php-greetings",
  "require": {
    "temporal/sdk": "2.20"
  },
  "autoload": {
    "classmap": ["temporal/"]
  }
}
```

Create `temporal/activities/GreetingActivity.php`.

```php
<?php

namespace Greetings;

use Temporal\Activity\ActivityInterface;

#[ActivityInterface]
final class GreetingActivity
{
    public function __construct(private readonly string $prefix) {}

    public function greet(string $name): string
    {
        return $this->prefix . ', ' . $name;
    }
}
```

Create `temporal/workflows/GreetingWorkflow.php`.

```php
<?php

namespace Greetings;

use Temporal\Workflow\WorkflowInterface;
use Temporal\Workflow\WorkflowMethod;

#[WorkflowInterface]
final class GreetingWorkflow
{
    #[WorkflowMethod(name: 'PhpGreeting')]
    public function greet(string $name): string
    {
        return 'Hello, ' . $name;
    }
}
```

Create `workers/greetings/worker.php`. The glob selects the only generated
closure in this example. In a project with several discovery roots, use the
manifest to select the specific registration path for each Worker.

```php
<?php

use Greetings\GreetingActivity;
use Temporal\WorkerFactory;

$package = dirname(__DIR__, 2);
require $package . '/vendor/autoload.php';

$paths = glob($package . '/.gsys/compile/php/*/registration.php');
if ($paths === false || count($paths) !== 1) {
    throw new RuntimeException('Expected one generated PHP registration file.');
}
$register = require $paths[0];

$factory = WorkerFactory::create();
$worker = $factory->newWorker('php-greetings');
$activity = new GreetingActivity('Hello');
$register($worker, static fn (ReflectionClass $class): GreetingActivity => $activity);
$factory->run();
```

Create `workers/greetings/.rr.yaml`. The local example expects Temporal on
port 7233 in the `default` Namespace.

```yaml
version: "3"
rpc:
  listen: tcp://127.0.0.1:6001
server:
  command: "php worker.php"
temporal:
  address: 127.0.0.1:7233
  namespace: default
  activities:
    num_workers: 1
```

A named Worker directory can have one `.rr.yaml` or `.rr.yml`. Genesys
prefers a Worker-local config. A single named Worker can also use one config at
the Composer package root. Automatic startup requires an unambiguous config
with a `temporal` section and a `server.command` string. For unresolved launch
environments, use explicit native startup or a development executable override.

## Build and start the application

From the project root, run the build.

```sh
gsys build
```

Genesys emits registration into the versioned workspace, runs
`composer install --no-interaction --no-scripts` in the copied Composer
package, and runs `php -l` on discovered PHP entries and generated registration.
Keep `composer.lock` to pin dependencies. Use an enclosing task for application
steps that rely on lifecycle scripts. Development builds use
`composer install --no-interaction` with the normal Composer lifecycle. If a
Composer task calls `gsys build`, keep that task out of development install
hooks.

The build publishes the application tree with authored source, assets, config,
and generated registration. Use a workspace-local Composer install path to keep
dependencies with the build. With the default layout, the artifact inventory
includes changed or new files such as `vendor/autoload.php`. The Worker build
record lists the package, generated registration paths, and resolved RoadRunner
config. Preserve dependencies outside the workspace where your native settings
require them.

Read the selected build manifest at `.gsys/compile/manifest.json` and follow
its `manifestPath`. Start the native program using the chosen Worker's
`start.executable`, `start.args`, and `start.cwd`, with the recorded
`start.env` values if present. From the config directory in this example, with
Temporal already running, use this command.

```sh
rr serve -c .rr.yaml
```

Provide the runtime environment required by `server.command` and the
`temporal` config. Use `composer check-platform-reqs` in the built Composer
package with the intended PHP runtime to check the installed packages. Keep
relative paths between source, config, autoload files, and generated
registration. Preserve fixed paths and external files used by Composer or your
enclosing build task.

## Capability and platform limits

PHP SDK v2.20 has no public Nexus service-handler registration API. Nexus
entries receive a feature-limit diagnostic. The SDK's Nexus concurrency fields
do not register PHP handlers. See the released
[Worker interface](https://github.com/temporalio/sdk-php/blob/v2.20/src/Worker/WorkerInterface.php),
[Activity reader](https://github.com/temporalio/sdk-php/blob/v2.20/src/Internal/Declaration/Reader/ActivityReader.php),
and [Workflow reader](https://github.com/temporalio/sdk-php/blob/v2.20/src/Internal/Declaration/Reader/WorkflowReader.php).

Linux arm64 verification used SDK v2.20 and Composer 2.11.2. Earlier native
runs verified generated registration and factory construction with RoadRunner
2025.1.5 on PHP 8.5.12 and PHP 8.4.27. Builds and syntax checks alone leave
runtime compatibility, replay, and payload compatibility unverified. These
runs cover the recorded toolchains. Check the intended version and platform
before relying on another combination.

For readiness, the supervisor needs a recent native Worker heartbeat tied to
the RoadRunner host PID and process start time, plus fresh successful polls for
each known task type. Starting the PHP program or seeing a ready RoadRunner pool
does not supply that evidence. Dynamic Worker coverage can remain unknown.
Retirement also requires native evidence about drainage and pinning.

## Next steps

See [Native Registration](../../concepts/native-registration.md) for how to
combine generated and explicit registration. Find deployment and platform
guidance in the [documentation index](../../README.md).
