import type { FastifyInstance } from "fastify";

import { requireAuth } from "../../auth/context.js";
import { buildIntegrationObservation } from "../../engines/integration-observation.js";

export async function integrationRoutes(app: FastifyInstance) {
  /** Config beyanı vs canlı gözlem — Cloud Agent create yok; secret yok. */
  app.get("/api/integrations/status", async (request) => {
    requireAuth(request);
    return buildIntegrationObservation();
  });
}
