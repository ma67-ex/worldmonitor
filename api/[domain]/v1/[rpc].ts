// Consolidated domain gateway dispatcher.
//
// Vercel's Hobby plan caps a deployment at 12 Serverless/Edge Functions.
// WorldMonitor's upstream codebase ships one function per domain
// (api/<domain>/v1/[rpc].ts x 34, each a 3-line createDomainGateway(...)
// wrapper), which only works on a paid team plan. This single file replaces
// all 34 of those with ONE function matching the same /api/<domain>/v1/<rpc>
// URL shape via Vercel's dynamic route segments -- Vercel always prefers a
// more specific literal-path file over this dynamic one, so sibling files
// like scenario/v1/status.ts or supply-chain/v1/country-products.ts are
// completely unaffected and keep routing to themselves.
//
// Every domain's actual logic (routes factory + handler) is untouched --
// this only replaces how many separate Vercel functions wrap them.
export const config = { runtime: 'edge' };

import { createDomainGateway, serverOptions } from '../../../server/gateway';

import { createNewsServiceRoutes as newsRoutes } from '../../../src/generated/server/worldmonitor/news/v1/service_server';
import { newsHandler } from '../../../server/worldmonitor/news/v1/handler';
import { createResilienceServiceRoutes as resilienceRoutes } from '../../../src/generated/server/worldmonitor/resilience/v1/service_server';
import { resilienceHandler } from '../../../server/worldmonitor/resilience/v1/handler';
import { createBatchServiceRoutes as batchRoutes } from '../../../src/generated/server/worldmonitor/batch/v1/service_server';
import { batchHandler } from '../../../server/worldmonitor/batch/v1/handler';
import { createSanctionsServiceRoutes as sanctionsRoutes } from '../../../src/generated/server/worldmonitor/sanctions/v1/service_server';
import { sanctionsHandler } from '../../../server/worldmonitor/sanctions/v1/handler';
import { createMarketServiceRoutes as marketRoutes } from '../../../src/generated/server/worldmonitor/market/v1/service_server';
import { marketHandler } from '../../../server/worldmonitor/market/v1/handler';
import { createClimateServiceRoutes as climateRoutes } from '../../../src/generated/server/worldmonitor/climate/v1/service_server';
import { climateHandler } from '../../../server/worldmonitor/climate/v1/handler';
import { createSupplyChainServiceRoutes as supplyChainRoutes } from '../../../src/generated/server/worldmonitor/supply_chain/v1/service_server';
import { supplyChainHandler } from '../../../server/worldmonitor/supply-chain/v1/handler';
import { createInfrastructureServiceRoutes as infrastructureRoutes } from '../../../src/generated/server/worldmonitor/infrastructure/v1/service_server';
import { infrastructureHandler } from '../../../server/worldmonitor/infrastructure/v1/handler';
import { createWebcamServiceRoutes as webcamRoutes } from '../../../src/generated/server/worldmonitor/webcam/v1/service_server';
import { webcamHandler } from '../../../server/worldmonitor/webcam/v1/handler';
import { createSeismologyServiceRoutes as seismologyRoutes } from '../../../src/generated/server/worldmonitor/seismology/v1/service_server';
import { seismologyHandler } from '../../../server/worldmonitor/seismology/v1/handler';
import { createPositiveEventsServiceRoutes as positiveEventsRoutes } from '../../../src/generated/server/worldmonitor/positive_events/v1/service_server';
import { positiveEventsHandler } from '../../../server/worldmonitor/positive-events/v1/handler';
import { createNaturalServiceRoutes as naturalRoutes } from '../../../src/generated/server/worldmonitor/natural/v1/service_server';
import { naturalHandler } from '../../../server/worldmonitor/natural/v1/handler';
import { createImageryServiceRoutes as imageryRoutes } from '../../../src/generated/server/worldmonitor/imagery/v1/service_server';
import { imageryHandler } from '../../../server/worldmonitor/imagery/v1/handler';
import { createGivingServiceRoutes as givingRoutes } from '../../../src/generated/server/worldmonitor/giving/v1/service_server';
import { givingHandler } from '../../../server/worldmonitor/giving/v1/handler';
import { createConsumerPricesServiceRoutes as consumerPricesRoutes } from '../../../src/generated/server/worldmonitor/consumer_prices/v1/service_server';
import { consumerPricesHandler } from '../../../server/worldmonitor/consumer-prices/v1/handler';
import { createIntelligenceServiceRoutes as intelligenceRoutes } from '../../../src/generated/server/worldmonitor/intelligence/v1/service_server';
import { intelligenceHandler } from '../../../server/worldmonitor/intelligence/v1/handler';
import { createForecastServiceRoutes as forecastRoutes } from '../../../src/generated/server/worldmonitor/forecast/v1/service_server';
import { forecastHandler } from '../../../server/worldmonitor/forecast/v1/handler';
import { createResearchServiceRoutes as researchRoutes } from '../../../src/generated/server/worldmonitor/research/v1/service_server';
import { researchHandler } from '../../../server/worldmonitor/research/v1/handler';
import { createMaritimeServiceRoutes as maritimeRoutes } from '../../../src/generated/server/worldmonitor/maritime/v1/service_server';
import { maritimeHandler } from '../../../server/worldmonitor/maritime/v1/handler';
import { createCyberServiceRoutes as cyberRoutes } from '../../../src/generated/server/worldmonitor/cyber/v1/service_server';
import { cyberHandler } from '../../../server/worldmonitor/cyber/v1/handler';
import { createThermalServiceRoutes as thermalRoutes } from '../../../src/generated/server/worldmonitor/thermal/v1/service_server';
import { thermalHandler } from '../../../server/worldmonitor/thermal/v1/handler';
import { createDisplacementServiceRoutes as displacementRoutes } from '../../../src/generated/server/worldmonitor/displacement/v1/service_server';
import { displacementHandler } from '../../../server/worldmonitor/displacement/v1/handler';
import { createConflictServiceRoutes as conflictRoutes } from '../../../src/generated/server/worldmonitor/conflict/v1/service_server';
import { conflictHandler } from '../../../server/worldmonitor/conflict/v1/handler';
import { createTradeServiceRoutes as tradeRoutes } from '../../../src/generated/server/worldmonitor/trade/v1/service_server';
import { tradeHandler } from '../../../server/worldmonitor/trade/v1/handler';
import { createLeadsServiceRoutes as leadsRoutes } from '../../../src/generated/server/worldmonitor/leads/v1/service_server';
import { leadsHandler } from '../../../server/worldmonitor/leads/v1/handler';
import { createHealthServiceRoutes as healthRoutes } from '../../../src/generated/server/worldmonitor/health/v1/service_server';
import { healthHandler } from '../../../server/worldmonitor/health/v1/handler';
import { createRadiationServiceRoutes as radiationRoutes } from '../../../src/generated/server/worldmonitor/radiation/v1/service_server';
import { radiationHandler } from '../../../server/worldmonitor/radiation/v1/handler';
import { createUnrestServiceRoutes as unrestRoutes } from '../../../src/generated/server/worldmonitor/unrest/v1/service_server';
import { unrestHandler } from '../../../server/worldmonitor/unrest/v1/handler';
import { createPredictionServiceRoutes as predictionRoutes } from '../../../src/generated/server/worldmonitor/prediction/v1/service_server';
import { predictionHandler } from '../../../server/worldmonitor/prediction/v1/handler';
import { createEconomicServiceRoutes as economicRoutes } from '../../../src/generated/server/worldmonitor/economic/v1/service_server';
import { economicHandler } from '../../../server/worldmonitor/economic/v1/handler';
import { createMilitaryServiceRoutes as militaryRoutes } from '../../../src/generated/server/worldmonitor/military/v1/service_server';
import { militaryHandler } from '../../../server/worldmonitor/military/v1/handler';
import { createWildfireServiceRoutes as wildfireRoutes } from '../../../src/generated/server/worldmonitor/wildfire/v1/service_server';
import { wildfireHandler } from '../../../server/worldmonitor/wildfire/v1/handler';
import { createAviationServiceRoutes as aviationRoutes } from '../../../src/generated/server/worldmonitor/aviation/v1/service_server';
import { aviationHandler } from '../../../server/worldmonitor/aviation/v1/handler';
import { createScenarioServiceRoutes as scenarioRoutes } from '../../../src/generated/server/worldmonitor/scenario/v1/service_server';
import { scenarioHandler } from '../../../server/worldmonitor/scenario/v1/handler';

