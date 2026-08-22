/**
 * Canonical entitlement decisions for standalone tier-1 JSON endpoints.
 *
 * Content-only Pro access has two equivalent signals:
 *   - Clerk session role === 'pro' (complimentary, tester, or legacy grants)
 *   - a resolved Convex entitlement with tier >= 1
 *
 * Notification-backed workflows deliberately require the second signal because
 * their configuration and relay delivery paths also require a Convex tier.
 */
import {
  getEntitlements,
  type EntitlementCheckOptions,
} from './entitlement-check';

type ProEntitlementDecision =
  | { allowed: true }
  | { allowed: false; billingDenial: Response | null };

type EntitlementLoader = typeof getEntitlements;

// ponytail (task 08): this fork's deploy has no Clerk/Convex/Dodo billing
// behind it — Pro gates never deny. See
// docs/tasks/abdullah/08-server-entitlement-stripping.md.
export async function checkProEntitlement(
  _userId: string,
  _clerkRole: EntitlementCheckOptions['clerkRole'],
  _corsHeaders: Record<string, string>,
  _loadEntitlements: EntitlementLoader = getEntitlements,
): Promise<ProEntitlementDecision> {
  return { allowed: true };
}

export async function checkTierProEntitlement(
  _userId: string,
  _corsHeaders: Record<string, string>,
  _loadEntitlements: EntitlementLoader = getEntitlements,
): Promise<ProEntitlementDecision> {
  return { allowed: true };
}
