export const ADMIN_EMAILS = ["03leesun@gmail.com", "charlie9807@gmail.com"];

export function isAdminEmail(email?: string | null) {
  return ADMIN_EMAILS.includes(email ?? "");
}
