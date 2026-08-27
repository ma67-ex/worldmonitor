// Consolidated dispatcher for standalone root-level api/*.ts|js endpoints.
//
// Same pattern as api/domain-gateway/[domain]/v1/[...rest].ts (see that
// file's header comment for the full rationale: Vercel Hobby's 12-function
// cap, why this can't live at api/[name].ts -- a dynamic segment at the
// api/ root's first path position -- without conflicting with the existing
// root catch-all api/[...notfound].ts).
//
// vercel.json carries one explicit rewrite per endpoint mapping the real
// client-facing URL (/api/<name>) to this file's path
// (/api/misc-gateway/<name>). Each handler's own logic is completely
// untouched -- this only changes how many Vercel functions wrap them.
//
// api/mcp.ts is deliberately NOT included here -- it pulls in the entire
// MCP tool/prompt/resource registry (a large, self-contained dependency
// tree) and stays as its own standalone function to avoid inflating this
// bundle's size.
export const config = { runtime: 'edge' };

import a2aHandler from '../_a2a';
import agentAuthHandler from '../_agent-auth';
// @ts-expect-error — JS module, no declaration file
import analyticsHealthHandler from '../_analytics-health';
import askHandler from '../_ask';
// @ts-expect-error — JS module, no declaration file
import bootstrapHandler from '../_bootstrap';
// @ts-expect-error — JS module, no declaration file
import cachePurgeHandler from '../_cache-purge';
import chatAnalystHandler from '../_chat-analyst';
// @ts-expect-error — JS module, no declaration file
import correlationRuntimeModeHandler from '../_correlation-runtime-mode';
import createCheckoutHandler from '../_create-checkout';
import customerPortalHandler from '../_customer-portal';
import docsMcpHandler from '../_docs-mcp';
// @ts-expect-error — JS module, no declaration file
import downloadHandler from '../_download';
// @ts-expect-error — JS module, no declaration file
import fwdstartHandler from '../_fwdstart';
// @ts-expect-error — JS module, no declaration file
import geoHandler from '../_geo';
// @ts-expect-error — JS module, no declaration file
import gpsjamHandler from '../_gpsjam';
// @ts-expect-error — JS module, no declaration file
import healthHandler from '../_health';
import httpMessageSignaturesDirectoryHandler from '../_http-message-signatures-directory';
import invalidateUserApiKeyCacheHandler from '../_invalidate-user-api-key-cache';
import latestBriefHandler from '../_latest-brief';
import mcpProxyHandler from '../_mcp-proxy';
import notificationChannelsHandler from '../_notification-channels';
import notifyHandler from '../_notify';
import oauthAuthorizationServerHandler from '../_oauth-authorization-server';
import oauthProtectedResourceHandler from '../_oauth-protected-resource';
// @ts-expect-error — JS module, no declaration file
import openskyHandler from '../_opensky';
// @ts-expect-error — JS module, no declaration file
import orefAlertsHandler from '../_oref-alerts';
// @ts-expect-error — JS module, no declaration file
import pizzintProxyHandler from '../_pizzint-proxy';
// @ts-expect-error — JS module, no declaration file
import polymarketHandler from '../_polymarket';
// @ts-expect-error — JS module, no declaration file
import productCatalogHandler from '../_product-catalog';
// @ts-expect-error — JS module, no declaration file
import reverseGeocodeHandler from '../_reverse-geocode';
// @ts-expect-error — JS module, no declaration file
import rssProxyHandler from '../_rss-proxy';
import sanctionsOfacProxyHandler from '../_sanctions-ofac-proxy';
import scenarioDrainHandler from '../_scenario-drain';
import seedContractProbeHandler from '../_seed-contract-probe';
// @ts-expect-error — JS module, no declaration file
import seedHealthHandler from '../_seed-health';
import symbolSearchHandler from '../_symbol-search';
// @ts-expect-error — JS module, no declaration file
import telegramFeedHandler from '../_telegram-feed';
import userPrefsHandler from '../_user-prefs';
// @ts-expect-error — JS module, no declaration file
import versionHandler from '../_version';
import widgetAgentHandler from '../_widget-agent';
// @ts-expect-error — JS module, no declaration file
import wmSessionHandler from '../_wm-session';

type EdgeCtx = { waitUntil: (p: Promise<unknown>) => void };
type EdgeHandler = (req: Request, ctx: EdgeCtx) => Response | Promise<Response>;

const REGISTRY: Record<string, EdgeHandler> = {
  'a2a': a2aHandler,
  'agent-auth': agentAuthHandler,
  'analytics-health': analyticsHealthHandler,
  'ask': askHandler,
  'bootstrap': bootstrapHandler,
  'cache-purge': cachePurgeHandler,
  'chat-analyst': chatAnalystHandler,
  'correlation-runtime-mode': correlationRuntimeModeHandler,
  'create-checkout': createCheckoutHandler,
  'customer-portal': customerPortalHandler,
  'docs-mcp': docsMcpHandler,
  'download': downloadHandler,
  'fwdstart': fwdstartHandler,
  'geo': geoHandler,
  'gpsjam': gpsjamHandler,
  'health': healthHandler,
  'http-message-signatures-directory': httpMessageSignaturesDirectoryHandler,
  'invalidate-user-api-key-cache': invalidateUserApiKeyCacheHandler,
  'latest-brief': latestBriefHandler,
  'mcp-proxy': mcpProxyHandler,
  'notification-channels': notificationChannelsHandler,
  'notify': notifyHandler,
  'oauth-authorization-server': oauthAuthorizationServerHandler,
  'oauth-protected-resource': oauthProtectedResourceHandler,
  'opensky': openskyHandler,
  'oref-alerts': orefAlertsHandler,
  'pizzint-proxy': pizzintProxyHandler,
  'polymarket': polymarketHandler,
  'product-catalog': productCatalogHandler,
  'reverse-geocode': reverseGeocodeHandler,
  'rss-proxy': rssProxyHandler,
  'sanctions-ofac-proxy': sanctionsOfacProxyHandler,
  'scenario-drain': scenarioDrainHandler,
  'seed-contract-probe': seedContractProbeHandler,
  'seed-health': seedHealthHandler,
  'symbol-search': symbolSearchHandler,
  'telegram-feed': telegramFeedHandler,
  'user-prefs': userPrefsHandler,
  'version': versionHandler,
  'widget-agent': widgetAgentHandler,
  'wm-session': wmSessionHandler,
};

export default async function handler(req: Request, ctx: EdgeCtx): Promise<Response> {
  const url = new URL(req.url);
  // Vercel rewrites preserve the ORIGINAL client-facing pathname in req.url
  // (confirmed empirically -- the destination path in vercel.json's rewrite
  // is where Vercel routes internally, not what the function sees). So for
  // a request that was /api/<name> before the rewrite, parts[2] is <name>,
  // not parts[3] as this file assumed on first deploy (#5839d9b regression:
  // every route hit "Unknown endpoint: " with an empty name).
  const parts = url.pathname.split('/');
  const name = parts[2] ?? '';
  const target = REGISTRY[name];
  if (!target) {
    return new Response(JSON.stringify({ error: `Unknown endpoint: ${name}` }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  // req.url is already /api/<name> -- no reconstruction needed, forward as-is.
  return target(req, ctx);
}
