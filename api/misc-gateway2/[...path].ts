// Second consolidated dispatcher, same pattern as
// api/domain-gateway/[domain]/v1/[...rest].ts and api/misc-gateway/[name].ts
// -- see the former's header comment for the full rationale (Vercel Hobby's
// 12-function cap, why this can't live at the api/ root).
//
// This one covers the remaining nested-path standalone endpoints (varying
// depth -- discord/oauth/callback, internal/mcp-grant-mint, etc.), hence a
// REST catch-all ([...path]) keyed by the full remaining path, rather than
// misc-gateway's single [name] segment.
export const config = { runtime: 'edge' };

import briefShareUrlHandler from '../brief/_share-url';
import discordOauthCallbackHandler from '../discord/oauth/_callback';
import discordOauthStartHandler from '../discord/oauth/_start';
import internalBriefWhyMattersHandler from '../internal/_brief-why-matters';
import internalMcpGrantContextHandler from '../internal/_mcp-grant-context';
import internalMcpGrantMintHandler from '../internal/_mcp-grant-mint';
import meEntitlementHandler from '../me/_entitlement';
import oauthAuthorizeProHandler from '../oauth/_authorize-pro';
// @ts-expect-error — JS module, no declaration file
import oauthAuthorizeHandler from '../oauth/_authorize';
// @ts-expect-error — JS module, no declaration file
import oauthRegisterHandler from '../oauth/_register';
import oauthTokenHandler from '../oauth/_token';
import referralMeHandler from '../referral/_me';
// @ts-expect-error — JS module, no declaration file
import securityReportHandler from '../security/_report';
import skillsFetchAgentskillsHandler from '../skills/_fetch-agentskills';
import slackOauthCallbackHandler from '../slack/oauth/_callback';
import slackOauthStartHandler from '../slack/oauth/_start';
import userMcpQuotaHandler from '../user/_mcp-quota';
import userMcpRevokeHandler from '../user/_mcp-revoke';
// @ts-expect-error — JS module, no declaration file
import youtubeEmbedHandler from '../youtube/_embed';
// @ts-expect-error — JS module, no declaration file
import youtubeLiveHandler from '../youtube/_live';
import scenarioStatusHandler from '../scenario/v1/_status';
import scenarioTemplatesHandler from '../scenario/v1/_templates';
import scenarioRunHandler from '../scenario/v1/_run';
import supplyChainCountryProductsHandler from '../supply-chain/v1/_country-products';
import supplyChainMultiSectorCostShockHandler from '../supply-chain/v1/_multi-sector-cost-shock';
// @ts-expect-error — JS module, no declaration file
import supplyChainHormuzTrackerHandler from '../supply-chain/_hormuz-tracker';

type EdgeCtx = { waitUntil: (p: Promise<unknown>) => void };
type EdgeHandler = (req: Request, ctx: EdgeCtx) => Response | Promise<Response>;

const REGISTRY: Record<string, EdgeHandler> = {
  'brief/share-url': briefShareUrlHandler,
  'discord/oauth/callback': discordOauthCallbackHandler,
  'discord/oauth/start': discordOauthStartHandler,
  'internal/brief-why-matters': internalBriefWhyMattersHandler,
  'internal/mcp-grant-context': internalMcpGrantContextHandler,
  'internal/mcp-grant-mint': internalMcpGrantMintHandler,
  'me/entitlement': meEntitlementHandler,
  'oauth/authorize-pro': oauthAuthorizeProHandler,
  'oauth/authorize': oauthAuthorizeHandler,
  'oauth/register': oauthRegisterHandler,
  'oauth/token': oauthTokenHandler,
  'referral/me': referralMeHandler,
  'security/report': securityReportHandler,
  'skills/fetch-agentskills': skillsFetchAgentskillsHandler,
  'slack/oauth/callback': slackOauthCallbackHandler,
  'slack/oauth/start': slackOauthStartHandler,
  'user/mcp-quota': userMcpQuotaHandler,
  'user/mcp-revoke': userMcpRevokeHandler,
  'youtube/embed': youtubeEmbedHandler,
  'youtube/live': youtubeLiveHandler,
  'scenario/v1/status': scenarioStatusHandler,
  'scenario/v1/templates': scenarioTemplatesHandler,
  'scenario/v1/run': scenarioRunHandler,
  'supply-chain/v1/country-products': supplyChainCountryProductsHandler,
  'supply-chain/v1/multi-sector-cost-shock': supplyChainMultiSectorCostShockHandler,
  'supply-chain/hormuz-tracker': supplyChainHormuzTrackerHandler,
};

export default async function handler(req: Request, ctx: EdgeCtx): Promise<Response> {
  const url = new URL(req.url);
  const parts = url.pathname.split('/');
  // parts: ['', 'api', 'misc-gateway2', ...restSegments]
  const key = parts.slice(3).join('/');
  const target = REGISTRY[key];
  if (!target) {
    return new Response(JSON.stringify({ error: `Unknown endpoint: ${key}` }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const originalPathname = '/api/' + key;
  const forwardedUrl = new URL(originalPathname + url.search, url.origin);
  const forwardedReq = new Request(forwardedUrl.toString(), req);
  return target(forwardedReq, ctx);
}
