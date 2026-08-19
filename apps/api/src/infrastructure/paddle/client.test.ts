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
      client.createOneTimeCharge("sub_123", "pri_overage", 7),
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

    const [charge, cancel, management, list, invoice] = recorder.requests;
    expect(charge?.url).toBe(
      "https://sandbox-api.paddle.com/subscriptions/sub_123/charge",
    );
    expect(charge?.init?.method).toBe("POST");
    expect(bodyOf(charge as RecordedRequest)).toEqual({
      effective_from: "immediately",
      items: [{ price_id: "pri_overage", quantity: 7 }],
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
    }
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
