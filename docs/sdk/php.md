# PHP native registration

Genesys reads PHP with `php-parser` 3.7.0. Inspection does not load the Composer autoloader, instantiate attributes or application objects, or run PHP, Composer scripts, or RoadRunner.

The reviewed release is [`temporal/sdk` v2.20](https://github.com/temporalio/sdk-php/tree/v2.20), commit `5180fcd24e8f08fd5955fde7b2eeeae3c018b2e5`. Inspection records the installed version from `composer.lock` separately. Other versions need native verification.

## Definitions

Use the normal `temporal/workflows` and `temporal/activities` source directories inside a Composer package. A file may contain several native classes. Interfaces, abstract classes, and traits supply inherited metadata; only concrete implementations produce registration. PHP namespaces, imported aliases, grouped imports, native attributes, local interfaces, and local inheritance are analyzed. The Composer autoloader must be able to load each concrete class. Use native Composer `classmap` or `files` autoload entries when several classes share a file and PSR-4 alone cannot locate them.

Workflow identities follow the SDK reader: an explicit `WorkflowMethod` name takes precedence; otherwise the first `WorkflowInterface` class or interface supplies its short name. A Workflow with no entry method uses the SDK's class-name default. Signal, Query, Update, and Update validator methods stay on their Workflow class. Genesys does not copy these handlers or construct Workflow state.

Each public non-static method on an `ActivityInterface` declaration supplies an Activity. The native reader combines the interface prefix with the optional `ActivityMethod` override. Inherited declarations can expose more than one native name for a method. Magic methods need an explicit `ActivityMethod` attribute. One Activity class is registered once even when it defines several methods. Native Activity factories retain instance ownership.

Nonliteral names remain unresolved; computed names are not native catch-all definitions. Competing inherited Workflow metadata remains unresolved and is left to the native reader. External ancestors, conditional declarations, trait adaptations, Doctrine annotations, custom metadata readers, enums, and dynamic class aliases can require explicit native assembly. Incomplete hierarchies do not produce partial automatic registration. PHP syntax outside the parser's PHP 8.4 grammar produces a parser diagnostic. These are tooling limits, not claims that the native SDK forbids the source.

## Generated code

Each discovery root produces `.gsys/compile/php/<stable-root-id>/registration.php`. The compile manifest records the exact path. The file returns an ordinary PHP closure with native SDK parameters:

```php
$register = require $generatedRegistrationPath;
$register($worker, fn(ReflectionClass $class) => $container->get($class->getName()));
```

Load the application's Composer autoloader first. `$worker` is an authored `Temporal\Worker\WorkerInterface`. The second argument is the SDK's own `registerActivity` factory callback, not a Genesys container interface. It may return an existing application instance or construct one using the application's container. If omitted, the SDK retains its native default construction behavior. Genesys never invents constructor arguments.

Generated code calls `registerWorkflowTypes(ClassName::class)` and `registerActivity(ClassName::class, $activityFactory)`. The application decides which native Worker receives it and can continue to perform explicit registration. Adding a definition to the root changes the generated calls without a separate authored definition list. Source organization does not select Task Queues or deployment placement.

Collisions between methods of the same Activity class are native declaration errors. Duplicate identities across implementations produce a warning and omit the ambiguous generated closure. Valid explicit native assembly in independent Worker scopes can still build. Independent discovery roots and explicit Worker scopes do not create a global collision. Collisions with explicit or dynamic registration remain unresolved until native assembly.

The source and registration must both come from the same versioned build. The adapter does not alter Worker options, converter configuration, connection settings, task queues, or deployment identifiers.

## RoadRunner and Composer

Native `.rr.yaml` and `.rr.yml` files are included in source inspection. A named Worker directory can own one RoadRunner config; a single named Worker can also use one package-root config. Multiple competing configs or several named Workers sharing a package-root config are ambiguous. Inspection does not choose a PHP file as a standalone poller or interpret `server.command` as a Genesys startup script.

The build plan runs `composer install --no-interaction` from the Composer package directory, then native `php -l` syntax compilation for discovered PHP entries and generated registration. Composer plugins and scripts run only in the native build phase. Keep `composer.lock` to pin native dependencies. The launch plan runs `rr serve -c <config filename>` from the native config directory, preserving its authored `server.command` and Temporal options. The `rr` executable must be on PATH, or the application can supply the native executable override. Alternate config formats and nonstandard launch environments retain explicit native startup.

RoadRunner hosts the Temporal pollers; PHP child processes execute application code. RoadRunner's pool-ready status and `WorkerFactory::run()` are not polling evidence. Readiness remains unavailable until supervision can attribute native Worker heartbeats to the RoadRunner host PID and process generation and observe fresh successful polls for every known task type. Dynamic Worker coverage may remain unknown. Deployment drainage is separate retirement evidence; it does not follow from readiness.

## Nexus

The reviewed PHP SDK has no public Nexus service-handler registration API. `WorkerOptions` exposes Nexus concurrency fields, but those fields do not supply PHP service implementations. Nexus source entries receive a feature-limit diagnostic, and no fabricated Nexus registration is emitted.

## Evidence and limits

The SDK's [Worker interface](https://github.com/temporalio/sdk-php/blob/v2.20/src/Worker/WorkerInterface.php), [Activity reader](https://github.com/temporalio/sdk-php/blob/v2.20/src/Internal/Declaration/Reader/ActivityReader.php), [Workflow reader](https://github.com/temporalio/sdk-php/blob/v2.20/src/Internal/Declaration/Reader/WorkflowReader.php), and [inheritance graph](https://github.com/temporalio/sdk-php/blob/v2.20/src/Internal/Declaration/Graph/ClassNode.php) were inspected. The PHP host had no PHP or Composer executable; native build verification used an isolated Docker toolchain. Exact build results are recorded in ticket 05. No tests or assertion-based checks were added or run. Native syntax and dependency installation do not establish live polling, payload compatibility, or replay compatibility.

The release check on 2026-11-16 found v2.20 as the latest stable release. Review of
[the v2.19-to-v2.20 changes](https://github.com/temporalio/sdk-php/compare/v2.19...v2.20)
confirmed that the Worker registration interface and declaration readers used by
Genesys did not change. v2.20 requires PHP 8.2 or later and moves RoadRunner PHP
dependencies to `roadrunner/*`; its release recommends RoadRunner v3. Application
converters and Worker options retain the SDK's new serialization-context and
payload controls without generated wrappers. In an isolated PHP 8.5.12/Composer
2.11.2 container, Composer updated the existing native sample to v2.20 and PHP
syntax checks accepted its generated registration and Workflow source. These
checks did not start PHP Workers or RoadRunner.
