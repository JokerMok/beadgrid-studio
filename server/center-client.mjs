// Adapted from zhenyi-account-center/examples/product-client.ts @237e220; server only.
/** Server-side only. Never ship the service key or user token to a browser. */
export class CenterRequestError extends Error {
  outcome;
  status;
  code;
  constructor(message, outcome, status, code) {
    super(message);
    this.outcome = outcome;
    this.status = status;
    this.code = code;
  }
}
export function createEntitlementClient(options) {
  const base = new URL(
    `/api/v1/products/${encodeURIComponent(options.productId)}`,
    options.centerUrl,
  ).href;
  async function call(token, path, body) {
    let response;
    try {
      response = await (options.fetch || fetch)(base + path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Authorization: `Bearer ${options.serviceKey}`,
          ...(token ? { "X-User-Token": token } : {}),
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(options.timeoutMs || 15000),
      });
    } catch {
      throw new CenterRequestError(
        "中心响应未知，请保留原任务并查询状态",
        "unknown",
      );
    }
    let result;
    try {
      result = await response.json();
    } catch {
      throw new CenterRequestError(
        "中心响应不完整，请查询状态",
        "unknown",
        response.status,
      );
    }
    if (!response.ok)
      throw new CenterRequestError(
        result.error || "中心请求失败",
        response.status >= 500 ? "unknown" : "rejected",
        response.status,
        result.code,
      );
    return result;
  }
  const status = (lookup) =>
    call(
      undefined,
      "/recovery/reservations?" +
        new URLSearchParams(
          Object.entries(lookup).filter(([, v]) => v !== undefined),
        ),
    );
  return {
    get: (token) => call(token, "/entitlements"),
    check: (token, feature) => call(token, "/check", { feature_id: feature }),
    reserve: (token, feature, requestId, amount = 1) =>
      call(token, "/reservations", {
        feature_id: feature,
        request_id: requestId,
        amount,
      }),
    confirm: (token, id) =>
      call(token, `/reservations/${encodeURIComponent(id)}/confirm`, {}),
    cancel: (token, id) =>
      call(token, `/reservations/${encodeURIComponent(id)}/cancel`, {}),
    refund: (token, id) =>
      call(token, `/reservations/${encodeURIComponent(id)}/refund`, {}),
    status,
    recover: (lookup, action, reason) =>
      call(undefined, "/recovery", { ...lookup, action, reason }),
    async confirmKnown(token, id) {
      try {
        return await call(
          token,
          `/reservations/${encodeURIComponent(id)}/confirm`,
          {},
        );
      } catch (error) {
        if (
          !(error instanceof CenterRequestError) ||
          error.outcome !== "unknown"
        )
          throw error;
        // A timeout is not a failed debit. Only authoritative status resolves it.
        const current = await status({ reservation_id: id });
        if (current.status === "reserved")
          return call(
            token,
            `/reservations/${encodeURIComponent(id)}/confirm`,
            {},
          );
        return current;
      }
    },
  };
}
