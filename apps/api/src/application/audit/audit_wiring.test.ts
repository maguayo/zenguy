import { readFileSync } from "node:fs";
import { AUDIT_ACTIONS } from "../../domain/audit/actions";

const ACTION_USE_CASES = {
  workspaceCreated: "../workspaces/create_workspace.ts",
  workspaceUpdated: "../workspaces/update_workspace.ts",
  workspaceDeleted: "../workspaces/delete_workspace.ts",
  workspaceOwnershipTransferred: "../workspaces/transfer_ownership.ts",
  memberInvited: "../invitations/invite_member.ts",
  memberInvitationRevoked: "../invitations/revoke_invitation.ts",
  memberJoined: "../invitations/accept_invitation.ts",
  memberRoleChanged: "../members/change_member_role.ts",
  memberRemoved: "../members/remove_member.ts",
  secretCreated: "../secrets/create_secret.ts",
  secretUpdated: "../secrets/replace_secret.ts",
  secretDeleted: "../secrets/delete_secret.ts",
  channelCreated: "../channels/create_channel.ts",
  channelUpdated: "../channels/update_channel.ts",
  channelDeleted: "../channels/delete_channel.ts",
  channelTested: "../channels/test_channel.ts",
  testCreated: "../browser_tests/create_browser_test.ts",
  testUpdated: "../browser_tests/update_browser_test.ts",
  testDeleted: "../browser_tests/delete_browser_test.ts",
  testRunManual: "../browser_tests/run_now.ts",
  monitorCreated: "../uptime/create_monitor.ts",
  monitorUpdated: "../uptime/update_monitor.ts",
  monitorDeleted: "../uptime/delete_monitor.ts",
  billingSubscriptionUpdated: "../billing/handle_paddle_webhook.ts",
  billingGrantIssued: "../billing/issue_subscription_grant.ts",
  billingGrantRedeemed: "../billing/redeem_subscription_grant.ts",
  authPasswordReset: "../auth/reset_password.ts",
  apiKeyCreated: "../api_keys/create_api_key.ts",
  apiKeyRevoked: "../api_keys/revoke_api_key.ts",
} as const satisfies Record<keyof typeof AUDIT_ACTIONS, string>;

describe("audit action wiring", () => {
  it.each(Object.entries(ACTION_USE_CASES))(
    "writes %s from its owning use case",
    (actionKey, relativePath) => {
      const source = readFileSync(
        new URL(relativePath, import.meta.url),
        "utf8",
      );
      expect(source).toContain(`AUDIT_ACTIONS.${actionKey}`);
      expect(source).toContain("audit.execute");
    },
  );
});
