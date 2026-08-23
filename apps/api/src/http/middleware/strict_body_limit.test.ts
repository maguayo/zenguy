import { Hono } from "hono";
import type { AppEnv } from "../env";
import { strictBodyLimit } from "./strict_body_limit";

describe("strictBodyLimit", () => {
  it("cancels an oversized stream before downstream parsing", async () => {
    let cancelled = false;
    const reachedDownstream = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(5));
      },
      cancel() {
        cancelled = true;
      },
    });
    const app = new Hono<AppEnv>();
    app.use("*", strictBodyLimit({ maxSize: 4 }));
    app.post("/", async (context) => {
      reachedDownstream();
      await context.req.text();
      return context.text("accepted");
    });

    const init: RequestInit & { duplex: "half" } = {
      method: "POST",
      body,
      duplex: "half",
    };
    const response = await app.request(new Request("http://localhost/", init));

    expect(response.status).toBe(413);
    expect(cancelled).toBe(true);
    expect(reachedDownstream).not.toHaveBeenCalled();
  });

  it("counts the stream instead of trusting an understated Content-Length", async () => {
    const app = new Hono<AppEnv>();
    app.use("*", strictBodyLimit({ maxSize: 4 }));
    app.post("/", async (context) => context.text(await context.req.text()));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("hello"));
        controller.close();
      },
    });

    const init: RequestInit & { duplex: "half" } = {
      method: "POST",
      headers: { "content-length": "1" },
      body,
      duplex: "half",
    };
    const response = await app.request(new Request("http://localhost/", init));

    expect(response.status).toBe(413);
  });

  it("resolves a route-specific limit before reading the stream", async () => {
    const app = new Hono<AppEnv>();
    app.use(
      "*",
      strictBodyLimit({
        maxSize: (context) => (context.req.path === "/bulk" ? 8 : 4),
      }),
    );
    app.post("*", async (context) => context.text(await context.req.text()));

    const accepted = await app.request("/bulk", { method: "POST", body: "12345678" });
    const rejected = await app.request("/regular", {
      method: "POST",
      body: "12345",
    });

    expect(accepted.status).toBe(200);
    expect(rejected.status).toBe(413);
  });
});
