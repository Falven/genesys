import asyncio
import json
import os
import sys
from datetime import timedelta
from importlib.metadata import version
from uuid import uuid4

from temporalio.client import Client, WorkflowUpdateFailedError

from python_probe.options import TASK_QUEUE


async def run(endpoint: str, selected: str, removed: str) -> None:
    client = await Client.connect(
        os.environ["TEMPORAL_ADDRESS"], namespace=os.environ["TEMPORAL_NAMESPACE"]
    )
    settings = dict(task_queue=TASK_QUEUE, execution_timeout=timedelta(seconds=40))
    greeting = await client.start_workflow("Greeting", endpoint, id=str(uuid4()), **settings)
    try:
        await greeting.execute_update("ChooseName", "")
    except WorkflowUpdateFailedError as error:
        rejected = str(error.cause)
    else:
        raise AssertionError("The Workflow Update accepted an empty name")
    chosen = await greeting.execute_update("ChooseName", "Ada")
    result = await greeting.result()
    transform = await client.execute_workflow(
        "Transform", args=["Ada", selected], id=str(uuid4()), **settings
    )
    missing = await client.execute_workflow(
        "Transform", args=["Ada", removed], id=str(uuid4()), **settings
    )
    print(
        json.dumps(
            {
                "updateRejected": rejected,
                "updateResult": chosen,
                "greeting": result,
                "transform": transform,
                "missing": missing,
                "temporalio": version("temporalio"),
                "nexus": version("nexus-rpc"),
            }
        )
    )


if __name__ == "__main__":
    asyncio.run(run(*sys.argv[1:]))
