import { CloudflareEmailSender } from "./cloudflare";
import { buildEmailSender } from "./index";

const MESSAGE = {
  to: ["person@example.com"],
  subject: "Subject",
  html: "<p>Private body</p>",
  text: "Private body",
};

function emailBinding(
  send: SendEmail["send"],
): SendEmail {
  return { send } as SendEmail;
}

describe("CloudflareEmailSender", () => {
  it("sends the expected structured message through the Worker binding", async () => {
    const send = vi.fn(async () => ({ messageId: "email_123" }));
    const sender = new CloudflareEmailSender(
      emailBinding(send as SendEmail["send"]),
      "Zenguy <hello@example.com>",
    );

    await expect(sender.send(MESSAGE)).resolves.toEqual({
      providerMessageId: "email_123",
    });
    expect(send).toHaveBeenCalledWith({
      from: { email: "hello@example.com", name: "Zenguy" },
      ...MESSAGE,
    });
  });

  it("accepts a bare sender address", async () => {
    const send = vi.fn(async () => ({ messageId: "email_456" }));
    const sender = new CloudflareEmailSender(
      emailBinding(send as SendEmail["send"]),
      "hello@example.com",
    );

    await sender.send(MESSAGE);

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ from: "hello@example.com" }),
    );
  });

  it("throws a sanitized error for provider failures", async () => {
    const sender = new CloudflareEmailSender(
      emailBinding(async () => {
        throw new Error(`Rejected ${MESSAGE.to[0]}: ${MESSAGE.text}`);
      }),
      "from@example.com",
    );

    await expect(sender.send(MESSAGE)).rejects.toThrow("email provider error");
    await sender.send(MESSAGE).catch((error: unknown) => {
      expect(error).toBeInstanceOf(Error);
      if (error instanceof Error) {
        expect(error.message).not.toContain(MESSAGE.to[0] ?? "");
        expect(error.message).not.toContain(MESSAGE.text);
      }
    });
  });

  it("builds the Cloudflare sender from the Worker binding", () => {
    const binding = emailBinding(async () => ({ messageId: "email_789" }));

    expect(
      buildEmailSender({ emailFrom: "from@example.com" }, binding),
    ).toBeInstanceOf(CloudflareEmailSender);
  });
});
