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
  | "import_figma"
  | "import_blender"
  | "execute_lua";

export interface StudioCommand {
  id: string;
  type: StudioCommandType;
  payload: Record<string, unknown>;
  createdAt: number;
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
}

export class BridgeState {
  connection: StudioConnection | null = null;
  permissionLevel: string = PERMISSION_LEVEL;
  logs: LogEntry[] = [];
  private queue: StudioCommand[] = [];
  private pending = new Map<string, PendingCommand>();

  isStudioConnected(staleMs: number): boolean {
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
    };
  }

  pushLogs(entries: LogEntry[]): void {
    if (!entries || entries.length === 0) return;
    this.logs.push(...entries);
    if (this.logs.length > 500) {
      this.logs.splice(0, this.logs.length - 500);
    }
  }

  drainLogs(): LogEntry[] {
    const entries = this.logs.splice(0, this.logs.length);
    return entries;
  }

  enqueue(command: StudioCommand): StudioCommand {
    this.queue.push(command);
    return command;
  }

  dequeueAll(): StudioCommand[] {
    const commands = this.queue.splice(0, this.queue.length);
    return commands;
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

  rejectPending(id: string, error: Error): void {
    const entry = this.pending.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.pending.delete(id);
    entry.reject(error);
  }

  rejectAllPending(error: Error): void {
    for (const [id, entry] of this.pending.entries()) {
      clearTimeout(entry.timer);
      entry.reject(error);
      this.pending.delete(id);
    }
  }

  pendingCount(): number {
    return this.pending.size;
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
