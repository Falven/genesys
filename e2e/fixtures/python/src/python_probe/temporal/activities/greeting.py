from temporalio.activity import defn as activity


COMPOSE = "ComposeGreeting"


class Greeter:
    def __init__(self, salutation: str) -> None:
        self.salutation = salutation

    @activity(name=COMPOSE)
    async def __compose(self, name: str) -> str:
        return f"{self.salutation}, {name}!"


@activity(name="LegacyTransform")
async def legacy(name: str) -> str:
    return name.upper()
