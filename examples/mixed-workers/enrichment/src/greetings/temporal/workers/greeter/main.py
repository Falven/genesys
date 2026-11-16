import asyncio
import logging
import os
import signal
from datetime import timedelta

from temporalio.client import Client
from temporalio.worker import Worker

from greetings.temporal.activities.greeting import Greeter
from gsys_generated_84f738e1198c.activities import registrations


async def main() -> None:
    client = await Client.connect(
        os.environ.get("TEMPORAL_ADDRESS", "localhost:7233"),
        namespace=os.environ.get("TEMPORAL_NAMESPACE", "default"),
    )
    stopped = asyncio.Event()
    loop = asyncio.get_running_loop()
    for event in (signal.SIGINT, signal.SIGTERM):
        signal.signal(event, lambda *_: loop.call_soon_threadsafe(stopped.set))
    async with Worker(
        client,
        task_queue="greetings",
        activities=registrations(Greeter("Hello")),
        graceful_shutdown_timeout=timedelta(seconds=30),
    ):
        await stopped.wait()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(main())
