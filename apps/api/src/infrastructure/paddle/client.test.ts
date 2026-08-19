import {
  HttpPaddleClient,
  type PaddleFetch,
} from "./client";

interface RecordedRequest {
  url: string;
  init: RequestInit | undefined;
}

class RecordingFetch {
  readonly requests: RecordedRequest[] = [];

  constructor(private readonly responses: Response[]) {}

  readonly fetch: PaddleFetch = async (url, init) => {
    this.requests.push({ url, init });
    const response = this.responses.shift();
    if (response === undefined) throw new Error("No recorded response");
    return response;
  };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function bodyOf(request: RecordedRequest): unknown {
  return JSON.parse(String(request.init?.body));
}

describe("HttpPaddleClient", () => {
  it("sends the documented requests and maps transaction totals", async () => {
    const recorder = new RecordingFetch([
      jsonResponse({
        data: {
          product_id: "pro_overage",
          description: "Extra browser runs",
          name: "Extra browser runs",
          billing_cycle: null,
          tax_mode: "account_setting",
          unit_price: { amount: "20", currency_code: "EUR" },
          unit_price_overrides: [],
          custom_data: { catalog_reference: "overage" },
        },
      }),
      jsonResponse({ data: { id: "sub_123" } }),
      jsonResponse({ data: { id: "sub_123", status: "canceled" } }),
      jsonResponse({
        data: {
          management_urls: {
            update_payment_method: "https://paddle.test/update-payment",
            cancel: "https://paddle.test/cancel-subscription",
          },
        },
      }),
      jsonResponse({
        data: [
          {
            id: "txn_123",
            billed_at: "2026-08-01T00:00:00Z",
            status: "paid",
            currency_code: "EUR",
            invoice_number: "INV-123",
            details: { totals: { grand_total: "3900" } },
          },
        ],
      }),
      jsonResponse({ data: { url: "https://paddle.test/invoice.pdf" } }),
    ]);
    const client = new HttpPaddleClient(
      {
        apiBase: "https://sandbox-api.paddle.com",
        apiKey: "pdl_test_key",
      },
      recorder.fetch,
    );

    await expect(
      client.createOneTimeCharge(
        "sub_123",
        "pri_overage",
        7,
        "zenguy:overage:v1:ws_123:1000",
      ),
    ).resolves.toEqual({ transactionId: null });
    await client.cancelSubscription("sub_123");
    await expect(
      client.getSubscriptionManagementUrls("sub_123"),
    ).resolves.toEqual({
      updatePaymentMethodUrl: "https://paddle.test/update-payment",
      cancelUrl: "https://paddle.test/cancel-subscription",
    });
    await expect(
      client.listBilledTransactions("sub_123", 5),
    ).resolves.toEqual([
      {
        id: "txn_123",
        billedAt: "2026-08-01T00:00:00Z",
        status: "paid",
        totalCents: 3900,
        currency: "EUR",
        invoiceNumber: "INV-123",
      },
    ]);
    await expect(client.getInvoicePdfUrl("txn_123")).resolves.toBe(
      "https://paddle.test/invoice.pdf",
    );

    const [price, charge, cancel, management, list, invoice] =
      recorder.requests;
    expect(price?.url).toBe(
      "https://sandbox-api.paddle.com/prices/pri_overage",
    );
    expect(price?.init?.method).toBe("GET");
    expect(charge?.url).toBe(
      "https://sandbox-api.paddle.com/subscriptions/sub_123/charge",
    );
    expect(charge?.init?.method).toBe("POST");
    expect(bodyOf(charge as RecordedRequest)).toEqual({
      effective_from: "immediately",
      items: [
        {
          quantity: 7,
          price: {
            product_id: "pro_overage",
            description: "Extra browser runs",
            name: "Extra browser runs",
            tax_mode: "account_setting",
            unit_price: { amount: "20", currency_code: "EUR" },
            unit_price_overrides: [],
            quantity: { minimum: 1, maximum: 999_999_999 },
            custom_data: {
              catalog_reference: "overage",
              zenguy_overage_marker: "zenguy:overage:v1:ws_123:1000",
            },
          },
        },
      ],
    });

    expect(cancel?.url).toBe(
      "https://sandbox-api.paddle.com/subscriptions/sub_123/cancel",
    );
    expect(cancel?.init?.method).toBe("POST");
    expect(bodyOf(cancel as RecordedRequest)).toEqual({
      effective_from: "immediately",
    });

    expect(management?.url).toBe(
      "https://sandbox-api.paddle.com/subscriptions/sub_123",
    );
    expect(management?.init?.method).toBe("GET");

    const listUrl = new URL(list?.url ?? "");
    expect(`${listUrl.origin}${listUrl.pathname}`).toBe(
      "https://sandbox-api.paddle.com/transactions",
    );
    expect(Object.fromEntries(listUrl.searchParams)).toEqual({
      subscription_id: "sub_123",
      status: "billed,paid,completed",
      order_by: "billed_at[DESC]",
      per_page: "5",
    });
    expect(list?.init?.method).toBe("GET");

    expect(invoice?.url).toBe(
      "https://sandbox-api.paddle.com/transactions/txn_123/invoice",
    );
    expect(invoice?.init?.method).toBe("GET");

    for (const request of recorder.requests) {
      const headers = new Headers(request.init?.headers);
      expect(headers.get("Authorization")).toBe("Bearer pdl_test_key");
      expect(headers.get("Content-Type")).toBe("application/json");
      expect(headers.get("Paddle-Version")).toBe("1");
    }
  });

  it("finds a marked subscription charge across every Paddle page", async () => {
    const next =
      "https://sandbox-api.paddle.com/transactions?subscription_id=sub_123&origin=subscription_charge&after=txn_cursor&per_page=30";
    const recorder = new RecordingFetch([
      jsonResponse({
        data: [
          {
            id: "txn_other",
            origin: "subscription_charge",
            custom_data: { zenguy_overage_marker: "target-marker" },
            items: [
              {
                price: {
                  custom_data: {
                    zenguy_overage_marker: "another-marker",
                  },
                },
              },
            ],
          },
        ],
        meta: { pagination: { has_more: true, next } },
      }),
      jsonResponse({
        data: [
          {
            id: "txn_overage",
            origin: "subscription_charge",
            custom_data: null,
            items: [
              {
                price: {
                  custom_data: {
                    zenguy_overage_marker: "target-marker",
                  },
                },
              },
            ],
          },
        ],
        meta: { pagination: { has_more: false, next } },
      }),
    ]);
    const client = new HttpPaddleClient(
      {
        apiBase: "https://sandbox-api.paddle.com",
        apiKey: "pdl_test_key",
      },
      recorder.fetch,
    );

    await expect(
      client.findSubscriptionChargeByMarker("sub_123", "target-marker"),
    ).resolves.toEqual({ transactionId: "txn_overage" });

    const firstUrl = new URL(recorder.requests[0]?.url ?? "");
    expect(`${firstUrl.origin}${firstUrl.pathname}`).toBe(
      "https://sandbox-api.paddle.com/transactions",
    );
    expect(Object.fromEntries(firstUrl.searchParams)).toEqual({
      subscription_id: "sub_123",
      origin: "subscription_charge",
      order_by: "id[DESC]",
      per_page: "30",
    });
    expect(recorder.requests[1]?.url).toBe(next);
    for (const request of recorder.requests) {
      const headers = new Headers(request.init?.headers);
      expect(headers.get("Skip-Count")).toBe("true");
      expect(headers.get("Paddle-Version")).toBe("1");
    }
  });

  it("constrains catalog display fields to the documented non-catalog limits", async () => {
    const recorder = new RecordingFetch([
      jsonResponse({
        data: {
          product_id: "pro_overage",
          description: "d".repeat(500),
          name: "n".repeat(150),
          billing_cycle: null,
          tax_mode: "account_setting",
          unit_price: { amount: "20", currency_code: "EUR" },
          unit_price_overrides: [],
          custom_data: null,
        },
      }),
      jsonResponse({ data: { id: "sub_123" } }),
    ]);
    const client = new HttpPaddleClient(
      {
        apiBase: "https://sandbox-api.paddle.com",
        apiKey: "pdl_test_key",
      },
      recorder.fetch,
    );

    await client.createOneTimeCharge(
      "sub_123",
      "pri_overage",
      1,
      "report-marker",
    );

    const body = bodyOf(recorder.requests[1] as RecordedRequest) as {
      items: { price: { description: string; name: string } }[];
    };
    expect(body.items[0]?.price.description).toHaveLength(200);
    expect(body.items[0]?.price.name).toHaveLength(50);
  });

  it.each([
    {
      label: "amount",
      unitPrice: { amount: "21", currency_code: "EUR" },
      overrides: [],
    },
    {
      label: "currency",
      unitPrice: { amount: "20", currency_code: "USD" },
      overrides: [],
    },
    {
      label: "localized override",
      unitPrice: { amount: "20", currency_code: "EUR" },
      overrides: [
        {
          country_codes: ["US"],
          unit_price: { amount: "25", currency_code: "USD" },
        },
      ],
    },
  ])("rejects a mismatched overage price $label before POSTing", async ({
    unitPrice,
    overrides,
  }) => {
    const recorder = new RecordingFetch([
      jsonResponse({
        data: {
          product_id: "pro_overage",
          description: "Extra browser runs",
          name: "Extra browser runs",
          billing_cycle: null,
          tax_mode: "account_setting",
          unit_price: unitPrice,
          unit_price_overrides: overrides,
          custom_data: null,
        },
      }),
    ]);
    const client = new HttpPaddleClient(
      {
        apiBase: "https://sandbox-api.paddle.com",
        apiKey: "pdl_test_key",
      },
      recorder.fetch,
    );

    await expect(
      client.createOneTimeCharge(
        "sub_123",
        "pri_overage",
        1,
        "report-marker",
      ),
    ).rejects.toThrow("paddle overage price misconfigured");
    expect(recorder.requests).toHaveLength(1);
  });

  it("reports the required Prices Read permission without exposing Paddle's body", async () => {
    const recorder = new RecordingFetch([
      jsonResponse(
        { error: { detail: "customer alice@example.com lacks access" } },
        403,
      ),
    ]);
    const client = new HttpPaddleClient(
      {
        apiBase: "https://sandbox-api.paddle.com",
        apiKey: "pdl_test_key",
      },
      recorder.fetch,
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await expect(
      client.createOneTimeCharge(
        "sub_123",
        "pri_overage",
        1,
        "report-marker",
      ),
    ).rejects.toThrow("paddle price.read permission required");

    const logged = String(log.mock.calls[0]?.[0]);
    expect(logged).not.toContain("alice@example.com");
    expect(logged).not.toContain("lacks access");
    expect(
      new Headers(recorder.requests[0]?.init?.headers).get("Paddle-Version"),
    ).toBe("1");
    log.mockRestore();
  });

  it("accepts a null update-payment URL for manual subscriptions", async () => {
    const recorder = new RecordingFetch([
      jsonResponse({
        data: {
          management_urls: {
            update_payment_method: null,
            cancel: "https://paddle.test/cancel-subscription",
          },
        },
      }),
    ]);
    const client = new HttpPaddleClient(
      {
        apiBase: "https://sandbox-api.paddle.com",
        apiKey: "pdl_test_key",
      },
      recorder.fetch,
    );

    await expect(
      client.getSubscriptionManagementUrls("sub/manual"),
    ).resolves.toEqual({
      updatePaymentMethodUrl: null,
      cancelUrl: "https://paddle.test/cancel-subscription",
    });
    expect(recorder.requests[0]?.url).toBe(
      "https://sandbox-api.paddle.com/subscriptions/sub%2Fmanual",
    );
  });

  it("throws a sanitized error and never logs the provider body", async () => {
    const recorder = new RecordingFetch([
      jsonResponse(
        { error: { detail: "customer alice@example.com card failed" } },
        500,
      ),
    ]);
    const client = new HttpPaddleClient(
      {
        apiBase: "https://api.paddle.com",
        apiKey: "pdl_live_key",
      },
      recorder.fetch,
    );
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await expect(client.cancelSubscription("sub_private")).rejects.toThrow(
      "paddle error 500",
    );

    expect(log).toHaveBeenCalledOnce();
    const logged = String(log.mock.calls[0]?.[0]);
    expect(JSON.parse(logged)).toMatchObject({
      event: "paddle_error",
      status: 500,
      endpoint: "subscriptions.cancel",
    });
    expect(logged).not.toContain("alice@example.com");
    expect(logged).not.toContain("card failed");
    log.mockRestore();
  });
});
