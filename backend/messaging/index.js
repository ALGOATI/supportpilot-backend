import { createConversationEngine } from "./core/conversationEngine.js";
import { createConversationStore } from "./persistence/conversationStore.js";
import { createWhatsAppAdapter } from "./channels/whatsapp.js";

export function createMessagingSystem(deps) {
  const store = createConversationStore(deps.storeDeps);
  const conversationEngine = createConversationEngine({
    ...deps.coreDeps,
    maybeForwardPausedInboundToOwner: (...args) =>
      deps.lazyAdapters?.whatsapp?.maybeForwardPausedInboundToOwner(...args),
  });

  const whatsappAdapter = createWhatsAppAdapter({
    ...deps.channelDeps,
    store,
    engine: conversationEngine,
    getClientWhatsAppConfig: deps.channelDeps.getClientWhatsAppConfig,
    findClientByPhoneNumberId: deps.channelDeps.findClientByPhoneNumberId,
  });

  const lazyAdapters = {
    whatsapp: whatsappAdapter,
  };

  // patch lazily injected adapter refs after construction
  if (deps.lazyAdapters) {
    deps.lazyAdapters.whatsapp = whatsappAdapter;
  }

  return {
    store,
    conversationEngine,
    whatsappAdapter,
    adapters: lazyAdapters,
  };
}
