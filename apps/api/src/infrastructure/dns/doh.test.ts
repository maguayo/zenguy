import { DohCnameResolver } from "./doh";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/dns-json" },
  });
}

describe("DohCnameResolver", () => {
  it("resolves the first CNAME answer, normalized", async () => {
    const calls: string[] = [];
    const resolver = new DohCnameResolver(async (input, init) => {
      calls.push(String(input));
      expect(new Headers(init?.headers).get("accept")).toBe("application/dns-json");
      return jsonResponse({
        Status: 0,
        Answer: [
          { name: "status.example.com", type: 5, data: "Customers.Zenguy.com." },
        ],
      });
    });
    await expect(resolver.resolve("status.example.com")).resolves.toBe(
      "customers.zenguy.com",
    );
    expect(calls[0]).toBe(
      "https://cloudflare-dns.com/dns-query?name=status.example.com&type=CNAME",
    );
  });

  it("returns null when there is no CNAME answer or the lookup fails", async () => {
    await expect(
      new DohCnameResolver(async () =>
        jsonResponse({ Status: 3, Answer: [] }),
      ).resolve("status.example.com"),
    ).resolves.toBeNull();
    await expect(
      new DohCnameResolver(async () =>
        jsonResponse({
          Status: 0,
          Answer: [{ name: "status.example.com", type: 1, data: "192.0.2.1" }],
        }),
      ).resolve("status.example.com"),
    ).resolves.toBeNull();
    await expect(
      new DohCnameResolver(async () => new Response("boom", { status: 500 })).resolve(
        "status.example.com",
      ),
    ).resolves.toBeNull();
    await expect(
      new DohCnameResolver(async () => {
        throw new Error("network down");
      }).resolve("status.example.com"),
    ).resolves.toBeNull();
  });
});
