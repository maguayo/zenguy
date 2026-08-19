import type { PeriodOverageReporter } from "../../application/billing/handle_paddle_webhook";

export class NoopOverageReporter implements PeriodOverageReporter {
  async execute(_input: {
    workspaceId: string;
    periodStart: number;
    periodEnd: number;
  }): Promise<void> {}
}
