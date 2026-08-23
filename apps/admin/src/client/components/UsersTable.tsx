import type { UserSummary } from "../../shared/types";
import { formatDateTime, formatNumber, relativeSeconds } from "../lib/format";
import { Card } from "./Card";

export function UsersTable({ now, users }: { now: number; users: UserSummary[] }) {
  return (
    <Card aside="Newest activity first" title="Users">
      {users.length === 0 ? (
        <p className="text-zinc-500">No users yet</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="text-xs text-zinc-500">
              <tr>
                <th className="pb-2 font-medium">Account</th>
                <th className="pb-2 font-medium">Workspaces</th>
                <th className="pb-2 font-medium">Verification</th>
                <th className="pb-2 font-medium">Signed up</th>
                <th className="pb-2 font-medium">Last active</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {users.map((user) => (
                <tr key={user.id}>
                  <td className="py-2.5">
                    <span className="font-medium">{user.name || "No name"}</span>
                    <span className="block text-xs text-zinc-500">{user.email}</span>
                  </td>
                  <td className="py-2.5 tabular-nums">{formatNumber(user.workspaceCount)}</td>
                  <td className={`py-2.5 ${user.emailVerified ? "text-zinc-500" : "text-warn-600"}`}>
                    {user.emailVerified ? "Verified" : "Unverified"}
                  </td>
                  <td className="py-2.5 text-zinc-500">{formatDateTime(user.createdAt)}</td>
                  <td className="py-2.5 text-zinc-500">
                    {user.lastActiveAt === null ? (
                      "No activity"
                    ) : (
                      <span title={formatDateTime(user.lastActiveAt)}>
                        {relativeSeconds(user.lastActiveAt, now)}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
