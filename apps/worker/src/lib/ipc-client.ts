import net from "net";

const DEFAULT_SOCKET_PATH = "/tmp/sentinel-ipc.sock";

export interface IpcResponse {
  success: boolean;
  guild?: string;
  channel?: string;
  recipient?: string;
  error?: string;
  details?: string;
}

export function sendIpcRequest(
  action: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any,
): Promise<IpcResponse> {
  return new Promise((resolve, reject) => {
    const socketPath = process.env.IPC_SOCKET_PATH || DEFAULT_SOCKET_PATH;
    const client = net.createConnection(socketPath);

    let responseData = "";

    client.on("connect", () => {
      const message = JSON.stringify({ action, payload }) + "\n";
      client.write(message);
    });

    client.on("data", (data) => {
      responseData += data.toString("utf8");
      // Check if we received the complete newline-terminated JSON response
      if (responseData.includes("\n")) {
        client.end();
      }
    });

    client.on("end", () => {
      try {
        const parsed = JSON.parse(responseData.trim());
        resolve(parsed);
      } catch (err) {
        reject(
          new Error(
            `Failed to parse IPC response: ${err instanceof Error ? err.message : String(err)}`,
          ),
        );
      }
    });

    client.on("error", (err) => {
      reject(err);
    });
  });
}
