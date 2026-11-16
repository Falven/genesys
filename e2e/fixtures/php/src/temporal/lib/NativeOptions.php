<?php
declare(strict_types=1);

namespace GenesysPhp;

use Temporal\Interceptor\{ActivityInboundInterceptor, SimplePipelineProvider};
use Temporal\Interceptor\ActivityInbound\ActivityInput;
use Temporal\Worker\WorkerOptions;

final class NativeOptions implements ActivityInboundInterceptor
{
    public static function worker(): WorkerOptions
    {
        return WorkerOptions::new()->withIdentity('genesys-php-authored-options');
    }

    public static function interceptors(): SimplePipelineProvider
    {
        return new SimplePipelineProvider([new self()]);
    }

    public function handleActivityInbound(ActivityInput $input, callable $next): mixed
    {
        $result = $next($input);
        return $result === '!' ? $result : 'intercepted: ' . $result;
    }
}
