export const DAY_MS = 86_400_000;
export const CUSTOM_UNITS = ["days", "weeks", "months", "year"];

export function durationDays(value, unit) {
  const amount = Number(value);
  if (!Number.isInteger(amount) || amount < 1) return null;
  const factors = { days: 1, weeks: 7, months: 30, year: 365 };
  if (!factors[unit]) return null;
  return unit === "months" && amount === 12 ? 365 : amount * factors[unit];
}

export function validateCustomDuration(value, unit) {
  const days = durationDays(value, unit);
  return days && days <= 365 ? "" : "Custom duration must be between 1 day and 1 year.";
}

export function durationRequest(choice, customValue, customUnit) {
  if (choice === "none") return { sessionLimitMinutes: 0 };
  if (choice.startsWith("minutes:")) return { sessionLimitMinutes: Number(choice.slice(8)) };
  const [durationUnit, rawValue] = choice === "custom" ? [customUnit, customValue] : choice.split(":");
  const error = validateCustomDuration(rawValue, durationUnit);
  if (error) throw new Error(error);
  return { durationValue: Number(rawValue), durationUnit };
}

export function previewExpiration(choice, customValue, customUnit, now = Date.now()) {
  if (choice === "none") return null;
  if (choice.startsWith("minutes:")) return now + Number(choice.slice(8)) * 60_000;
  const request = durationRequest(choice, customValue, customUnit);
  return now + durationDays(request.durationValue, request.durationUnit) * DAY_MS;
}

export function formatDuration(profile) {
  if (profile.durationValue && profile.durationUnit) {
    const unit = profile.durationUnit === "year" ? "year" : profile.durationUnit.replace(/s$/, "");
    return `${profile.durationValue} ${unit}${profile.durationValue === 1 ? "" : "s"} session`;
  }
  if (profile.sessionLimitMinutes) {
    if (profile.sessionLimitMinutes % 60 === 0) { const hours = profile.sessionLimitMinutes / 60; return `${hours} hour${hours === 1 ? "" : "s"} session`; }
    return `${profile.sessionLimitMinutes} minute session`;
  }
  return "No expiration";
}

export function profileStatus(profile, now = Date.now()) {
  if (!profile.enabled) return "Disabled";
  if (profile.accessExpiresAt && now >= profile.accessExpiresAt) return "Expired";
  return "Enabled";
}
