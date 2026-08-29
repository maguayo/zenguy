import type { StatusPageRepo } from "../../domain/status_pages/repo";
import type { StatusPage } from "../../domain/status_pages/types";

export class ListStatusPages {
  constructor(private readonly pages: StatusPageRepo) {}

  async execute(input: { workspaceId: string }): Promise<StatusPage[]> {
    return this.pages.list(input.workspaceId);
  }
}
