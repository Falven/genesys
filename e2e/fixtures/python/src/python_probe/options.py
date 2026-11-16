from temporalio import activity
from temporalio.worker import ActivityInboundInterceptor, ExecuteActivityInput, Interceptor


SALUTATION = "Hello"
TASK_QUEUE = "genesys-python"


class PrefixInterceptor(Interceptor):
    def intercept_activity(self, next: ActivityInboundInterceptor) -> ActivityInboundInterceptor:
        return PrefixActivity(next)


class PrefixActivity(ActivityInboundInterceptor):
    async def execute_activity(self, input: ExecuteActivityInput):
        result = await super().execute_activity(input)
        if activity.info().activity_type == "ComposeGreeting":
            return f"intercepted/{result}"
        return result
