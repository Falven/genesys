from temporalio import activity


@activity.defn(name="AccidentalTestActivity")
async def test_helper() -> None:
    raise AssertionError("A native test helper entered registration")
