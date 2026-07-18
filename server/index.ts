import { drizzle } from "drizzle-orm/node-postgres";
import { resolve } from "node:path";
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
import { registerAdminVocabularyRoutes } from "./http/admin-vocabulary.js";
import {
  loadAdminVocabularyManagementSource,
  setAdminVocabularyActive,
} from "./vocabulary/manage.js";
import {
  registerDraftCreateRoute,
  registerDraftEditRoute,
  registerDraftFlagRoute,
  registerDraftListRoute,
  registerDraftSubmitRoute,
  registerDraftWithdrawHelpRoute,
  registerDraftWithdrawSubmissionRoute,
} from "./http/drafts.js";
import { createOwnDraft } from "./drafts/create.js";
import { listOwnDrafts } from "./drafts/list.js";
import { editOwnDraft } from "./drafts/edit.js";
import { submitOwnDraft } from "./drafts/submit.js";
import { flagOwnDraft } from "./drafts/flag.js";
import { withdrawOwnFlaggedHelp } from "./drafts/withdraw-help.js";
import { withdrawOwnSubmittedDraft } from "./drafts/withdraw-submission.js";
import { listDraftAssignmentOptions } from "./drafts/assignment-options.js";
import { registerDraftAssignmentOptionsRoute } from "./http/draft-assignment-options.js";
import { registerIpfsPriorFinancingRoute } from "./http/ipfs.js";
import { findPriorIpfsFinancing } from "./policies/ipfs-history.js";
import { registerIpfsWorkQueueRoute } from "./http/ipfs-work-queue.js";
import { registerPolicyIpfsPushedRoute } from "./http/ipfs-pushed.js";
import { setPolicyIpfsPushedState } from "./policies/ipfs-pushed.js";
import { registerApprovalWorkRoute } from "./http/approval-queue.js";
import { listApprovalWork } from "./approval-queue/list.js";
import { registerApprovalWorkDeletionRoutes } from "./http/approval-work-deletions.js";
import {
  listDeletedApprovalWork,
  restoreApprovalWork,
  softDeleteApprovalWork,
} from "./approval-queue/soft-delete.js";
import { registerApprovalActionRoutes } from "./http/approval-actions.js";
import {
  approveCorrectedFlaggedHelp,
  approveCorrectedPendingSubmission,
  approvePendingSubmission,
  pushThroughFlaggedHelp,
} from "./approval-queue/approve.js";
import {
  approvePendingSubmissionWithOverride,
} from "./approval-queue/approve-with-override.js";
import {
  sendBackFlaggedHelp,
  sendBackPendingSubmission,
} from "./approval-queue/send-back.js";
import { registerPolicyLedgerRoutes } from "./http/policies.js";
import {
  getPolicyLedgerItem,
  listDeletedPolicyLedgerItems,
  listIpfsWorkQueueSources,
  listPolicyLedger,
} from "./policies/ledger.js";
import { registerPolicyLedgerCorrectionRoute } from "./http/policy-corrections.js";
import { correctPolicyLedgerItem } from "./policies/ledger-corrections.js";
import { registerPolicyDeletionRoutes } from "./http/policy-deletions.js";
import {
  restorePolicy,
  softDeletePolicy,
} from "./policies/soft-delete.js";
import { registerMgaPayableRoute } from "./http/mga-payables.js";
import { listMgaPayableSources } from "./policies/mga-payables.js";
import { registerMgaPayableStateRoute } from "./http/mga-payable-state.js";
import { registerMgaPayableGroupStateRoute } from "./http/mga-payable-group-state.js";
import { changeMgaPayableGroupState } from "./policies/mga-payable-group-state.js";
import { changeMgaPayableState } from "./policies/mga-payable-state.js";
import { registerPaySheetReadRoutes } from "./http/pay-sheets.js";
import { registerPaySheetExportRoutes } from "./http/pay-sheet-exports.js";
import {
  getPaySheetSource,
  listPaySheetSources,
} from "./pay-sheets/read.js";
import { registerPaySheetCloseRoute } from "./http/pay-sheet-close.js";
import { closePaySheetWithCascade } from "./pay-sheets/close.js";
import { registerPaySheetBootstrapRoute } from "./http/pay-sheet-bootstrap.js";
import { initializeSophiaPaySheet } from "./pay-sheets/initialize.js";
import { registerPaySheetAdjustmentRoutes } from "./http/pay-sheet-adjustments.js";
import {
  createPaySheetAdjustment,
  deletePaySheetAdjustment,
  updatePaySheetAdjustment,
} from "./pay-sheets/adjustments.js";
import { getPaySheetAdjustmentTarget } from "./pay-sheets/adjustment-target.js";
import {
  registerMyCommissionReceiptRoute,
  registerMyCommissionsRoute,
} from "./http/my-commissions.js";
import { listMyCommissionSources } from "./commissions/read.js";
import { setProducerCommissionReceipt } from "./commissions/receipts.js";
import { listOwnMyItemSources } from "./drafts/my-items.js";
import { registerMyItemsRoute } from "./http/my-items.js";
import { registerAdminStaffRoutes } from "./http/admin-staff.js";
import {
  createAdminProducerRate,
  createAdminStaff,
  getAdminStaffSource,
  listAdminStaffSources,
  setAdminStaffActive,
  updateAdminProducerRate,
  updateAdminStaff,
} from "./auth/admin-staff.js";
import { registerAdminOfficeRoutes } from "./http/admin-office-locations.js";
import {
  createAdminOfficeLocation,
  loadAdminOfficeManagementSource,
  renameAdminOfficeLocation,
  setAdminOfficeLocationActive,
} from "./offices/admin.js";
import { registerKpiTargetRoutes } from "./http/kpi-targets.js";
import { registerKpiActualRoute } from "./http/kpi-actuals.js";
import {
  listKpiTargetSources,
  upsertKpiTarget,
} from "./kpi/targets.js";
import { loadKpiActualSource } from "./kpi/actuals.js";
import { registerPolicyChangeRequestRoutes } from "./http/policy-change-requests.js";
import {
  correctPolicyChangeRequest,
  createOwnPolicyChangeRequest,
  listOwnPolicyChangeRequests,
  resolvePolicyChangeRequestAsIs,
  sendBackPolicyChangeRequest,
} from "./policy-change-requests/service.js";
import { registerBusinessStateRoutes } from "./http/business-state.js";
import {
  listBusinessStateSources,
  resetBusinessState,
  restoreBusinessState,
} from "./business-state/service.js";