type EdgeHandler = (req: Request, ctx?: unknown) => Promise<Response>;

const REGISTRY: Record<string, EdgeHandler> = {
  news: createDomainGateway(newsRoutes(newsHandler, serverOptions)),
  resilience: createDomainGateway(resilienceRoutes(resilienceHandler, serverOptions)),
  batch: createDomainGateway(batchRoutes(batchHandler, serverOptions)),
  sanctions: createDomainGateway(sanctionsRoutes(sanctionsHandler, serverOptions)),
  market: createDomainGateway(marketRoutes(marketHandler, serverOptions)),
  climate: createDomainGateway(climateRoutes(climateHandler, serverOptions)),
  'supply-chain': createDomainGateway(supplyChainRoutes(supplyChainHandler, serverOptions)),
  infrastructure: createDomainGateway(infrastructureRoutes(infrastructureHandler, serverOptions)),
  webcam: createDomainGateway(webcamRoutes(webcamHandler, serverOptions)),
  seismology: createDomainGateway(seismologyRoutes(seismologyHandler, serverOptions)),
  'positive-events': createDomainGateway(positiveEventsRoutes(positiveEventsHandler, serverOptions)),
  natural: createDomainGateway(naturalRoutes(naturalHandler, serverOptions)),
  imagery: createDomainGateway(imageryRoutes(imageryHandler, serverOptions)),
  giving: createDomainGateway(givingRoutes(givingHandler, serverOptions)),
  'consumer-prices': createDomainGateway(consumerPricesRoutes(consumerPricesHandler, serverOptions)),
  intelligence: createDomainGateway(intelligenceRoutes(intelligenceHandler, serverOptions)),
  forecast: createDomainGateway(forecastRoutes(forecastHandler, serverOptions)),
  research: createDomainGateway(researchRoutes(researchHandler, serverOptions)),
  maritime: createDomainGateway(maritimeRoutes(maritimeHandler, serverOptions)),
  cyber: createDomainGateway(cyberRoutes(cyberHandler, serverOptions)),
  thermal: createDomainGateway(thermalRoutes(thermalHandler, serverOptions)),
  displacement: createDomainGateway(displacementRoutes(displacementHandler, serverOptions)),
  conflict: createDomainGateway(conflictRoutes(conflictHandler, serverOptions)),
  trade: createDomainGateway(tradeRoutes(tradeHandler, serverOptions)),
  leads: createDomainGateway(leadsRoutes(leadsHandler, serverOptions)),
  health: createDomainGateway(healthRoutes(healthHandler, serverOptions)),
  radiation: createDomainGateway(radiationRoutes(radiationHandler, serverOptions)),
  unrest: createDomainGateway(unrestRoutes(unrestHandler, serverOptions)),
  prediction: createDomainGateway(predictionRoutes(predictionHandler, serverOptions)),
  economic: createDomainGateway(economicRoutes(economicHandler, serverOptions)),
  military: createDomainGateway(militaryRoutes(militaryHandler, serverOptions)),
  wildfire: createDomainGateway(wildfireRoutes(wildfireHandler, serverOptions)),
  aviation: createDomainGateway(aviationRoutes(aviationHandler, serverOptions)),
  scenario: createDomainGateway(scenarioRoutes(scenarioHandler, serverOptions)),
};

export default async function handler(req: Request, ctx?: unknown): Promise<Response> {
  const pathname = new URL(req.url).pathname;
  const domain = pathname.split('/')[2] ?? '';
  const gateway = REGISTRY[domain];
  if (!gateway) {
    return new Response(JSON.stringify({ error: `Unknown domain: ${domain}` }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return gateway(req, ctx);
}
