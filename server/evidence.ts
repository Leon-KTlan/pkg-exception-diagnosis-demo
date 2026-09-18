import type { Diagnosis, Evidence } from "../shared/protocol.js";
import type { AgentContext } from "./model.js";

export const buildEvidence = (context: AgentContext): Evidence[] => {
  const evidence: Evidence[] = [];

  if (context.packageRecord) {
    evidence.push({
      evidenceId: "EV-PKG-STATUS",
      sourceStepId: "package",
      title: "包裹已到仓",
      fact: `${context.packageRecord.packageId} 已于 ${context.packageRecord.arrivedAt} 到达${context.packageRecord.warehouseName}`,
      sourceField: "status",
      rawValue: context.packageRecord.status,
    });
  }

  if (context.receiptRecord) {
    evidence.push({
      evidenceId: "EV-RECEIPT-STATUS",
      sourceStepId: "receipt",
      title: "收货单已完成",
      fact: `${context.receiptRecord.receiptId} 已完成 ${context.receiptRecord.checkedQuantity} 件货物核对`,
      sourceField: "status",
      rawValue: context.receiptRecord.status,
    });
  }

  if (context.putawayTaskRecord) {
    evidence.push(
      {
        evidenceId: "EV-PUTAWAY-STATUS",
        sourceStepId: "putaway",
        title: "入库任务被阻塞",
        fact: `${context.putawayTaskRecord.taskId} 当前状态为 BLOCKED`,
        sourceField: "status",
        rawValue: context.putawayTaskRecord.status,
      },
      {
        evidenceId: "EV-BIN-CAPACITY",
        sourceStepId: "putaway",
        title: "目标库位容量不足",
        fact: `库位 ${context.putawayTaskRecord.targetBin} 可用容量为 ${context.putawayTaskRecord.availableCapacity}，低于所需 ${context.putawayTaskRecord.requiredCapacity}`,
        sourceField: "reasonCode",
        rawValue: context.putawayTaskRecord.reasonCode,
      },
    );
  }

  return evidence;
};

const severities = new Set(["LOW", "MEDIUM", "HIGH"]);
const priorities = new Set(["P0", "P1", "P2"]);

export const validateDiagnosis = (
  diagnosis: Diagnosis,
  evidence: Evidence[],
): string | null => {
  if (!diagnosis || typeof diagnosis !== "object") {
    return "诊断结果不是对象";
  }
  if (!["CONFIRMED", "INSUFFICIENT_EVIDENCE"].includes(diagnosis.status)) {
    return "status 不合法";
  }
  if (!diagnosis.summary?.trim() || !diagnosis.reason?.trim()) {
    return "summary 和 reason 不能为空";
  }
  if (!severities.has(diagnosis.severity)) {
    return "severity 不合法";
  }
  if (!Array.isArray(diagnosis.evidenceIds)) {
    return "evidenceIds 必须是数组";
  }

  const allowedEvidenceIds = new Set(evidence.map((item) => item.evidenceId));
  const invalidEvidence = diagnosis.evidenceIds.find(
    (evidenceId) => !allowedEvidenceIds.has(evidenceId),
  );
  if (invalidEvidence) {
    return `引用了不存在的证据 ${invalidEvidence}`;
  }
  if (
    diagnosis.status === "CONFIRMED" &&
    diagnosis.evidenceIds.length !== evidence.length
  ) {
    return "CONFIRMED 诊断必须引用全部已收集证据";
  }
  if (!Array.isArray(diagnosis.actions) || diagnosis.actions.length === 0) {
    return "actions 至少需要一项";
  }
  if (
    diagnosis.actions.some(
      (action) =>
        !action.title?.trim() ||
        !action.description?.trim() ||
        !action.owner?.trim() ||
        !priorities.has(action.priority),
    )
  ) {
    return "actions 字段不完整";
  }
  if (!Array.isArray(diagnosis.limitations)) {
    return "limitations 必须是数组";
  }
  return null;
};
