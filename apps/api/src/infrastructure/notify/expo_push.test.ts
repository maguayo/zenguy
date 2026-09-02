import type { NotificationMessage } from "../../domain/channels/notifier";
import { FixedClock } from "../../shared/clock";
import { PUSH_DEVICE_INACTIVITY_TTL_DAYS } from "../../shared/constants";
import { FakePushDeviceRepo } from "../../test/fakes/push";
import {
  EXPO_PUSH_ENDPOINT,
  ExpoPushClient,
  ExpoPushSender,
  buildPushMessages,
  pushDeepLink,
  type ExpoFetch,
  type ExpoPushTicket,
} from "./expo_push";

const FAILURE: NotificationMessage = {
  eventType: "FAILURE",
  title: "❌ Checkout failed",
  lines: [
    'Browser test "Checkout" failed after all configured retries.',
    "Workspace: Acme",
  ],
  link: "https://app.zenguy.test/w/ws_1/incidents/inc_1",
  speakText: "Zenguy alert.",
  shortText: "Zenguy: FAILED Checkout.",
  color: "red",
};

class RecordingFetch {
  readonly requests: { url: string; init: RequestInit | undefined }[] = [];

  constructor(private readonly responses: Response[]) {}

  readonly fetch: ExpoFetch = async (url, init) => {
    this.requests.push({ url, init });
    const response = this.responses.shift();
    if (response === undefined) throw new Error("No recorded response");
    return response;
  };
}

function tickets(...list: ExpoPushTicket[]): Response {
  return Response.json({ data: list });
}

function token(index: number): string {
  return `ExponentPushToken[${String(index).padStart(22, "0")}]`;
}

describe("push payload", () => {
  it("keeps verified Universal Links and refuses external destinations", () => {
    expect(pushDeepLink(FAILURE.link, "https://app.zenguy.test/")).toBe(
      "https://app.zenguy.test/w/ws_1/incidents/inc_1",
    );
    expect(pushDeepLink("https://elsewhere.test/x", "https://app.zenguy.test")).toBe(
      "https://app.zenguy.test",
    );
    expect(
      pushDeepLink(
        "https://app.zenguy.test/w/ws_1/incidents/inc_1?token=secret#private",
        "https://app.zenguy.test",
      ),
    ).toBe("https://app.zenguy.test/w/ws_1/incidents/inc_1");
    const [message] = buildPushMessages([token(1)], FAILURE, {
      workspaceId: "ws_1",
      appUrl: "https://app.zenguy.test",
    });
    expect(message).toEqual({
      to: token(1),
      title: "❌ Checkout failed",
      body: 'Browser test "Checkout" failed after all configured retries.',
      data: {
        url: "https://app.zenguy.test/w/ws_1/incidents/inc_1",
        workspaceId: "ws_1",
        eventType: "FAILURE",
        incidentId: "inc_1",
      },
      sound: "default",
      priority: "high",
    });
    const [test] = buildPushMessages(
      [token(1)],
      { ...FAILURE, eventType: "TEST", link: "https://app.zenguy.test/w/ws_1/alerts" },
      { workspaceId: "ws_1", appUrl: "https://app.zenguy.test" },
    );
    expect(test?.data).toEqual({
      url: "https://app.zenguy.test/w/ws_1/alerts",
      workspaceId: "ws_1",
      eventType: "TEST",
    });
  });
});

