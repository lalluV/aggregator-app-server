/**
 * Shared list pagination + helpers for admin JSON APIs.
 */
export function parsePagination(req, options = {}) {
  const defaultLimit = options.defaultLimit ?? 25;
  const maxLimit = options.maxLimit ?? 500;
  const page = Math.max(1, parseInt(String(req.query.page || "1"), 10) || 1);
  const rawLimit =
    parseInt(String(req.query.limit || String(defaultLimit)), 10) || defaultLimit;
  const limit = Math.min(maxLimit, Math.max(1, rawLimit));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
}

export function shouldSkipStats(req) {
  return req.query.skipStats === "1" || req.query.skipStats === "true";
}

export function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
