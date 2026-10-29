export type RoleMeta = { label: string; color: string; bg: string };

export const ROLE_META: Record<string, RoleMeta> = {
  SUPER_ADMIN: { label: "Super Admin", color: "#dc2626", bg: "#fee2e2" },
  OWNER:       { label: "Owner",       color: "#7c3aed", bg: "#ede9fe" },
  PM:          { label: "PM",          color: "#1d4ed8", bg: "#dbeafe" },
  QA_LEAD:     { label: "QA Lead",     color: "#0891b2", bg: "#cffafe" },
  TESTER:      { label: "Tester",      color: "#15803d", bg: "#dcfce7" },
  ANALYST:     { label: "Analyst",     color: "#ca8a04", bg: "#fef9c3" },
  DEVELOPER:   { label: "Developer",   color: "#6b7280", bg: "#f3f4f6" },
  CTO:         { label: "CTO",         color: "#7c3aed", bg: "#f3e8ff" },
};

export const ALL_ROLES = Object.keys(ROLE_META);
export const NON_SA_ROLES = ALL_ROLES.filter((r) => r !== "SUPER_ADMIN");

export function roleMeta(role?: string | null): RoleMeta {
  return ROLE_META[role ?? ""] ?? { label: role ?? "—", color: "#6b7280", bg: "#f3f4f6" };
}