describe("ExpoPushClient", () => {
  it("posts batches of 100 with the optional access token", async () => {
    const recorder = new RecordingFetch([
      Response.json({ data: Array.from({ length: 100 }, () => ({ status: "ok", id: "t" })) }),
      tickets({ status: "ok", id: "last" }),
    ]);
    const client = new ExpoPushClient(recorder.fetch, "expo-secret");
    const messages = buildPushMessages(
      Array.from({ length: 101 }, (_, index) => token(index)),
      FAILURE,
      { workspaceId: "ws_1", appUrl: "https://app.zenguy.test" },
    );

    const result = await client.send(messages);

    expect(result).toHaveLength(101);
    expect(recorder.requests).toHaveLength(2);
    expect(recorder.requests[0]?.url).toBe(EXPO_PUSH_ENDPOINT);
    expect(recorder.requests[0]?.init?.signal).toBeInstanceOf(AbortSignal);
    const headers = new Headers(recorder.requests[0]?.init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer expo-secret");
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(JSON.parse(String(recorder.requests[0]?.init?.body))).toHaveLength(100);
    expect(JSON.parse(String(recorder.requests[1]?.init?.body))).toHaveLength(1);
  });

  it("retries HTTP errors and network faults, parks only an unreadable acceptance", async () => {
    const messages = buildPushMessages([token(1)], FAILURE, {
      workspaceId: "ws_1",
      appUrl: "https://app.zenguy.test",
    });
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await expect(
      new ExpoPushClient(
        new RecordingFetch([
          new Response(`bad token ${token(1)} https://exp.host/private`, { status: 500 }),
        ]).fetch,
      ).send(messages),
    ).rejects.toMatchObject({ message: "expo push error 500", outcome: "REJECTED" });
    const logged = String(log.mock.calls[0]?.[0]);
    expect(logged).toContain("[redacted-token]");
    expect(logged).toContain("[redacted-url]");
    expect(logged).not.toContain(token(1));
    log.mockRestore();

    await expect(
      new ExpoPushClient(new RecordingFetch([Response.json({ data: [] })]).fetch).send(messages),
    ).rejects.toMatchObject({
      message: "expo push error invalid response",
      outcome: "AMBIGUOUS",
    });
    await expect(
      new ExpoPushClient(async () => {
        throw new Error("offline");
      }).send(messages),
    ).rejects.toMatchObject({ message: "expo push error network", outcome: "REJECTED" });
  });
});

describe("ExpoPushSender", () => {
  function fixture(responses: Response[]) {
    const devices = new FakePushDeviceRepo();
    devices.members.set("ws_1", ["usr_a", "usr_b"]);
    const base = {
      platform: "ios" as const,
      deviceName: null,
      appVersion: null,
      enabled: true,
      disabledReason: null,
      lastSeenAt: 1,
      createdAt: 1,
      updatedAt: 1,
    };
    devices.devices.set("pd_a", { ...base, id: "pd_a", userId: "usr_a", token: token(1) });
    devices.devices.set("pd_b", { ...base, id: "pd_b", userId: "usr_b", token: token(2) });
    devices.devices.set("pd_off", {
      ...base,
      id: "pd_off",
      userId: "usr_b",
      token: token(3),
      enabled: false,
    });
    devices.devices.set("pd_other", { ...base, id: "pd_other", userId: "usr_z", token: token(4) });
    const recorder = new RecordingFetch(responses);
    const sender = new ExpoPushSender(
      new ExpoPushClient(recorder.fetch),
      devices,
      "https://app.zenguy.test",
      new FixedClock(9_000),
    );
    return { devices, recorder, sender };
  }

  it("sends to every enabled member device and returns the first ticket id", async () => {
    const { recorder, sender } = fixture([
      tickets({ status: "ok", id: "ticket-a" }, { status: "ok", id: "ticket-b" }),
    ]);
    await expect(sender.send("ws_1", FAILURE)).resolves.toEqual({
      providerMessageId: "ticket-a",
    });
    const body = JSON.parse(String(recorder.requests[0]?.init?.body)) as { to: string }[];
    expect(body.map((message) => message.to)).toEqual([token(1), token(2)]);
  });

  it("retires unregistered tokens and still counts the delivery as sent", async () => {
    const { devices, sender } = fixture([
      tickets(
        {
          status: "error",
          message: `"${token(1)}" is not a registered push notification recipient`,
          details: { error: "DeviceNotRegistered" },
        },
        { status: "ok", id: "ticket-b" },
      ),
    ]);
    await expect(sender.send("ws_1", FAILURE)).resolves.toEqual({
      providerMessageId: "ticket-b",
    });
    expect(devices.devices.get("pd_a")).toMatchObject({
      enabled: false,
      disabledReason: "DeviceNotRegistered",
      updatedAt: 9_000,
    });
    expect(devices.devices.get("pd_b")?.enabled).toBe(true);
  });

  it("does not send sensitive notifications to inactive devices", async () => {
    const { devices, recorder, sender } = fixture([
      tickets({ status: "ok", id: "ticket-active" }),
    ]);
    const stale = devices.devices.get("pd_b");
    if (stale === undefined) throw new Error("Missing fixture device");
    devices.devices.set("pd_b", {
      ...stale,
      lastSeenAt:
        9_000 - PUSH_DEVICE_INACTIVITY_TTL_DAYS * 24 * 60 * 60 * 1_000 - 1,
    });

    await expect(sender.send("ws_1", FAILURE)).resolves.toEqual({
      providerMessageId: "ticket-active",
    });
    const body = JSON.parse(String(recorder.requests[0]?.init?.body)) as {
      to: string;
    }[];
    expect(body.map((message) => message.to)).toEqual([token(1)]);
  });

  it("fails with a redacted reason when no ticket was accepted", async () => {
    const { sender } = fixture([
      tickets(
        { status: "error", message: `${token(1)} rejected`, details: { error: "MessageTooBig" } },
        { status: "error", message: "rejected", details: { error: "MessageTooBig" } },
      ),
    ]);
    await expect(sender.send("ws_1", FAILURE)).rejects.toThrow(
      "expo push rejected: MessageTooBig",
    );
  });

  it("refuses to send when the workspace has no registered devices", async () => {
    const { recorder, sender } = fixture([]);
    await expect(sender.send("ws_empty", FAILURE)).rejects.toThrow(
      "No mobile devices are registered for this workspace",
    );
    expect(recorder.requests).toHaveLength(0);
  });
});
