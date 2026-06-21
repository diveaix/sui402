import { z } from "zod";
import {
  Sui402NetworkSchema,
  isExpired,
  type Sui402Challenge,
  type Sui402Network,
  type Sui402ProviderManifest
} from "@sui402/protocol";

export const Sui402PaymentKindSchema = z.enum(["one-shot", "session"]);
export type Sui402PaymentKind = z.infer<typeof Sui402PaymentKindSchema>;

export const Sui402SpendingPolicySchema = z.object({
  name: z.string().min(1).optional(),
  allowedNetworks: z.array(Sui402NetworkSchema).min(1).optional(),
  allowedMerchants: z.array(z.string().min(1)).min(1).optional(),
  allowedCoinTypes: z.array(z.string().min(1)).min(1).optional(),
  allowedResourceScopes: z.array(z.string().min(1)).min(1).optional(),
  maxAmount: z.string().regex(/^\d+$/).optional(),
  allowOneShot: z.boolean().default(true),
  allowSessions: z.boolean().default(true),
  requireSession: z.boolean().default(false),
  expiresAt: z.string().datetime().optional()
});

export type Sui402SpendingPolicy = z.infer<typeof Sui402SpendingPolicySchema>;

export type PolicyEvaluationOptions = {
  paymentKind?: Sui402PaymentKind;
  now?: Date;
};

export type PolicyDecision = {
  ok: boolean;
  reasons: string[];
  warnings: string[];
};

export function evaluateChallengePolicy(
  policyInput: Sui402SpendingPolicy,
  challenge: Sui402Challenge,
  options: PolicyEvaluationOptions = {}
): PolicyDecision {
  const policy = Sui402SpendingPolicySchema.parse(policyInput);
  const reasons: string[] = [];
  const warnings: string[] = [];

  evaluateSharedPaymentTerms(policy, {
    network: challenge.network,
    merchant: challenge.recipient,
    coinType: challenge.coinType,
    amount: challenge.amount,
    resourceScope: challenge.resource,
    reasons,
    now: options.now
  });
  evaluatePaymentKind(policy, options.paymentKind, reasons, warnings);

  return {
    ok: reasons.length === 0,
    reasons,
    warnings
  };
}

export function evaluateProviderManifestPolicy(
  policyInput: Sui402SpendingPolicy,
  manifest: Sui402ProviderManifest,
  options: PolicyEvaluationOptions = {}
): PolicyDecision {
  const policy = Sui402SpendingPolicySchema.parse(policyInput);
  const reasons: string[] = [];
  const warnings: string[] = [];

  evaluateSharedPaymentTerms(policy, {
    network: manifest.network,
    merchant: manifest.merchant,
    coinType: manifest.coinType,
    amount: manifest.price,
    resourceScope: manifest.resourceScope,
    reasons,
    now: options.now
  });

  if (policy.requireSession && !manifest.sessions.enabled) {
    reasons.push("Provider does not support payment sessions required by policy");
  }

  if (!policy.allowOneShot && manifest.payments.kinds.includes("one-shot") && !manifest.payments.kinds.includes("session")) {
    reasons.push("Provider only advertises one-shot payments, which are disallowed by policy");
  }

  if (!policy.allowSessions && manifest.payments.kinds.includes("session") && !manifest.payments.kinds.includes("one-shot")) {
    reasons.push("Provider only advertises session payments, which are disallowed by policy");
  }

  evaluatePaymentKind(policy, options.paymentKind, reasons, warnings);

  return {
    ok: reasons.length === 0,
    reasons,
    warnings
  };
}

export function assertPolicyDecision(decision: PolicyDecision): void {
  if (!decision.ok) {
    throw new Error(`Sui402 policy rejected payment: ${decision.reasons.join("; ")}`);
  }
}

export function assertChallengeAllowed(
  policy: Sui402SpendingPolicy,
  challenge: Sui402Challenge,
  options: PolicyEvaluationOptions = {}
): void {
  assertPolicyDecision(evaluateChallengePolicy(policy, challenge, options));
}

export function assertProviderManifestAllowed(
  policy: Sui402SpendingPolicy,
  manifest: Sui402ProviderManifest,
  options: PolicyEvaluationOptions = {}
): void {
  assertPolicyDecision(evaluateProviderManifestPolicy(policy, manifest, options));
}

export function isResourceScopeAllowed(resourceScope: string, allowedResourceScopes: string[] | undefined): boolean {
  if (!allowedResourceScopes || allowedResourceScopes.length === 0) {
    return true;
  }

  return allowedResourceScopes.some((pattern) => {
    if (pattern === "*") {
      return true;
    }

    if (pattern.endsWith("*")) {
      return resourceScope.startsWith(pattern.slice(0, -1));
    }

    return resourceScope === pattern;
  });
}

function evaluateSharedPaymentTerms(
  policy: Sui402SpendingPolicy,
  input: {
    network: Sui402Network;
    merchant: string;
    coinType: string;
    amount: string;
    resourceScope: string;
    reasons: string[];
    now?: Date;
  }
): void {
  if (policy.expiresAt && isExpired(policy.expiresAt, input.now)) {
    input.reasons.push("Policy has expired");
  }

  if (policy.allowedNetworks && !policy.allowedNetworks.includes(input.network)) {
    input.reasons.push(`Network ${input.network} is not allowed`);
  }

  if (policy.allowedMerchants && !includesCaseInsensitive(policy.allowedMerchants, input.merchant)) {
    input.reasons.push(`Merchant ${input.merchant} is not allowed`);
  }

  if (policy.allowedCoinTypes && !includesCaseInsensitive(policy.allowedCoinTypes, input.coinType)) {
    input.reasons.push(`Coin type ${input.coinType} is not allowed`);
  }

  if (policy.maxAmount !== undefined && BigInt(input.amount) > BigInt(policy.maxAmount)) {
    input.reasons.push(`Amount ${input.amount} exceeds policy maximum ${policy.maxAmount}`);
  }

  if (!isResourceScopeAllowed(input.resourceScope, policy.allowedResourceScopes)) {
    input.reasons.push(`Resource scope ${input.resourceScope} is not allowed`);
  }
}

function evaluatePaymentKind(
  policy: Sui402SpendingPolicy,
  paymentKind: Sui402PaymentKind | undefined,
  reasons: string[],
  warnings: string[]
): void {
  if (policy.requireSession && paymentKind !== "session") {
    reasons.push("Policy requires session payments");
    return;
  }

  if (!paymentKind) {
    if (!policy.allowOneShot || !policy.allowSessions) {
      warnings.push("Policy restricts payment kinds; evaluate again with an explicit payment kind before signing");
    }
    return;
  }

  if (paymentKind === "one-shot" && !policy.allowOneShot) {
    reasons.push("One-shot payments are disallowed by policy");
  }

  if (paymentKind === "session" && !policy.allowSessions) {
    reasons.push("Session payments are disallowed by policy");
  }
}

function includesCaseInsensitive(values: string[], value: string): boolean {
  const normalized = value.toLowerCase();
  return values.some((entry) => entry.toLowerCase() === normalized);
}
