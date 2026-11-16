from temporalio import activity


class Greeter:
    def __init__(self, salutation: str) -> None:
        self.salutation = salutation

    @activity.defn(name="ComposeGreeting")
    async def compose(self, name: str) -> str:
        return f"{self.salutation}, {name}!"

    @activity.defn(name="UppercaseGreeting")
    async def uppercase(self, greeting: str) -> str:
        return greeting.upper()
