export const config = { runtime: 'edge' };

import { REGISTRY } from '../../domain-gateway/[domain]/v1/[...rest]';
import { rewriteToSebuf } from '../../../server/alias-rewrite';

const gateway = REGISTRY.scenario!;

// Alias for documented v1 URL. See server/alias-rewrite.ts.
export default (req: Request, ctx: { waitUntil: (p: Promise<unknown>) => void }) =>
  rewriteToSebuf(req, '/api/scenario/v1/get-scenario-status', gateway, ctx);
