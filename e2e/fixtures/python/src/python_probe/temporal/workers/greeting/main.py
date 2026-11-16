import asyncio
import json
import os
import signal
import sys
from pathlib import Path

from temporalio.client import Client
from temporalio.worker import Worker

from gsys_generated_5909144ccd67 import activities, nexus, workflows
from python_probe import options
from python_probe.temporal.activities.greeting import Greeter
from python_probe.temporal.activities.lib.explicit import explicit
from python_probe.temporal.nexus.greeting import GreetingHandler


async def run() -> None:
    client = await Client.connect(
        os.environ["TEMPORAL_ADDRESS"], namespace=os.environ["TEMPORAL_NAMESPACE"]
    )
    stopped = asyncio.Event()
    loop = asyncio.get_running_loop()
    for event in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(event, stopped.set)
    async with Worker(
        client,
        task_queue=options.TASK_QUEUE,
        workflows=workflows.registrations(),
        activities=(*activities.registrations(Greeter(options.SALUTATION)), explicit),
        nexus_service_handlers=nexus.registrations(GreetingHandler(options.SALUTATION)),
        interceptors=[options.PrefixInterceptor()],
    ):
        print(
            json.dumps(
                {
                    "cwd": str(Path.cwd()),
                    "prefix": sys.prefix,
                    "python": sys.executable,
                    "options": str(Path(options.__file__).resolve()),
                    "registration": str(Path(activities.__file__).resolve()),
                }
            ),
            flush=True,
        )
        await stopped.wait()


def main() -> None:
    asyncio.run(run())
