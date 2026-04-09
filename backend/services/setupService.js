/* ================================
  Setup helpers used by the /api/setup/* routes to normalize hours and
  menu input from the dashboard. Pure functions, no external deps.
================================ */

export function normalizeSetupHoursRows(rows) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const normalized = [];

  for (const row of safeRows) {
    const dayOfWeek = Number(row?.day_of_week);
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) continue;

    const isClosed = Boolean(row?.is_closed);
    const openTime = String(row?.open_time || "").trim();
    const closeTime = String(row?.close_time || "").trim();

    normalized.push({
      day_of_week: dayOfWeek,
      is_closed: isClosed,
      open_time: isClosed ? null : openTime || null,
      close_time: isClosed ? null : closeTime || null,
    });
  }

  if (!normalized.length) {
    return Array.from({ length: 7 }).map((_, day) => ({
      day_of_week: day,
      is_closed: false,
      open_time: "09:00",
      close_time: "17:00",
    }));
  }

  return normalized;
}

export function normalizeSetupMenuItems(items) {
  const safeItems = Array.isArray(items) ? items : [];
  const normalized = [];

  for (const raw of safeItems) {
    const name = String(raw?.name || "").trim();
    if (!name) continue;

    const rawPrice = raw?.price;
    const parsedPrice =
      rawPrice === null || rawPrice === undefined || rawPrice === ""
        ? null
        : Number(rawPrice);

    normalized.push({
      name,
      price: Number.isFinite(parsedPrice) ? parsedPrice : null,
      description: String(raw?.description || "").trim() || null,
      category: String(raw?.category || "").trim() || null,
    });
  }

  return normalized.slice(0, 300);
}
