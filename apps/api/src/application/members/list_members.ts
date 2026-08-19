import type { MemberRepo } from "../../domain/workspaces/repo";
import { memberOutput, type MemberOutput } from "./types";

export class ListMembers {
  constructor(private readonly members: MemberRepo) {}

  async execute(input: { workspaceId: string }): Promise<MemberOutput[]> {
    return (await this.members.list(input.workspaceId)).map(memberOutput);
  }
}
