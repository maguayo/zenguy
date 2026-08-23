import type { NotificationMessage } from "../../domain/channels/notifier";
import { DiscordWebhookSender, type DiscordFetch } from "./discord";
import { SlackWebhookSender, type SlackFetch } from "./slack";

const MESSAGE: NotificationMessage = {
  eventType: "FAILURE",
  title: "❌ Checkout failed",
  lines: ["Checkout failed.", "Workspace: Acme"],
  link: "https://app.zenguy.test/w/ws/incidents/inc",
  speakText: "Zenguy alert. Checkout failed.",
  shortText: "Zenguy: FAILED Checkout.",
  color: "red",
};

describe("SlackWebhookSender", () => {
  it("posts the exact Block Kit skeleton", async () => {
    const fetchFn = vi.fn<SlackFetch>(async () => new Response("ok"));
    const sender = new SlackWebhookSender(fetchFn);
    const webhookUrl =
      "https://hooks.slack.com/services/T000/B000/private-token";

    await sender.send(webhookUrl, MESSAGE);

    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe(webhookUrl);
    expect(init?.method).toBe("POST");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(new Headers(init?.headers).get("Content-Type")).toBe(
      "application/json",
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      text: MESSAGE.title,
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: MESSAGE.title },
        },
        {
          type: "section",
          text: { type: "mrkdwn", text: MESSAGE.lines.join("\n") },
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `<${MESSAGE.link}|Open in Zenguy>`,
            },
          ],
        },
      ],
    });
  });

  it("never includes the webhook path in errors", async () => {
    const cancel = vi.fn(async () => undefined);
    const sender = new SlackWebhookSender(async () =>
      new Response(new ReadableStream<Uint8Array>({ cancel }), { status: 500 }),
    );
    const webhookUrl =
      "https://hooks.slack.com/services/T000/B000/private-token";

    const error = await sender.send(webhookUrl, MESSAGE).catch((value: unknown) =>
      value instanceof Error ? value.message : String(value),
    );

    expect(error).toBe("slack error 500");
    expect(error).not.toContain("private-token");
    expect(cancel).toHaveBeenCalledOnce();
  });
});

describe("DiscordWebhookSender", () => {
  it.each([
    ["red", 0xdc2626],
    ["green", 0x16a34a],
    ["gray", 0x6b7280],
  ] as const)("posts a %s embed with the exact color", async (color, value) => {
    const fetchFn = vi.fn<DiscordFetch>(async () =>
      Response.json({ id: `discord-${color}` }),
    );
    const sender = new DiscordWebhookSender(fetchFn);
    const webhookUrl =
      "https://discord.com/api/webhooks/123/private-token";

    await sender.send(webhookUrl, { ...MESSAGE, color });

    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe(`${webhookUrl}?wait=true`);
    expect(init?.method).toBe("POST");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(new Headers(init?.headers).get("Content-Type")).toBe(
      "application/json",
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      embeds: [
        {
          title: MESSAGE.title,
          description: MESSAGE.lines.join("\n"),
          url: MESSAGE.link,
          color: value,
        },
      ],
    });
  });

  it("cancels an ignored error body before classifying the outcome", async () => {
    const cancel = vi.fn(async () => undefined);
    const sender = new DiscordWebhookSender(async () =>
      new Response(new ReadableStream<Uint8Array>({ cancel }), { status: 500 }),
    );

    await expect(
      sender.send("https://discord.com/api/webhooks/123/private-token", MESSAGE),
    ).rejects.toThrow("discord error 500");
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("never includes the webhook path in errors", async () => {
    const sender = new DiscordWebhookSender(async () => {
      throw new Error("network failed at /api/webhooks/123/private-token");
    });
    const webhookUrl =
      "https://discord.com/api/webhooks/123/private-token";

    const error = await sender.send(webhookUrl, MESSAGE).catch((value: unknown) =>
      value instanceof Error ? value.message : String(value),
    );

    expect(error).toBe("discord error network");
    expect(error).not.toContain("private-token");
  });
});
