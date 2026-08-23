import type {
  ConsumeCheckoutIntentResult,
  PaddleCheckoutIntentRepo,
} from "../../domain/billing/repo";
import type { PaddleCheckoutIntent } from "../../domain/billing/types";

export class FakePaddleCheckoutIntentRepo implements PaddleCheckoutIntentRepo {
  readonly intents = new Map<string, PaddleCheckoutIntent>();

  async insert(intent: PaddleCheckoutIntent): Promise<void> {
    if (this.intents.has(intent.id)) throw new Error("duplicate checkout intent");
    this.intents.set(intent.id, { ...intent });
  }

  async findById(id: string): Promise<PaddleCheckoutIntent | null> {
    const intent = this.intents.get(id);
    return intent === undefined ? null : { ...intent };
  }

  async consume(
    id: string,
    providerReference: string,
    at: number,
  ): Promise<ConsumeCheckoutIntentResult> {
    const intent = this.intents.get(id);
    if (intent === undefined) return "unavailable";
    if (intent.providerReference === providerReference) return "replayed";
    if (intent.consumedAt !== null || intent.expiresAt < at) return "unavailable";
    this.intents.set(id, {
      ...intent,
      consumedAt: at,
      providerReference,
    });
    return "consumed";
  }

  async purgeExpired(before: number): Promise<number> {
    let purged = 0;
    for (const [id, intent] of this.intents) {
      if (
        intent.expiresAt < before &&
        (intent.consumedAt === null || intent.consumedAt < before)
      ) {
        this.intents.delete(id);
        purged += 1;
      }
    }
    return purged;
  }
}
