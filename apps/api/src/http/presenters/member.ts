import type { MemberOutput } from "../../application/members/types";

export function presentMember(member: MemberOutput) {
  return {
    ...member,
    joinedAt: new Date(member.joinedAt).toISOString(),
  };
}
