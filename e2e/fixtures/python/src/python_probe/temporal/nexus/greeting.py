from nexusrpc import OperationError, OperationErrorState
from nexusrpc.handler import StartOperationContext, service_handler, sync_operation


@service_handler(name="GreetingService")
class GreetingHandler:
    def __init__(self, salutation: str) -> None:
        self.salutation = salutation

    @sync_operation(name="echo")
    async def echo(self, ctx: StartOperationContext, name: str) -> str:
        return f"{self.salutation}/echo/{name}"

    @sync_operation(name="reject")
    async def reject(self, ctx: StartOperationContext, name: str) -> str:
        raise OperationError(
            f"{self.salutation}/reject/{name}", state=OperationErrorState.FAILED
        )
