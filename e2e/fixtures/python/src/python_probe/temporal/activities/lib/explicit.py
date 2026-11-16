from temporalio import activity


@activity.defn(name="ExplicitGreeting")
async def explicit(name: str) -> str:
    return f"explicit/{name}"
