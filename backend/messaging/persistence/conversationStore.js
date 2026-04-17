export function createConversationStore(deps) {
  return {
    getConversationByIdForUser: deps.getConversationByIdForUser,
    upsertConversationRecord: deps.upsertConversationRecord,
    insertMessageWithFallback: deps.insertMessageWithFallback,
    getOrCreateConversationMap: deps.getOrCreateConversationMap,
    reserveWhatsAppInboundMessage: deps.reserveWhatsAppInboundMessage,
    loadBusinessTimezone: deps.loadBusinessTimezone,
    loadUserPlan: deps.loadUserPlan,
    loadBusinessMaxMessages: deps.loadBusinessMaxMessages,
    getPlanLimits: deps.getPlanLimits,
    countMonthlyAiConversations: deps.countMonthlyAiConversations,
    reserveConversationUsageAndIncrement: deps.reserveConversationUsageAndIncrement,
    getUsageMonthKey: deps.getUsageMonthKey,
    getMonthStartIso: deps.getMonthStartIso,
    resolveBusinessOwnerByPhone: deps.resolveBusinessOwnerByPhone,
    getPausedWhatsAppConversations: deps.getPausedWhatsAppConversations,
    getLatestPausedWhatsAppConversation: deps.getLatestPausedWhatsAppConversation,
  };
}
