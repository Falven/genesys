<?php
declare(strict_types=1);

namespace GenesysPhp;

use Temporal\Activity\{ActivityInterface as Activities, ActivityMethod as ActivityName};

#[Activities(prefix: 'php.greeting.')]
interface Greeting
{
    #[ActivityName(name: 'compose')]
    public function greet(string $name): string;

    public function suffix(): string;
}

final class GreetingActivities implements Greeting
{
    public function __construct(private readonly string $prefix)
    {
        record('constructor');
    }

    public function greet(string $name): string
    {
        return $this->prefix . ' ' . $name;
    }

    public function suffix(): string
    {
        return '!';
    }
}
