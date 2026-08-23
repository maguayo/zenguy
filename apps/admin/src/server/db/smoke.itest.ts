import { env } from "cloudflare:test";

it("boots the local D1 binding with the real apps/api migrations applied", async () => {
  const row = await env.DB.prepare(
    "SELECT COUNT(*) AS total FROM runner_workers",
  ).first<{ total: number }>();
  expect(row?.total).toBe(0);
});
