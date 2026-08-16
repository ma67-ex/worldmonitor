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
import analyticsHealthHandler from '../_analytics-health';
import askHandler from '../_ask';
import bootstrapHandler from '../_bootstrap';
import cachePurgeHandler from '../_cache-purge';
import chatAnalystHandler from '../_chat-analyst';
import correlationRuntimeModeHandler from '../_correlation-runtime-mode';
import createCheckoutHandler from '../_create-checkout';
import customerPortalHandler from '../_customer-portal';
import docsMcpHandler from '../_docs-mcp';
import downloadHandler from '../_download';
import fwdstartHandler from '../_fwdstart';
import geoHandler from '../_geo';
import gpsjamHandler from '../_gpsjam';
import healthHandler from '../_health';
import httpMessageSignaturesDirectoryHandler from '../_http-message-signatures-directory';
import invalidateUserApiKeyCacheHandler from '../_invalidate-user-api-key-cache';
import latestBriefHandler from '../_latest-brief';
import mcpProxyHandler from '../_mcp-proxy';
import notificationChannelsHandler from '../_notification-channels';
import notifyHandler from '../_notify';
import oauthAuthorizationServerHandler from '../_oauth-authorization-server';
import oauthProtectedResourceHandler from '../_oauth-protected-resource';
import openskyHandler from '../_opensky';
import orefAlertsHandler from '../_oref-alerts';
import pizzintProxyHandler from '../_pizzint-proxy';
import polymarketHandler from '../_polymarket';
import productCatalogHandler from '../_product-catalog';
import reverseGeocodeHandler from '../_reverse-geocode';
import rssProxyHandler from '../_rss-proxy';
import seedContractProbeHandler from '../_seed-contract-probe';
import seedHealthHandler from '../_seed-health';
import symbolSearchHandler from '../_symbol-search';
import telegramFeedHandler from '../_telegram-feed';
import userPrefsHandler from '../_user-prefs';
import versionHandler from '../_version';
import widgetAgentHandler from '../_widget-agent';
import wmSessionHandler from '../_wm-session';

type EdgeCtx = { waitUntil: (p: Promise<unknown>) => void };
type EdgeHandler = (req: Request, ctx?: EdgeCtx) => Response | Promise<Response>;

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
  'seed-contract-probe': seedContractProbeHandler,
  'seed-health': seedHealthHandler,
  'symbol-search': symbolSearchHandler,
  'telegram-feed': telegramFeedHandler,
  'user-prefs': userPrefsHandler,
  'version': versionHandler,
  'widget-agent': widgetAgentHandler,
  'wm-session': wmSessionHandler,
};

export default async function handler(req: Request, ctx?: unknown): Promise<Response> {
  const url = new URL(req.url);
  const parts = url.pathname.split('/');
  const name = parts[3] ?? '';
  const target = REGISTRY[name];
  if (!target) {
    return new Response(JSON.stringify({ error: `Unknown endpoint: ${name}` }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  // Reconstruct the original /api/<name> pathname (strip the
  // /misc-gateway/<name> wrapper) so each handler's own logic sees the
  // same request shape it always has.
  const originalPathname = '/api/' + name;
  const forwardedUrl = new URL(originalPathname + url.search, url.origin);
  const forwardedReq = new Request(forwardedUrl.toString(), req);
  return target(forwardedReq, ctx);
}
