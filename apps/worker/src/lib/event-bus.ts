import { EventEmitter } from "events";
import type { TornSchema } from "@sentinel/shared";

// Strongly type the event emitter
interface WorkerEvents {
  new_log: (log: TornSchema<"UserLog">) => void;
  reinit_ledger: (ledger: string) => void;
  settings_updated: () => void;
  wealth_init: () => void;
  wealth_heal: () => void;
}

class TypedEventEmitter extends EventEmitter {
  public emit<K extends keyof WorkerEvents>(
    eventName: K,
    ...args: Parameters<WorkerEvents[K]>
  ): boolean {
    return super.emit(eventName, ...args);
  }

  public on<K extends keyof WorkerEvents>(
    eventName: K,
    listener: WorkerEvents[K],
  ): this {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return super.on(eventName, listener as any);
  }

  public once<K extends keyof WorkerEvents>(
    eventName: K,
    listener: WorkerEvents[K],
  ): this {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return super.once(eventName, listener as any);
  }
}

/**
 * Global internal event bus for the Worker process.
 * Used for zero-latency Pub/Sub communication between child workers.
 */
export const workerEvents = new TypedEventEmitter();
