import { apiDelete } from "../lib/api";

export function deleteAccount(password: string): Promise<void> {
  return apiDelete("/api/account", { confirmation: "DELETE", password });
}
