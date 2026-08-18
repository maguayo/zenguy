import { DevEmailSender } from "./dev";
import { buildEmailSender } from "./index";
import { ResendEmailSender } from "./resend";

const MESSAGE = {
  to: ["person@example.com"],
  subject: "Subject",
  html: "<p>Private body</p>",
  text: "Private body",
};

describe("ResendEmailSender", () => {
  it("posts the expected payload and authorization header", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json({ id: "email_123" }),
    );
    const sender = new ResendEmailSender(
      "resend-secret",
      "Zenguy <hello@example.com>",
      fetchMock,
    );

    await expect(sender.send(MESSAGE)).resolves.toEqual({
      providerMessageId: "email_123",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        Authorization: "Bearer resend-secret",
        "Content-Type": "application/json",
      },
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      from: "Zenguy <hello@example.com>",
      ...MESSAGE,
    });
  });

  it("throws a sanitized error for provider failures", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json(
        { error: `Rejected ${MESSAGE.to[0]}: ${MESSAGE.text}` },
        { status: 500 },
      ),
    );
    const sender = new ResendEmailSender("secret", "from@example.com", fetchMock);

    await expect(sender.send(MESSAGE)).rejects.toThrow(
      "email provider error: 500",
    );
    await sender.send(MESSAGE).catch((error: unknown) => {
      expect(error).toBeInstanceOf(Error);
      if (error instanceof Error) {
        expect(error.message).not.toContain(MESSAGE.to[0] ?? "");
        expect(error.message).not.toContain(MESSAGE.text);
      }
    });
  });

  it("selects the development sender when the API key is empty", () => {
    expect(
      buildEmailSender({ resendApiKey: "", emailFrom: "from@example.com" }),
    ).toBeInstanceOf(DevEmailSender);
    expect(
      buildEmailSender({
        resendApiKey: "secret",
        emailFrom: "from@example.com",
      }),
    ).toBeInstanceOf(ResendEmailSender);
  });
});
