export interface PackageRecord {
  packageId: string;
  status: "ARRIVED_AT_WAREHOUSE";
  warehouseId: string;
  warehouseName: string;
  arrivedAt: string;
  receiptId: string;
  expectedQuantity: number;
}

export interface ReceiptRecord {
  receiptId: string;
  packageId: string;
  status: "RECEIVED";
  receivedAt: string;
  checkedQuantity: number;
  putawayTaskId: string;
}

export interface PutawayTaskRecord {
  taskId: string;
  receiptId: string;
  status: "BLOCKED";
  targetBin: string;
  reasonCode: "BIN_CAPACITY_EXCEEDED";
  requiredCapacity: number;
  availableCapacity: number;
  blockedSince: string;
}

export interface ToolContext {
  traceId: string;
  signal?: AbortSignal;
}

export interface WarehouseTool<TArgs = Record<string, unknown>, TResult = unknown> {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: TArgs, context: ToolContext) => Promise<TResult>;
}

export type ToolRegistry = Record<string, WarehouseTool>;

export class ToolTimeoutError extends Error {
  readonly code = "TOOL_TIMEOUT";

  constructor(toolName: string) {
    super(`${toolName} 查询超时`);
    this.name = "ToolTimeoutError";
  }
}

const packageRecords: Record<string, PackageRecord> = {
  "PKG-20260918": {
    packageId: "PKG-20260918",
    status: "ARRIVED_AT_WAREHOUSE",
    warehouseId: "WH-EAST-01",
    warehouseName: "华东一号仓",
    arrivedAt: "2026-09-18T09:42:16+08:00",
    receiptId: "RCV-20260918-0471",
    expectedQuantity: 12,
  },
  "PKG-TIMEOUT": {
    packageId: "PKG-TIMEOUT",
    status: "ARRIVED_AT_WAREHOUSE",
    warehouseId: "WH-EAST-01",
    warehouseName: "华东一号仓",
    arrivedAt: "2026-09-18T10:06:08+08:00",
    receiptId: "RCV-TIMEOUT-001",
    expectedQuantity: 6,
  },
};

const receiptRecords: Record<string, ReceiptRecord> = {
  "RCV-20260918-0471": {
    receiptId: "RCV-20260918-0471",
    packageId: "PKG-20260918",
    status: "RECEIVED",
    receivedAt: "2026-09-18T10:03:51+08:00",
    checkedQuantity: 12,
    putawayTaskId: "PUT-20260918-0834",
  },
  "RCV-TIMEOUT-001": {
    receiptId: "RCV-TIMEOUT-001",
    packageId: "PKG-TIMEOUT",
    status: "RECEIVED",
    receivedAt: "2026-09-18T10:19:12+08:00",
    checkedQuantity: 6,
    putawayTaskId: "PUT-TIMEOUT-001",
  },
};

const putawayTaskRecords: Record<string, PutawayTaskRecord> = {
  "PUT-20260918-0834": {
    taskId: "PUT-20260918-0834",
    receiptId: "RCV-20260918-0471",
    status: "BLOCKED",
    targetBin: "A-03-17",
    reasonCode: "BIN_CAPACITY_EXCEEDED",
    requiredCapacity: 12,
    availableCapacity: 0,
    blockedSince: "2026-09-18T10:04:27+08:00",
  },
};

export const createWarehouseTools = (): ToolRegistry => ({
  get_package: {
    name: "get_package",
    description: "根据包裹号查询包裹到仓状态和关联收货单号。",
    parameters: {
      type: "object",
      properties: {
        packageId: {
          type: "string",
          description: "需要查询的包裹号，例如 PKG-20260918。",
        },
      },
      required: ["packageId"],
      additionalProperties: false,
    },
    execute: async (args: Record<string, unknown>, context) => {
      await abortableDelay(180, context.signal);
      const packageId = String(args.packageId ?? "");
      return packageRecords[packageId] ?? null;
    },
  },
  get_receipt: {
    name: "get_receipt",
    description: "根据收货单号查询收货状态和关联入库任务。",
    parameters: {
      type: "object",
      properties: {
        receiptId: {
          type: "string",
          description: "包裹记录中返回的收货单号。",
        },
      },
      required: ["receiptId"],
      additionalProperties: false,
    },
    execute: async (args: Record<string, unknown>, context) => {
      await abortableDelay(210, context.signal);
      const receiptId = String(args.receiptId ?? "");
      return receiptRecords[receiptId] ?? null;
    },
  },
  get_putaway_task: {
    name: "get_putaway_task",
    description: "根据入库任务号查询上架状态、目标库位和阻塞原因。",
    parameters: {
      type: "object",
      properties: {
        taskId: {
          type: "string",
          description: "收货单记录中返回的入库任务号。",
        },
      },
      required: ["taskId"],
      additionalProperties: false,
    },
    execute: async (args: Record<string, unknown>, context) => {
      await abortableDelay(260, context.signal);
      const taskId = String(args.taskId ?? "");
      if (taskId === "PUT-TIMEOUT-001") {
        throw new ToolTimeoutError("get_putaway_task");
      }
      return putawayTaskRecords[taskId] ?? null;
    },
  },
});
import { abortableDelay } from "./abort.js";
