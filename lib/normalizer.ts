import type Stripe from "stripe";
import { getJurisdiction, calculateTax } from "./jurisdictions";

export interface NumeralTransaction {
  stripeEventId: string;
  stripeChargeId: string;
  customerEmail: string | null;
  billingCity: string | null;
  billingState: string | null;
  billingZip: string | null;
  billingCountry: string | null;
  amountCents: number;
  currency: string;
  taxAmountCents: number;
  taxRate: number;
  jurisdictionState: string | null;
  jurisdictionName: string | null;
  stripeCreatedAt: Date;
  status: "RECORDED" | "REFUNDED";
  metadata: Record<string, unknown>;
}

export function normalizeStripeCharge(
  eventId: string,
  charge: Stripe.Charge
): NumeralTransaction {
  const billing = charge.billing_details?.address;
  const stateCode = billing?.state?.toUpperCase() ?? null;
  const jurisdiction = stateCode ? getJurisdiction(stateCode) : null;
  const taxAmount = stateCode ? calculateTax(charge.amount, stateCode) : 0;

  return {
    stripeEventId: eventId,
    stripeChargeId: charge.id,
    customerEmail: charge.billing_details?.email ?? null,
    billingCity: billing?.city ?? null,
    billingState: stateCode,
    billingZip: billing?.postal_code ?? null,
    billingCountry: billing?.country ?? null,
    amountCents: charge.amount,
    currency: charge.currency,
    taxAmountCents: taxAmount,
    taxRate: jurisdiction?.totalRate ?? 0,
    jurisdictionState: stateCode,
    jurisdictionName: jurisdiction?.name ?? null,
    stripeCreatedAt: new Date(charge.created * 1000),
    status: charge.refunded ? "REFUNDED" : "RECORDED",
    metadata: {
      stripeDescription: charge.description,
      paymentMethod: charge.payment_method_details?.type,
      receiptUrl: charge.receipt_url,
    },
  };
}
