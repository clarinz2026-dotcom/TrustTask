export type SimulatedOutcome = "paid" | "failed";
export type PaymentProviderEvent = {
  providerReference: string;
  eventId: string;
  outcome: SimulatedOutcome;
  failureReason?: string;
};

export interface PaymentProvider {
  simulate(
    idempotencyKey: string,
    outcome: SimulatedOutcome,
  ): Promise<PaymentProviderEvent>;
}

export class LocalPaymentSimulator implements PaymentProvider {
  async simulate(
    idempotencyKey: string,
    outcome: SimulatedOutcome,
  ): Promise<PaymentProviderEvent> {
    const reference = `local-sim-${idempotencyKey}`;
    return {
      providerReference: reference,
      eventId: `${reference}-result`,
      outcome,
      ...(outcome === "failed"
        ? { failureReason: "Configured local simulator outcome" }
        : {}),
    };
  }
}
