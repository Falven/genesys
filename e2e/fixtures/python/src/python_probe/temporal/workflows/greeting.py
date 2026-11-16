from datetime import timedelta

from temporalio import workflow as wf
from temporalio.common import RetryPolicy
from temporalio.exceptions import ActivityError, ApplicationError, NexusOperationError


@wf.defn(name="Greeting")
class Greeting:
    def __init__(self) -> None:
        self.name = ""

    @wf.update(name="ChooseName")
    def choose(self, name: str) -> str:
        self.name = name
        return name

    @choose.validator
    def validate_name(self, name: str) -> None:
        if not name:
            raise ApplicationError("A nonempty name is required")

    @wf.run
    async def run(self, endpoint: str) -> list[str]:
        await wf.wait_condition(lambda: bool(self.name))
        results = []
        for activity in ("ComposeGreeting", "ExplicitGreeting"):
            results.append(
                await wf.execute_activity(
                    activity,
                    self.name,
                    result_type=str,
                    start_to_close_timeout=timedelta(seconds=10),
                )
            )
        nexus = wf.create_nexus_client(endpoint=endpoint, service="GreetingService")
        results.append(
            await nexus.execute_operation(
                "echo", self.name, output_type=str, schedule_to_close_timeout=timedelta(seconds=15)
            )
        )
        try:
            await nexus.execute_operation(
                "reject", self.name, schedule_to_close_timeout=timedelta(seconds=15)
            )
        except NexusOperationError as error:
            results.append(str(error.cause))
        return results


@wf.defn(name="Transform")
class Transform:
    @wf.run
    async def run(self, name: str, activity: str) -> str:
        try:
            return await wf.execute_activity(
                activity,
                name,
                result_type=str,
                start_to_close_timeout=timedelta(seconds=10),
                retry_policy=RetryPolicy(maximum_attempts=1),
            )
        except ActivityError as error:
            cause = error.cause
            if isinstance(cause, ApplicationError) and cause.type == "NotFoundError":
                return cause.message
            raise
