import { Hono } from "hono";
import { strictBodyLimit } from "../middleware/strict_body_limit";
import {
  HandlePaddleWebhook,
  type HandlePaddleWebhookDependencies,
} from "../../application/billing/handle_paddle_webhook";
import type { AppEnv } from "../env";
import { MAX_PADDLE_WEBHOOK_BODY_BYTES } from "../../shared/constants";

export function webhookRoutes(
  dependencies: HandlePaddleWebhookDependencies,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const handlePaddleWebhook = new HandlePaddleWebhook(dependencies);

  app.post(
    "/paddle",
    strictBodyLimit({
      maxSize: MAX_PADDLE_WEBHOOK_BODY_BYTES,
      onError: (context) =>
        context.json(
          { error: { code: "PAYLOAD_TOO_LARGE", message: "Request body too large" } },
          413,
        ),
    }),
    async (context) => {
      const rawBody = await context.req.text();
      await handlePaddleWebhook.execute({
        rawBody,
        signatureHeader: context.req.header("Paddle-Signature") ?? null,
        ip: context.req.header("CF-Connecting-IP"),
      });
      return context.json({ data: { received: true } });
    },
  );

  return app;
}
