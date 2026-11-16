<?php
declare(strict_types=1);

namespace GenesysPhp;

use Temporal\Activity\ActivityOptions;
use Temporal\Workflow;
use Temporal\Workflow\{SignalMethod as Signal, WorkflowInterface as WorkflowType, WorkflowMethod as Run};

if (($marker = getenv('GENESYS_PHP_MARKERS')) !== false) {
    file_put_contents($marker, "workflow-source\n", FILE_APPEND | LOCK_EX);
}

#[WorkflowType]
interface GreetingRun
{
    #[Run(name: 'php.greet')]
    public function greet(string $name): \Generator;

    #[Signal(name: 'php.release')]
    public function release(): void;
}

final class GreetingWorkflow implements GreetingRun
{
    private bool $released = false;

    public function greet(string $name): \Generator
    {
        yield Workflow::await(fn() => $this->released);
        $activity = Workflow::newActivityStub(
            Greeting::class,
            ActivityOptions::new()->withStartToCloseTimeout(5),
        );
        $greeting = yield $activity->greet($name);
        $suffix = yield $activity->suffix();
        return $greeting . $suffix;
    }

    public function release(): void
    {
        $this->released = true;
    }
}

#[WorkflowType]
final class ObsoleteWorkflow
{
    #[Run(name: 'php.obsolete')]
    public function run(): string
    {
        return 'obsolete';
    }
}
