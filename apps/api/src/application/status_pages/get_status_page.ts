import type {
  StatusPageItemRepo,
  StatusPageRepo,
} from "../../domain/status_pages/repo";
import type {
  StatusPage,
  StatusPageItem,
} from "../../domain/status_pages/types";
import { notFound } from "../../shared/errors";

export interface StatusPageDetail {
  page: StatusPage;
  items: StatusPageItem[];
}

export class GetStatusPage {
  constructor(
    private readonly pages: StatusPageRepo,
    private readonly items: StatusPageItemRepo,
  ) {}

  async execute(input: {
    workspaceId: string;
    pageId: string;
  }): Promise<StatusPageDetail> {
    const page = await this.pages.findById(input.workspaceId, input.pageId);
    if (page === null) throw notFound("Status page");
    const items = await this.items.listForPage(page.id);
    return { page, items };
  }
}
