import { drizzle } from "drizzle-orm/node-postgres";
import { createApp } from "./app.js";
import { createSessionMiddleware } from "./auth/sessions.js";
import { createDatabaseAuthorizationGuards } from "./auth/authorization.js";
import { loadCurrentUserIdentity } from "./auth/current-user.js";
import { loadConfig } from "./config/environment.js";
import {
  checkDatabaseConnection,
  createDatabasePool,
  formatDatabaseConnectionError,
} from "./db/client.js";
import * as databaseSchema from "./db/schema.js";
import { registerAuthRoutes } from "./http/auth.js";
import { registerCurrentUserRoute } from "./http/current-user.js";
import {
  registerActiveVocabularyRoute,
  registerMgaMutationRoute,
  registerVocabularyMutationRoutes,
} from "./http/vocabulary.js";
import { StructuredLogger } from "./logging/logger.js";
import { loadActiveVocabulary } from "./vocabulary/active.js";
import {
  createCarrierVocabulary,
  createPolicyTypeVocabulary,
} from "./vocabulary/create.js";
import { createMgaVocabulary } from "./vocabulary/mga-create.js";
import { registerDraftCreateRoute } from "./http/drafts.js";
import { createOwnDraft } from "./drafts/create.js";

const config = loadConfig();
const logger = new StructuredLogger();
const pool = createDatabasePool(config.databaseUrl);
const database = drizzle(pool, { schema: databaseSchema });
const authorization = createDatabaseAuthorizationGuards(database, logger);
const app = createApp({
  logger,
  readinessCheck: () => checkDatabaseConnection(pool),
  registerRoutes: (routes) => {
    registerAuthRoutes(routes, { database, logger });
    registerCurrentUserRoute(routes, {
      authorization,
      loadIdentity: (userId) => loadCurrentUserIdentity(database, userId),
    });
    registerActiveVocabularyRoute(routes, {
      authorization,
      load: () => loadActiveVocabulary(database),
      logger,
    });
    registerVocabularyMutationRoutes(routes, {
      authorization,
      createCarrier: (context, input) =>
        createCarrierVocabulary(database, context, input, logger),
      createPolicyType: (context, input) =>
        createPolicyTypeVocabulary(database, context, input, logger),
    });
    registerMgaMutationRoute(routes, {
      authorization,
      createMga: (context, input) =>
        createMgaVocabulary(database, context, input, logger),
    });
    registerDraftCreateRoute(routes, {
      authorization,
      create: (context, input) =>
        createOwnDraft(database, context, input),
      logger,
    });
  },
  sessionMiddleware: createSessionMiddleware(pool, {
    logger,
    nodeEnv: config.nodeEnv,
    secret: config.sessionSecret,
  }),
  trustProxy: config.nodeEnv === "production",
});
let databaseConnected = false;

try {
  await checkDatabaseConnection(pool);
  databaseConnected = true;
  logger.info("Database connection established", {
    component: "database",
    event: "database_connection_established",
  });
} catch (error) {
  logger.error(
    formatDatabaseConnectionError(error),
    { component: "database", event: "database_connection_failed" },
    error,
  );
  process.exitCode = 1;
  await pool.end();
}

if (databaseConnected) {
  app.listen(config.port, () => {
    logger.info("WCIB Dashboard API listening", {
      component: "http",
      environment: config.nodeEnv,
      event: "server_listening",
      port: config.port,
    });
  });
}
