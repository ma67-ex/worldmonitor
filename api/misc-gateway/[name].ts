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

import a2aHandler from '../a2a';
import agentAuthHandler from '../agent-auth';
import analyticsHealthHandler from '../analytics-health';
import askHandler from '../ask';
import bootstrapHandler from '../bootstrap';
import cachePurgeHandler from '../cache-purge';
import chatAnalystHandler from '../chat-analyst';
import correlationRuntimeModeHandler from '../correlation-runtime-mode';
import createCheckoutHandler from '../create-checkout';
import customerPortalHandler from '../customer-portal';
import docsMcpHandler from '../docs-mcp';
import downloadHandler from '../download';
import fwdstartHandler from '../fwdstart';
import geoHandler from '../geo';
import gpsjamHandler from '../gpsjam';
import healthHandler from '../health';
import httpMessageSignaturesDirectoryHandler from '../http-message-signatures-directory';
import invalidateUserApiKeyCacheHandler from '../invalidate-user-api-key-cache';
import latestBriefHandler from '../latest-brief';
import mcpProxyHandler from '../mcp-proxy';
import notificationChannelsHandler from '../notification-channels';
import notifyHandler from '../notify';
import oauthAuthorizationServerHandler from '../oauth-authorization-server';
import oauthProtectedResourceHandler from '../oauth-protected-resource';
import openskyHandler from '../opensky';
import orefAlertsHandler from '../oref-alerts';
import pizzintProxyHandler from '../pizzint-proxy';
import polymarketHandler from '../polymarket';
import productCatalogHandler from '../product-catalog';
import reverseGeocodeHandler from '../reverse-geocode';
import rssProxyHandler from '../rss-proxy';
import seedContractProbeHandler from '../seed-contract-probe';
import seedHealthHandler from '../seed-health';
import symbolSearchHandler from '../symbol-search';
import telegramFeedHandler from '../telegram-feed';
import userPrefsHandler from '../user-prefs';
import versionHandler from '../version';
import widgetAgentHandler from '../widget-agent';
import wmSessionHandler from '../wm-session';

type EdgeHandler = (req: Request, ctx?: unknown) => Response | Promise<Response>;

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