const config = loadConfig();
const logger = new StructuredLogger();
const pool = createDatabasePool(config.databaseUrl);
const database = drizzle(pool, { schema: databaseSchema });
const authorization = createDatabaseAuthorizationGuards(database, logger);
const app = createApp({
  clientAssetsDirectory:
    config.nodeEnv === "production" ? resolve("dist/client") : undefined,
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
    registerAdminVocabularyRoutes(routes, {
      authorization,
      list: (context) =>
        loadAdminVocabularyManagementSource(database, context),
      logger,
      setActive: (context, kind, itemId, input) =>
        setAdminVocabularyActive(
          database,
          context,
          kind,
          itemId,
          input,
          logger,
        ),
    });
    registerDraftCreateRoute(routes, {
      authorization,
      create: (context, input) =>
        createOwnDraft(database, context, input),
      logger,
    });
    registerDraftListRoute(routes, {
      authorization,
      list: (context, query) => listOwnDrafts(database, context, query),
      logger,
    });
    registerDraftEditRoute(routes, {
      authorization,
      edit: (context, draftId, input) =>
        editOwnDraft(database, context, draftId, input),
      logger,
    });
    registerDraftSubmitRoute(routes, {
      authorization,
      logger,
      submit: (context, draftId) => submitOwnDraft(database, context, draftId),
    });
    registerDraftFlagRoute(routes, {
      authorization,
      flag: (context, draftId, input) =>
        flagOwnDraft(database, context, draftId, input),
      logger,
    });
    registerDraftWithdrawHelpRoute(routes, {
      authorization,
      logger,
      withdraw: (context, draftId) =>
        withdrawOwnFlaggedHelp(database, context, draftId),
    });
    registerDraftWithdrawSubmissionRoute(routes, {
      authorization,
      logger,
      withdraw: (context, draftId) =>
        withdrawOwnSubmittedDraft(database, context, draftId),
    });
    registerDraftAssignmentOptionsRoute(routes, {
      authorization,
      list: () => listDraftAssignmentOptions(database),
      logger,
    });
    registerIpfsPriorFinancingRoute(routes, {
      authorization,
      find: (context, insuredName) =>
        findPriorIpfsFinancing(database, context, insuredName),
      logger,
    });
    registerIpfsWorkQueueRoute(routes, {
      authorization,
      list: (context) => listIpfsWorkQueueSources(database, context),
      logger,
    });
    registerPolicyIpfsPushedRoute(routes, {
      authorization,
      logger,
      setState: (context, policyId, input) =>
        setPolicyIpfsPushedState(
          database,
          context,
          policyId,
          input,
          logger,
        ),
    });
    registerApprovalWorkRoute(routes, {
      authorization,
      list: (context, query) => listApprovalWork(database, context, query),
      logger,
    });
    registerApprovalWorkDeletionRoutes(routes, {
      authorization,
      list: (context) => listDeletedApprovalWork(database, context),
      logger,
      restore: (context, kind, targetId, input) =>
        restoreApprovalWork(
          database,
          context,
          kind,
          targetId,
          input,
          logger,
        ),
      softDelete: (context, kind, targetId, input) =>
        softDeleteApprovalWork(
          database,
          context,
          kind,
          targetId,
          input,
          logger,
        ),
    });
    registerApprovalActionRoutes(routes, {
      approve: (context, queueEntryId) =>
        approvePendingSubmission(database, context, queueEntryId),
      approveFixedHelp: (context, draftId, patch) =>
        approveCorrectedFlaggedHelp(database, context, draftId, patch),
      approveFixedSubmission: (context, queueEntryId, patch) =>
        approveCorrectedPendingSubmission(
          database,
          context,
          queueEntryId,
          patch,
        ),
      approveWithOverride: (context, queueEntryId, input) =>
        approvePendingSubmissionWithOverride(
          database,
          context,
          queueEntryId,
          input,
          logger,
        ),
      authorization,
      logger,
      pushThroughHelp: (context, draftId) =>
        pushThroughFlaggedHelp(database, context, draftId),
      sendBackHelp: (context, draftId, input) =>
        sendBackFlaggedHelp(database, context, draftId, input),
      sendBackSubmission: (context, queueEntryId, input) =>
        sendBackPendingSubmission(database, context, queueEntryId, input),
    });
    registerPolicyLedgerRoutes(routes, {
      authorization,
      get: (context, policyId) =>
        getPolicyLedgerItem(database, context, policyId),
      list: (context, query) => listPolicyLedger(database, context, query),
      logger,
    });
    registerPolicyLedgerCorrectionRoute(routes, {
      authorization,
      correct: (context, policyId, input) =>
        correctPolicyLedgerItem(
          database,
          context,
          policyId,
          input,
          logger,
        ),
      logger,
    });
    registerPolicyDeletionRoutes(routes, {
      authorization,
      list: (context) => listDeletedPolicyLedgerItems(database, context),
      logger,
      restore: (context, policyId, input) =>
        restorePolicy(database, context, policyId, input, logger),
      softDelete: (context, policyId, input) =>
        softDeletePolicy(database, context, policyId, input, logger),
    });
    registerPolicyChangeRequestRoutes(routes, {
      authorization,
      correct: (context, requestId, input) =>
        correctPolicyChangeRequest(
          database,
          context,
          requestId,
          input,
          logger,
        ),
      create: (context, policyId, input) =>
        createOwnPolicyChangeRequest(
          database,
          context,
          policyId,
          input,
          logger,
        ),
      listMine: (context) =>
        listOwnPolicyChangeRequests(database, context),
      logger,
      resolveAsIs: (context, requestId) =>
        resolvePolicyChangeRequestAsIs(
          database,
          context,
          requestId,
          logger,
        ),
      sendBack: (context, requestId, input) =>
        sendBackPolicyChangeRequest(
          database,
          context,
          requestId,
          input,
          logger,
        ),
    });
    registerMgaPayableRoute(routes, {
      authorization,
      list: (context, query) =>
        listMgaPayableSources(database, context, query),
      logger,
    });
    registerMgaPayableStateRoute(routes, {
      authorization,
      change: (context, policyId, input) =>
        changeMgaPayableState(
          database,
          context,
          policyId,
          input,
          logger,
        ),
      logger,
    });
    registerMgaPayableGroupStateRoute(routes, {
      authorization,
      change: (context, mgaId, input) =>
        changeMgaPayableGroupState(
          database,
          context,
          mgaId,
          input,
          logger,
        ),
      logger,
    });
    registerPaySheetReadRoutes(routes, {
      authorization,
      get: (context, paySheetId) =>
        getPaySheetSource(database, context, paySheetId),
      list: (context, query) =>
        listPaySheetSources(database, context, query),
      logger,
    });
    registerPaySheetExportRoutes(routes, {
      authorization,
      list: (context, query) =>
        listPaySheetSources(database, context, query),
      logger,
    });
    registerPaySheetCloseRoute(routes, {
      authorization,
      close: (context, paySheetId, cascadeProducerSheets) =>
        closePaySheetWithCascade(
          database,
          context,
          paySheetId,
          cascadeProducerSheets,
          logger,
        ),
      get: (context, paySheetId) =>
        getPaySheetSource(database, context, paySheetId),
      logger,
    });
    registerPaySheetBootstrapRoute(routes, {
      authorization,
      bootstrap: (context, input) =>
        initializeSophiaPaySheet(database, context, input, logger),
      get: (context, paySheetId) =>
        getPaySheetSource(database, context, paySheetId),
      logger,
    });
    registerPaySheetAdjustmentRoutes(routes, {
      authorization,
      create: (context, input) =>
        createPaySheetAdjustment(database, context, input, logger),
      delete: (context, adjustmentId) =>
        deletePaySheetAdjustment(database, context, adjustmentId, logger),
      getSheet: (context, paySheetId) =>
        getPaySheetSource(database, context, paySheetId),
      getTarget: (context, adjustmentId) =>
        getPaySheetAdjustmentTarget(database, context, adjustmentId),
      logger,
      update: (context, adjustmentId, input) =>
        updatePaySheetAdjustment(
          database,
          context,
          adjustmentId,
          input,
          logger,
        ),
    });
    registerMyCommissionsRoute(routes, {
      authorization,
      list: (context, query) =>
        listMyCommissionSources(database, context, query),
      logger,
    });
    registerMyCommissionReceiptRoute(routes, {
      authorization,
      change: (context, policyId, input) =>
        setProducerCommissionReceipt(
          database,
          context,
          policyId,
          input,
          logger,
        ),
    });
    registerMyItemsRoute(routes, {
      authorization,
      list: (context) => listOwnMyItemSources(database, context),
      logger,
    });
    registerAdminStaffRoutes(routes, {
      authorization,
      create: (context, input) =>
        createAdminStaff(database, context, input, logger),
      createRate: (context, userId, input) =>
        createAdminProducerRate(database, context, userId, input, logger),
      get: (context, userId) =>
        getAdminStaffSource(database, context, userId),
      list: (context) => listAdminStaffSources(database, context),
      logger,
      setActive: (context, userId, active) =>
        setAdminStaffActive(database, context, userId, active, logger),
      update: (context, userId, input) =>
        updateAdminStaff(database, context, userId, input, logger),
      updateRate: (context, userId, rateId, input) =>
        updateAdminProducerRate(
          database,
          context,
          userId,
          rateId,
          input,
          logger,
        ),
    });
    registerAdminOfficeRoutes(routes, {
      authorization,
      create: (context, input) =>
        createAdminOfficeLocation(database, context, input, logger),
      list: (context) => loadAdminOfficeManagementSource(database, context),
      logger,
      rename: (context, officeLocationId, input) =>
        renameAdminOfficeLocation(
          database,
          context,
          officeLocationId,
          input,
          logger,
        ),
      setActive: (context, officeLocationId, active) =>
        setAdminOfficeLocationActive(
          database,
          context,
          officeLocationId,
          active,
          logger,
        ),
    });
    registerBusinessStateRoutes(routes, {
      authorization,
      list: (context) => listBusinessStateSources(database, context),
      logger,
      reset: (context, input) =>
        resetBusinessState(database, context, input),
      restore: (context, generationId, input) =>
        restoreBusinessState(
          database,
          context,
          generationId,
          input,
        ),
    });
    registerKpiTargetRoutes(routes, {
      authorization,
      list: (context, query) =>
        listKpiTargetSources(database, context, query),
      logger,
      upsert: (context, scopeType, year, input) =>
        upsertKpiTarget(
          database,
          context,
          scopeType,
          year,
          input,
          logger,
        ),
    });
    registerKpiActualRoute(routes, {
      authorization,
      list: (context, query) =>
        loadKpiActualSource(database, context, query),
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
