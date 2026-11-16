<?php
declare(strict_types=1);

use GenesysPhp\{ExplicitWorkflow, GreetingActivities, NativeOptions};
use Temporal\WorkerFactory;

ini_set('display_errors', 'stderr');
$package = dirname(__DIR__, 2);
require $package . '/vendor/autoload.php';

$registration = getenv('GENESYS_PHP_REGISTRATION');
if ($registration === false) {
    $paths = glob($package . '/.gsys/compile/php/*/registration.php');
    if (count($paths) !== 1) {
        throw new RuntimeException('Set GENESYS_PHP_REGISTRATION to this package registration path.');
    }
    [$registration] = $paths;
}
$register = require $registration;

$factory = WorkerFactory::create();
$worker = $factory->newWorker(
    'genesys-php',
    options: NativeOptions::worker(),
    interceptorProvider: NativeOptions::interceptors(),
);
$worker->registerWorkflowTypes(ExplicitWorkflow::class);

$activities = new GreetingActivities('factory');
$register($worker, static function (ReflectionClass $type) use ($activities): GreetingActivities {
    if ($type->getName() !== $activities::class) {
        throw new LogicException('Unexpected generated Activity: ' . $type->getName());
    }
    GenesysPhp\record('factory');
    return $activities;
});
$factory->run();
