import { Hono } from "hono";
import { z } from "zod";
import type { EnsureDefaultPushChannel } from "../../application/push/ensure_default_push_channel";
import {
  ListPushDevices,
  RemovePushDevice,
  UpdatePushDevice,
} from "../../application/push/manage_push_devices";
import { RegisterPushDevice } from "../../application/push/register_push_device";
import type { PushDeviceRepo } from "../../domain/push/repo";
import type { UserRepo } from "../../domain/users/repo";
import type { WorkspaceRepo } from "../../domain/workspaces/repo";
import type { Clock } from "../../shared/clock";
import type { AppConfig } from "../../shared/config";
import type { IdGenerator } from "../../shared/ids";
import type { AppEnv } from "../env";
import { requireAuth, requireVerifiedEmail } from "../middleware/auth";
import { presentPushDevice } from "../presenters/push_device";
import { zjson } from "../validate";

export interface PushDeviceRoutesDependencies {
  users: UserRepo;
  workspaces: Pick<WorkspaceRepo, "listForUser">;
  pushDevices: PushDeviceRepo;
  defaultPushChannel: Pick<EnsureDefaultPushChannel, "execute">;
  clock: Clock;
  ids: IdGenerator;
  config: Pick<AppConfig, "jwtSecret">;
}

const registerSchema = z.object({
  token: z.string().min(1).max(200),
  platform: z.enum(["ios", "android"]),
  deviceName: z.string().max(80).nullable().optional(),
  appVersion: z.string().max(40).nullable().optional(),
});
const updateSchema = z.object({ enabled: z.boolean() });

/** Device registration for the mobile app, mounted under `/api/me`. */
export function pushDeviceRoutes(
  dependencies: PushDeviceRoutesDependencies,
): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const auth = requireAuth(dependencies);
  const register = new RegisterPushDevice(
    dependencies.pushDevices,
    dependencies.workspaces,
    dependencies.defaultPushChannel,
    dependencies.clock,
    dependencies.ids,
  );
  const list = new ListPushDevices(dependencies.pushDevices);
  const update = new UpdatePushDevice(dependencies.pushDevices, dependencies.clock);
  const remove = new RemovePushDevice(dependencies.pushDevices);

  app.get("/push-devices", auth, requireVerifiedEmail, async (context) => {
    const devices = await list.execute({ userId: context.get("user").id });
    return context.json({ data: devices.map(presentPushDevice) });
  });

  app.put(
    "/push-devices",
    auth,
    requireVerifiedEmail,
    zjson(registerSchema),
    async (context) => {
      const device = await register.execute({
        ...context.req.valid("json"),
        userId: context.get("user").id,
      });
      return context.json({ data: presentPushDevice(device) });
    },
  );

  app.patch(
    "/push-devices/:deviceId",
    auth,
    requireVerifiedEmail,
    zjson(updateSchema),
    async (context) => {
      const device = await update.execute({
        userId: context.get("user").id,
        deviceId: context.req.param("deviceId"),
        enabled: context.req.valid("json").enabled,
      });
      return context.json({ data: presentPushDevice(device) });
    },
  );

  app.delete(
    "/push-devices/:deviceId",
    auth,
    requireVerifiedEmail,
    async (context) => {
      await remove.execute({
        userId: context.get("user").id,
        deviceId: context.req.param("deviceId"),
      });
      return context.body(null, 204);
    },
  );

  return app;
}
