import {
  CustomHostnameApiError,
  HttpCustomHostnameClient,
} from "./custom_hostnames";

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function record(overrides: Record<string, unknown> = {}) {
  return {
    id: "ch_cf_1",
    hostname: "status.example.com",
    status: "pending",
    ssl: {
      status: "pending_validation",
      validation_errors: [{ message: "custom hostname does not CNAME to zone" }],
    },
    ...overrides,
  };
}

function client(fetcher: Fetcher): HttpCustomHostnameClient {
  return new HttpCustomHostnameClient(
    { zoneId: "zone123", apiToken: "token-abc" },
    fetcher,
  );
}

describe("HttpCustomHostnameClient", () => {
  it("creates a custom hostname with http DCV and maps the response", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const created = await client(async (input, init) => {
      calls.push({ url: String(input), init });
      return jsonResponse({ success: true, errors: [], result: record() });
    }).create("status.example.com");

    expect(calls[0]?.url).toBe(
      "https://api.cloudflare.com/client/v4/zones/zone123/custom_hostnames",
    );
    expect(calls[0]?.init?.method).toBe("POST");
    expect(new Headers(calls[0]?.init?.headers).get("authorization")).toBe(
      "Bearer token-abc",
    );
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({
      hostname: "status.example.com",
      ssl: { method: "http", type: "dv", settings: { min_tls_version: "1.2" } },
    });
    expect(created).toEqual({
      id: "ch_cf_1",
      hostname: "status.example.com",
      status: "pending",
      sslStatus: "pending_validation",
      verificationErrors: ["custom hostname does not CNAME to zone"],
    });
  });

  it("gets a custom hostname and returns null for 404", async () => {
    const found = await client(async () =>
      jsonResponse({
        success: true,
        errors: [],
        result: record({ status: "active", ssl: { status: "active" } }),
      }),
    ).get("ch_cf_1");
    expect(found?.status).toBe("active");
    expect(found?.sslStatus).toBe("active");
    expect(found?.verificationErrors).toEqual([]);

    const missing = await client(async () =>
      jsonResponse(
        { success: false, errors: [{ code: 1436, message: "not found" }] },
        404,
      ),
    ).get("ch_gone");
    expect(missing).toBeNull();
  });

  it("deletes a custom hostname and tolerates an already-deleted 404", async () => {
    const calls: string[] = [];
    await client(async (input, init) => {
      calls.push(`${init?.method} ${String(input)}`);
      return jsonResponse({ success: true, errors: [], result: { id: "ch_cf_1" } });
    }).remove("ch_cf_1");
    expect(calls).toEqual([
      "DELETE https://api.cloudflare.com/client/v4/zones/zone123/custom_hostnames/ch_cf_1",
    ]);

    await expect(
      client(async () => jsonResponse({ success: false, errors: [] }, 404)).remove(
        "ch_gone",
      ),
    ).resolves.toBeUndefined();
  });

  it("throws a typed error with Cloudflare's message on failures", async () => {
    const failing = client(async () =>
      jsonResponse(
        {
          success: false,
          errors: [{ code: 1407, message: "Invalid custom hostname" }],
        },
        400,
      ),
    );
    await expect(failing.create("bad host")).rejects.toBeInstanceOf(
      CustomHostnameApiError,
    );
    await expect(failing.create("bad host")).rejects.toThrow(
      /Invalid custom hostname/u,
    );
  });
});
