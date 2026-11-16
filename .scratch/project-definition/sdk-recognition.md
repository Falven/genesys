# Native SDK recognition evidence

Reviewed on 2026-11-15.
This record summarizes documentation and source inspection. It does not report SDK execution checks or establish supported release ranges.
Check exact released SDK versions before implementation.

| SDK        | Workflow recognition                                                                    | Activity recognition and registration                                                                                                                                        |
| ---------- | --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Go         | A function with a native Workflow signature. Registration options can provide its name. | Functions, bound methods, or exported methods on a registered struct. Native registration can select individual methods.                                                     |
| Java       | An implementation of an annotated Workflow interface and its Workflow method.           | Each method of an Activity interface defines an Activity type. Ordinary Worker registration accepts implementation objects and registers their Activity methods together.    |
| .NET       | A Workflow class with a Workflow run method.                                            | Activity attributes identify methods. Native registration can select one method or register a type's Activities. The SDK supports non-public Activity methods.               |
| PHP        | A Workflow class with applicable native interface and method attributes.                | Each eligible Activity method defines a type. Native registration accepts a class and an optional construction factory.                                                      |
| Python     | A class with the native Workflow definition decorator and a Workflow run method.        | Decorated callables, including functions and bound methods. Native registration selects callables individually.                                                              |
| Ruby       | A Workflow definition subclass with its execution method.                               | An Activity definition subclass normally defines one Activity through its execution method. Registration accepts classes, instances, or supported native definition objects. |
| Rust       | Native Workflow macros identify the implementation type and run method.                 | Native Activity macros identify methods. Registration can select an implementation's Activities together or an individual Activity.                                          |
| TypeScript | Functions exported by the native Workflow bundle entry.                                 | Function values in the Worker's Activity mapping. Implementations can include bound methods or closures.                                                                     |

## Recognition limits

- Go and TypeScript functions have no unique Activity definition marker.
- Directory placement states discovery intent but does not replace native SDK requirements.
- Native visibility rules differ. A universal public-export requirement would exclude valid implementations.
- Interface inheritance, native attributes, decorators, macros, and registration overrides can affect identity resolution.
- A dynamic catch-all definition differs from a definition whose fixed name requires runtime computation.
- Construction can require native instances, factories, or dependency injection.
- Static discovery must not invent constructor arguments or change source visibility.

Recognized source files can expose multiple Activity definitions, including grouped native implementations.
Genesys generates native registration for those definitions without separate authored registration lists.
Validate native definitions, naming conflicts, and registration ambiguity rather than a fixed definition count.
The Nexus registration unit remains a native service or service handler, which can contain multiple operations.

## Multiple Activities in one source file

Java, Python, and TypeScript can each express this arrangement:

```text
activities/payments.<extension>
├── chargeCustomer
└── refundCustomer
```

The members identify implementations. Public Activity names still follow native SDK rules.

| SDK        | Native registration generated from the discovered definitions                                 |
| ---------- | --------------------------------------------------------------------------------------------- |
| Java       | Register an implementation object. Its Activity-interface methods become separate Activities. |
| Python     | Supply a list of decorated functions or bound methods.                                        |
| TypeScript | Supply a mapping from Activity names to functions.                                            |

These differences belong inside the registration generator.
They do not impose different file-count rules on authors.
The generator preserves both Activities and their native registration behavior.

## Sources

- [Go Worker registration API](https://pkg.go.dev/go.temporal.io/sdk/worker)
- [Java Workflow contracts](https://github.com/temporalio/sdk-java/blob/master/temporal-sdk/src/main/java/io/temporal/workflow/WorkflowInterface.java)
- [Java Activity contracts](https://github.com/temporalio/sdk-java/blob/master/temporal-sdk/src/main/java/io/temporal/activity/ActivityInterface.java)
- [Java Worker registration](https://github.com/temporalio/sdk-java/blob/master/temporal-sdk/src/main/java/io/temporal/worker/Worker.java)
- [.NET Worker options](https://dotnet.temporal.io/api/Temporalio.Worker.TemporalWorkerOptions.html)
- [.NET Activity reflection](https://github.com/temporalio/sdk-dotnet/blob/main/src/Temporalio/Activities/ActivityDefinition.cs)
- [PHP declaration reader](https://github.com/temporalio/sdk-php/blob/master/src/Internal/Declaration/Reader/ActivityReader.php)
- [PHP Worker registration](https://github.com/temporalio/sdk-php/blob/master/src/Worker/WorkerInterface.php)
- [Python SDK guide](https://github.com/temporalio/sdk-python)
- [Ruby SDK guide](https://github.com/temporalio/sdk-ruby)
- [Rust SDK guide](https://github.com/temporalio/sdk-rust/blob/main/crates/sdk/README.md)
- [Rust Worker builder](https://docs.rs/temporalio-sdk/latest/temporalio_sdk/struct.WorkerOptionsBuilder.html)
- [TypeScript Worker options](https://typescript.temporal.io/api/interfaces/worker.WorkerOptions)
