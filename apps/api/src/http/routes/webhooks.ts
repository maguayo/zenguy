import { Hono } from "hono";
import {
  HandlePaddleWebhook,
  type HandlePaddleWebhookDependencies,
} from "../../application/billing/handle_paddle_webhook";
import type { AppEnv } from "../env";

export function webhookRoutes(
  dependencies: HandlePaddleWebhookDependencies,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const handlePaddleWebhook = new HandlePaddleWebhook(dependencies);

  app.post("/paddle", async (context) => {
    const rawBody = await context.req.text();
    await handlePaddleWebhook.execute({
      rawBody,
      signatureHeader: context.req.header("Paddle-Signature") ?? null,
      ip: context.req.header("CF-Connecting-IP"),
    });
    return context.json({ data: { received: true } });
  });

  return app;
}
