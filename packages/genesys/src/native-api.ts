import { Connection } from "@temporalio/client";

/** The managed development service uses its explicit local address, never ambient SDK config. */
export function nativeConnection(address: string): Connection {
  return Connection.lazy({
    address,
    tls: false,
    interceptors: [],
    channelArgs: { "grpc.max_receive_message_length": 4 * 1024 * 1024 },
  });
}

export function nativeRead<T>(
  connection: Connection,
  signal: AbortSignal | undefined,
  read: (service: Connection["workflowService"]) => Promise<T>,
): Promise<T> {
  signal?.throwIfAborted();
  const run = (): Promise<T> =>
    connection.withDeadline(Date.now() + 5_000, () => read(connection.workflowService));
  return signal ? connection.withAbortSignal(signal, run) : run();
}
