<?php
declare(strict_types=1);

namespace GenesysPhp;

use Temporal\Workflow\{WorkflowInterface, WorkflowMethod};

if (!class_exists(ExplicitWorkflow::class, false)) {
    #[WorkflowInterface]
    final class ExplicitWorkflow
    {
        #[WorkflowMethod(name: 'php.explicit')]
        public function run(): string
        {
            return 'explicit';
        }
    }
}
