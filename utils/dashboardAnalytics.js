/**
 * Build daily buckets for the last `days` days (UTC date keys YYYY-MM-DD).
 */
export function buildUtcDateKeys(days) {
  const keys = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() - i);
    keys.push(d.toISOString().slice(0, 10));
  }
  return keys;
}

/**
 * Mongo aggregation → array of { date, count } aligned to `dateKeys`, missing → 0.
 */
export function mergeDailyAggregation(rows, dateKeys) {
  const map = Object.fromEntries(
    (rows || []).map((r) => [r._id, r.count]),
  );
  return dateKeys.map((date) => ({ date, count: map[date] ?? 0 }));
}

/**
 * Count documents per UTC calendar day from `createdAt` since range start.
 */
export async function aggregateDailyCreatedCounts(Model, matchExtra, days) {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - days);
  const match = { createdAt: { $gte: since }, ...matchExtra };
  return Model.aggregate([
    { $match: match },
    {
      $group: {
        _id: {
          $dateToString: {
            format: "%Y-%m-%d",
            date: "$createdAt",
            timezone: "UTC",
          },
        },
        count: { $sum: 1 },
      },
    },
  ]);
}
