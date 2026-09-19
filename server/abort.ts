export class ClientDisconnectedError extends Error {
  readonly code = "CLIENT_DISCONNECTED";

  constructor() {
    super("客户端连接已断开");
    this.name = "ClientDisconnectedError";
  }
}

export class DiagnosisTimeoutError extends Error {
  readonly code = "DIAGNOSIS_TIMEOUT";

  constructor() {
    super("整体诊断超时");
    this.name = "DiagnosisTimeoutError";
  }
}

export const getAbortReason = (signal?: AbortSignal) => {
  if (!signal?.aborted) return new Error("操作已取消");
  return signal.reason instanceof Error ? signal.reason : new Error("操作已取消");
};

export const createChildAbortController = (
  parent: AbortSignal | undefined,
  timeoutMs: number,
  timeoutError: Error,
) => {
  const controller = new AbortController();
  let timedOut = false;
  const timeoutId = setTimeout(() => {
    timedOut = true;
    controller.abort(timeoutError);
  }, timeoutMs);

  const abortFromParent = () => controller.abort(getAbortReason(parent));
  if (parent?.aborted) {
    abortFromParent();
  } else {
    parent?.addEventListener("abort", abortFromParent, { once: true });
  }

  return {
    signal: controller.signal,
    didTimeout: () => timedOut,
    cleanup: () => {
      clearTimeout(timeoutId);
      parent?.removeEventListener("abort", abortFromParent);
    },
  };
};

export const abortableDelay = (milliseconds: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(getAbortReason(signal));
      return;
    }

    const timeoutId = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timeoutId);
      signal?.removeEventListener("abort", abort);
      reject(getAbortReason(signal));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });

export const raceWithAbort = async <T>(
  operation: Promise<T>,
  signal?: AbortSignal,
) => {
  if (!signal) return operation;
  if (signal.aborted) {
    operation.catch(() => undefined);
    throw getAbortReason(signal);
  }

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener("abort", onAbort);
      reject(getAbortReason(signal));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
};
