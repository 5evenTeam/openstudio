import {
  MAX_LOG_ENTRIES,
  COMMAND_QUEUE_LIMIT,
  MAX_LONG_POLL_MS,
  HEARTBEAT_STALE_MS,
} from "../config.js";
import { PERMISSION_LEVEL } from "../config.js";

export type StudioCommandType =
  | "status"
  | "list_scripts"
  | "read_script"
  | "write_script"
  | "create_script"
  | "delete_script"
  | "get_selection"
  | "get_instance_tree"
  | "create_instance"
  | "set_property"
  | "delete_instance"
  | "rename_instance"
  | "search_instances"
  | "inspect_instance"
  | "import_ui"
  | "import_blender"
  | "execute_lua";

export interface StudioCommand {
  id: string;
  type: StudioCommandType;
  payload: Record<string, unknown>;
  createdAt: number;
  expiresAt?: number;
}

export interface StudioResult {
  id: string;
  ok: boolean;
  data?: unknown;
  error?: string;
}

export interface StudioConnection {
  clientId: string;
  lastHeartbeat: number;
  version?: string;
  capabilities?: string[];
  gameName?: string;
  gameId?: number;
  placeId?: number;
  protocolVersion?: number;
}

interface PendingCommand {
  resolve: (result: StudioResult) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export interface LogEntry {
  timestamp: number;
  message: string;
  messageType?: string;
  source?: string;
}

export class BridgeState {
  connection: StudioConnection | null = null;
  permissionLevel: string = PERMISSION_LEVEL;
  logs: LogEntry[] = [];
  private queue: StudioCommand[] = [];
  private pending = new Map<string, PendingCommand>();
  private waiters: Array<{
    resolve: (commands: StudioCommand[]) => void;
    timer: NodeJS.Timeout;
    settled: boolean;
  }> = [];
  private commandCounter = 0;

  isStudioConnected(staleMs: number = HEARTBEAT_STALE_MS): boolean {
    if (!this.connection) return false;
    return Date.now() - this.connection.lastHeartbeat <= staleMs;
  }

  setHeartbeat(
    clientId: string,
    version?: string,
    capabilities?: string[],
    metadata?: { gameName?: string; gameId?: number; placeId?: number },
  ): void {
    this.connection = {
      clientId,
      lastHeartbeat: Date.now(),
      version,
      capabilities,
      gameName: metadata?.gameName,
      gameId: metadata?.gameId,
      placeId: metadata?.placeId,
      protocolVersion: 2,
    };
  }

  pushLogs(entries: LogEntry[]): void {
    if (!entries || entries.length === 0) return;
    this.logs.push(...entries);
    if (this.logs.length > MAX_LOG_ENTRIES) {
      this.logs.splice(0, this.logs.length - MAX_LOG_ENTRIES);
    }
  }

  drainLogs(filter?: { messageType?: string; since?: number; limit?: number }): LogEntry[] {
    let entries = this.logs.splice(0, this.logs.length);
    if (filter?.messageType) {
      entries = entries.filter((entry) => entry.messageType === filter.messageType);
    }
    if (typeof filter?.since === "number") {
      entries = entries.filter((entry) => entry.timestamp >= filter.since!);
    }
    if (typeof filter?.limit === "number") {
      entries = entries.slice(Math.max(0, entries.length - filter.limit));
    }
    return entries;
  }

  peekLogs(): LogEntry[] {
    return [...this.logs];
  }

  enqueue(command: StudioCommand): StudioCommand {
    if (this.queue.length >= COMMAND_QUEUE_LIMIT) {
      throw new Error("OpenStudio command queue is full");
    }
    this.queue.push(command);
    this.notifyWaiter();
    return command;
  }

  dequeueAll(limit?: number): StudioCommand[] {
    const count = typeof limit === "number" ? Math.max(0, Math.min(this.queue.length, limit)) : this.queue.length;
    return this.queue.splice(0, count);
  }

  waitForCommands(timeoutMs: number): Promise<StudioCommand[]> {
    const clamped = Math.max(1, Math.min(timeoutMs, MAX_LONG_POLL_MS));
    const available = this.dequeueAll();
    if (available.length > 0) {
      return Promise.resolve(available);
    }

    return new Promise<StudioCommand[]>((resolve) => {
      const waiter: { resolve: (commands: StudioCommand[]) => void; timer: NodeJS.Timeout; settled: boolean } = {
        resolve,
        timer: null as unknown as NodeJS.Timeout,
        settled: false,
      };
      waiter.timer = setTimeout(() => {
        if (waiter.settled) return;
        waiter.settled = true;
        const index = this.waiters.indexOf(waiter);
        if (index >= 0) {
          this.waiters.splice(index, 1);
        }
        resolve([]);
      }, clamped);
      this.waiters.push(waiter);
    });
  }

  private notifyWaiter(): void {
    while (this.waiters.length > 0 && this.queue.length > 0) {
      const waiter = this.waiters.shift()!;
      if (waiter.settled) continue;
      waiter.settled = true;
      clearTimeout(waiter.timer);
      const commands = this.queue.splice(0, this.queue.length);
      waiter.resolve(commands);
    }
  }

  addPending(
    id: string,
    resolve: (result: StudioResult) => void,
    reject: (error: Error) => void,
    timer: NodeJS.Timeout,
  ): void {
    this.pending.set(id, { resolve, reject, timer });
  }

  resolvePending(result: StudioResult): boolean {
    const entry = this.pending.get(result.id);
    if (!entry) return false;
    clearTimeout(entry.timer);
    this.pending.delete(result.id);
    entry.resolve(result);
    return true;
  }

  resolvePendingMany(results: StudioResult[]): number {
    let accepted = 0;
    for (const result of results) {
      if (this.resolvePending(result)) {
        accepted += 1;
      }
    }
    return accepted;
  }

  rejectPending(id: string, error: Error): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(id);
    entry.reject(error);
  }

  rejectAllPending(error: Error): void {
    for (const [id, entry] of [...this.pending.entries()]) {
      clearTimeout(entry.timer);
      entry.reject(error);
      this.pending.delete(id);
    }
  }

  pendingCount(): number {
    return this.pending.size;
  }

  queueSize(): number {
    return this.queue.length;
  }

  nextCommandNumber(): number {
    this.commandCounter += 1;
    return this.commandCounter;
  }

  setPermissionLevel(level: string): boolean {
    if (level !== "read-only" && level !== "scripts-only" && level !== "full-edit") {
      return false;
    }
    this.permissionLevel = level;
    return true;
  }

  hasPermission(required: "read-only" | "scripts-only" | "full-edit"): boolean {
    const order = ["read-only", "scripts-only", "full-edit"];
    return order.indexOf(this.permissionLevel) >= order.indexOf(required);
  }
}

