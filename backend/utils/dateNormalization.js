const WEEKDAY_INDEX = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const WORD_TO_NUMBER = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

function toIsoDateFromDate(dateObj) {
  const y = dateObj.getUTCFullYear();
  const m = String(dateObj.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dateObj.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function toTimeFromDate(dateObj) {
  const hh = String(dateObj.getUTCHours()).padStart(2, "0");
  const mm = String(dateObj.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function getZonedNow(timeZone) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    weekday: "long",
  });

  const parts = formatter.formatToParts(new Date());
  const valueByType = {};
  for (const part of parts) {
    if (part.type !== "literal") valueByType[part.type] = part.value;
  }

  const year = Number(valueByType.year);
  const month = Number(valueByType.month);
  const day = Number(valueByType.day);
  const hour = Number(valueByType.hour);
  const minute = Number(valueByType.minute);
  const second = Number(valueByType.second);
  const weekdayName = String(valueByType.weekday || "").toLowerCase();
  const weekday = WEEKDAY_INDEX[weekdayName];

  return {
    date: new Date(Date.UTC(year, month - 1, day, hour, minute, second || 0)),
    weekday: Number.isInteger(weekday) ? weekday : null,
  };
}

function parseRelativeHours(text) {
  const match = text.match(/\bin\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+hours?\b/);
  if (!match) return null;
  const raw = String(match[1] || "").toLowerCase();
  if (/^\d+$/.test(raw)) return Number(raw);
  return WORD_TO_NUMBER[raw] || null;
}

export function normalizeDateInput(inputText, { timeZone } = {}) {
  try {
    const source = String(inputText || "").trim();
    if (!source) return null;

    const lower = source.toLowerCase();
    const tz = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    const { date: zonedNow, weekday: currentWeekday } = getZonedNow(tz);

    if (lower === "today" || lower === "tonight") {
      return {
        date: toIsoDateFromDate(zonedNow),
        time: null,
      };
    }

    if (lower === "tomorrow") {
      const next = new Date(zonedNow);
      next.setUTCDate(next.getUTCDate() + 1);
      return {
        date: toIsoDateFromDate(next),
        time: null,
      };
    }

    const nextDayMatch = lower.match(/\bnext\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
    if (nextDayMatch && currentWeekday !== null) {
      const target = WEEKDAY_INDEX[nextDayMatch[1]];
      let delta = (target - currentWeekday + 7) % 7;
      if (delta === 0) delta = 7;
      const next = new Date(zonedNow);
      next.setUTCDate(next.getUTCDate() + delta);
      return {
        date: toIsoDateFromDate(next),
        time: null,
      };
    }

    if (lower.includes("this weekend") && currentWeekday !== null) {
      let delta = (6 - currentWeekday + 7) % 7;
      if (currentWeekday === 0) delta = 0; // Sunday still considered this weekend.
      const next = new Date(zonedNow);
      next.setUTCDate(next.getUTCDate() + delta);
      return {
        date: toIsoDateFromDate(next),
        time: null,
      };
    }

    const hoursAhead = parseRelativeHours(lower);
    if (Number.isFinite(hoursAhead) && hoursAhead > 0) {
      const next = new Date(zonedNow);
      next.setUTCHours(next.getUTCHours() + hoursAhead);
      return {
        date: toIsoDateFromDate(next),
        time: toTimeFromDate(next),
      };
    }

    return null;
  } catch {
    return null;
  }
}

export function normalizeBookingExtractionDate(extractedData, { timeZone } = {}) {
  try {
    if (!extractedData || typeof extractedData !== "object") return extractedData;
    if (extractedData.intent !== "booking") return extractedData;

    const rawDate = String(extractedData.date || "").trim();
    if (!rawDate) return extractedData;

    const normalized = normalizeDateInput(rawDate, { timeZone });
    if (!normalized?.date) return extractedData;

    return {
      ...extractedData,
      date: normalized.date,
      time: extractedData.time || normalized.time || extractedData.time,
    };
  } catch {
    return extractedData;
  }
}
