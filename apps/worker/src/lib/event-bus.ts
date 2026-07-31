import { EventEmitter } from "events";

/**
 * Strongly-typed event signatures for Worker V2 inter-module communication.
 */
export type WorkerEvents = {
  new_log: (log: any) => void;
  settings_updated: () => void;
  reinit_ledger: (ledger: string) => void;
  wealth_init: () => void;
  log_backfill_completed: () => void;
  live_state_updated: () => void;
  company_pay_received: () => void;
  key_invalidated: (apiKey: string, userId: number) => void;
};

type EventListener = (...args: unknown[]) => void;

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
    return super.on(eventName, listener as EventListener);
  }

  public once<K extends keyof WorkerEvents>(
    eventName: K,
    listener: WorkerEvents[K],
  ): this {
    return super.once(eventName, listener as EventListener);
  }

  public off<K extends keyof WorkerEvents>(
    eventName: K,
    listener: WorkerEvents[K],
  ): this {
    return super.off(eventName, listener as EventListener);
  }
}

/**
 * Global in-process event bus for Worker V2 modules.
 */
export const workerEvents = new TypedEventEmitter();
