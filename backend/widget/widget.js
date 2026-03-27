(function () {
  if (window.__supportPilotWidgetLoaded) return;
  window.__supportPilotWidgetLoaded = true;

  function findScriptElement() {
    if (document.currentScript) return document.currentScript;
    var scripts = document.getElementsByTagName("script");
    for (var i = scripts.length - 1; i >= 0; i -= 1) {
      var src = String(scripts[i].src || "");
      if (src.indexOf("/widget.js") !== -1) return scripts[i];
    }
    return null;
  }

  var scriptEl = findScriptElement();
  if (!scriptEl) return;

  var clientId = String(scriptEl.getAttribute("data-client-id") || "").trim();
  if (!clientId) {
    console.error("SupportPilot widget: missing data-client-id");
    return;
  }

  var apiBase = "";
  try {
    var explicitBase = String(scriptEl.getAttribute("data-api-base") || "").trim();
    apiBase = explicitBase || new URL(scriptEl.src, window.location.href).origin;
  } catch (err) {
    logWidgetError("resolve api base", err);
    apiBase = window.location.origin;
  }

  var storageKey = "supportpilot_widget_v1_" + clientId;
  var fallbackIdCounter = 0;

  function createId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return window.crypto.randomUUID();
    }
    if (window.crypto && typeof window.crypto.getRandomValues === "function") {
      var bytes = new Uint8Array(16);
      window.crypto.getRandomValues(bytes);
      var hex = Array.prototype.map.call(bytes, function (byte) {
        return byte.toString(16).padStart(2, "0");
      }).join("");
      return "id_" + hex;
    }
    fallbackIdCounter += 1;
    return "id_" + Date.now().toString(36) + "_" + fallbackIdCounter.toString(36);
  }

  function logWidgetError(context, err) {
    if (!window.console || typeof window.console.warn !== "function") return;
    console.warn("SupportPilot widget:", context, err);
  }

  function countChars(value) {
    return Array.from(String(value || "")).length;
  }

  function readState() {
    try {
      var raw = localStorage.getItem(storageKey);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      return parsed;
    } catch (err) {
      logWidgetError("read state", err);
      return null;
    }
  }

  var state = readState() || {};
  state.visitorId = String(state.visitorId || "").trim() || createId();
  state.conversationId = String(state.conversationId || "").trim() || null;
  state.externalConversationId =
    String(state.externalConversationId || "").trim() || ("website:" + state.visitorId);
  state.maxMessageChars = Number(state.maxMessageChars) || 300;
  state.messages = Array.isArray(state.messages) ? state.messages.slice(-24) : [];

  function persistState() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
    } catch (err) {
      logWidgetError("persist state", err);
    }
  }

  function pushMessage(role, text) {
    var cleanText = String(text || "").trim();
    if (!cleanText) return;
    state.messages.push({ role: role, text: cleanText });
    state.messages = state.messages.slice(-24);
    persistState();
  }

  function injectStyles() {
    var style = document.createElement("style");
    style.textContent = [
      ".spw-launcher{position:fixed;right:20px;bottom:20px;z-index:2147483646;border:none;border-radius:999px;padding:12px 16px;background:#0f172a;color:#fff;font:600 14px/1.2 Arial,sans-serif;cursor:pointer;box-shadow:0 12px 30px rgba(2,6,23,.25)}",
      ".spw-panel{position:fixed;right:20px;bottom:76px;z-index:2147483646;width:350px;max-width:calc(100vw - 24px);height:500px;max-height:calc(100vh - 96px);display:none;grid-template-rows:auto 1fr auto;border-radius:14px;overflow:hidden;background:#fff;border:1px solid #e2e8f0;box-shadow:0 22px 60px rgba(2,6,23,.24);font-family:Arial,sans-serif;color:#0f172a}",
      ".spw-panel.spw-open{display:grid}",
      ".spw-head{display:flex;align-items:center;justify-content:space-between;padding:12px 14px;background:#0f172a;color:#fff}",
      ".spw-title{font-size:14px;font-weight:700}",
      ".spw-close{border:none;background:transparent;color:#fff;font-size:18px;line-height:1;cursor:pointer}",
      ".spw-messages{padding:12px;overflow:auto;background:linear-gradient(180deg,#f8fafc 0%,#ffffff 70%)}",
      ".spw-row{display:flex;margin:0 0 10px 0}",
      ".spw-row.user{justify-content:flex-end}",
      ".spw-bubble{max-width:82%;padding:9px 11px;border-radius:12px;font-size:13px;line-height:1.4;white-space:pre-wrap;word-break:break-word}",
      ".spw-row.user .spw-bubble{background:#0f172a;color:#fff;border-bottom-right-radius:6px}",
      ".spw-row.assistant .spw-bubble{background:#e2e8f0;color:#0f172a;border-bottom-left-radius:6px}",
      ".spw-row.typing .spw-bubble{display:inline-flex;align-items:center;gap:8px}",
      ".spw-dots{display:inline-flex;align-items:center;gap:4px}",
      ".spw-dot{width:7px;height:7px;border-radius:999px;background:#334155;animation:spwTypingBlink 1.2s infinite ease-in-out}",
      ".spw-dot:nth-child(2){animation-delay:.15s}",
      ".spw-dot:nth-child(3){animation-delay:.3s}",
      ".spw-foot{display:grid;gap:8px;padding:10px;border-top:1px solid #e2e8f0;background:#fff}",
      ".spw-error{display:none;color:#b91c1c;font-size:12px}",
      ".spw-error.spw-visible{display:block}",
      ".spw-inputRow{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:end}",
      ".spw-input{width:100%;min-height:40px;max-height:86px;resize:none;padding:10px 11px;border:1px solid #cbd5e1;border-radius:10px;font:13px/1.35 Arial,sans-serif;color:#0f172a}",
      ".spw-send{height:40px;padding:0 12px;border:none;border-radius:10px;background:#0f172a;color:#fff;font:600 13px/1 Arial,sans-serif;cursor:pointer}",
      ".spw-send:disabled{opacity:.55;cursor:not-allowed}",
      ".spw-count{justify-self:end;font-size:11px;color:#64748b}",
      "@keyframes spwTypingBlink{0%,80%,100%{opacity:.35;transform:translateY(0)}40%{opacity:1;transform:translateY(-2px)}}",
      "@media (max-width: 640px){.spw-launcher{right:12px;bottom:12px}.spw-panel{right:12px;bottom:64px;width:calc(100vw - 24px);height:68vh}}",
    ].join("");
    (document.head || document.documentElement).appendChild(style);
  }

  function createElement(tag, className, text) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  injectStyles();

  var launcher = createElement("button", "spw-launcher", "Chat");
  launcher.type = "button";
  launcher.setAttribute("aria-label", "Open chat");

  var panel = createElement("section", "spw-panel");
  var head = createElement("header", "spw-head");
  var title = createElement("div", "spw-title", "Support");
  var closeBtn = createElement("button", "spw-close", "x");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Close chat");
  head.appendChild(title);
  head.appendChild(closeBtn);

  var messagesEl = createElement("div", "spw-messages");
  var foot = createElement("footer", "spw-foot");
  var errorEl = createElement("div", "spw-error");
  var inputRow = createElement("div", "spw-inputRow");
  var inputEl = createElement("textarea", "spw-input");
  var sendBtn = createElement("button", "spw-send", "Send");
  var countEl = createElement("div", "spw-count");

  inputEl.placeholder = "Type your message...";
  inputEl.rows = 1;
  sendBtn.type = "button";

  inputRow.appendChild(inputEl);
  inputRow.appendChild(sendBtn);
  foot.appendChild(errorEl);
  foot.appendChild(inputRow);
  foot.appendChild(countEl);

  panel.appendChild(head);
  panel.appendChild(messagesEl);
  panel.appendChild(foot);

  var mountRoot = document.body || document.documentElement;
  mountRoot.appendChild(panel);
  mountRoot.appendChild(launcher);

  function setOpen(nextOpen) {
    if (nextOpen) {
      panel.classList.add("spw-open");
      launcher.style.display = "none";
      inputEl.focus();
      return;
    }
    panel.classList.remove("spw-open");
    launcher.style.display = "inline-block";
  }

  function renderCounter() {
    var current = countChars(inputEl.value || "");
    countEl.textContent = current + "/" + state.maxMessageChars;
  }

  function showError(message) {
    var text = String(message || "").trim();
    if (!text) {
      errorEl.textContent = "";
      errorEl.classList.remove("spw-visible");
      return;
    }
    errorEl.textContent = text;
    errorEl.classList.add("spw-visible");
  }

  function appendBubble(role, text, persist) {
    var cleanText = String(text || "").trim();
    if (!cleanText) return;
    var row = createElement("div", "spw-row " + role);
    var bubble = createElement("div", "spw-bubble", cleanText);
    row.appendChild(bubble);
    messagesEl.appendChild(row);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    if (persist !== false) pushMessage(role, cleanText);
  }

  function renderSavedMessages() {
    messagesEl.innerHTML = "";
    if (!state.messages.length) {
      appendBubble(
        "assistant",
        "Hi! How can I help you today?",
        false
      );
      return;
    }
    for (var i = 0; i < state.messages.length; i += 1) {
      var row = state.messages[i];
      var role = row && row.role === "user" ? "user" : "assistant";
      appendBubble(role, row && row.text ? row.text : "", false);
    }
  }

  function setLoading(isLoading) {
    sendBtn.disabled = isLoading;
    inputEl.disabled = isLoading;
  }

  var typingRowEl = null;
  var typingShownAt = 0;
  var typingHideTimer = null;

  function showTypingIndicator() {
    if (typingHideTimer) {
      clearTimeout(typingHideTimer);
      typingHideTimer = null;
    }
    if (typingRowEl) return;
    var row = createElement("div", "spw-row assistant typing");
    var bubble = createElement("div", "spw-bubble");
    bubble.appendChild(document.createTextNode("AI is typing..."));

    var dots = createElement("span", "spw-dots");
    dots.setAttribute("aria-hidden", "true");
    for (var i = 0; i < 3; i += 1) {
      dots.appendChild(createElement("span", "spw-dot"));
    }

    bubble.appendChild(dots);
    row.appendChild(bubble);
    messagesEl.appendChild(row);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    typingRowEl = row;
    typingShownAt = Date.now();
  }

  function hideTypingIndicator(force) {
    if (!typingRowEl) return;
    var elapsed = Date.now() - typingShownAt;
    var minVisibleMs = 650;

    if (!force && elapsed < minVisibleMs) {
      if (typingHideTimer) clearTimeout(typingHideTimer);
      typingHideTimer = setTimeout(function () {
        hideTypingIndicator(true);
      }, minVisibleMs - elapsed);
      return;
    }

    if (typingHideTimer) {
      clearTimeout(typingHideTimer);
      typingHideTimer = null;
    }
    typingRowEl.remove();
    typingRowEl = null;
    typingShownAt = 0;
  }

  async function fetchWidgetConfig() {
    try {
      var resp = await fetch(
        apiBase + "/api/widget/config?clientId=" + encodeURIComponent(clientId)
      );
      if (!resp.ok) return;
      var data = await resp.json();
      var maxChars = Number(data && data.maxMessageChars);
      if (Number.isFinite(maxChars) && maxChars > 0) {
        state.maxMessageChars = maxChars;
        inputEl.maxLength = maxChars;
        persistState();
        renderCounter();
      }
    } catch (err) {
      logWidgetError("fetch widget config", err);
    }
  }

  async function sendMessage() {
    showError("");
    var text = String(inputEl.value || "").trim();
    if (!text) return;
    var charCount = countChars(text);
    if (charCount > state.maxMessageChars) {
      showError("Please shorten your message.");
      return;
    }

    appendBubble("user", text, true);
    inputEl.value = "";
    renderCounter();
    setLoading(true);
    showTypingIndicator();

    try {
      var resp = await fetch(apiBase + "/api/widget/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: clientId,
          text: text,
          conversationId: state.conversationId,
          externalConversationId: state.externalConversationId,
          visitorId: state.visitorId,
        }),
      });

      var payload = null;
      try {
        payload = await resp.json();
      } catch (err) {
        logWidgetError("parse widget response", err);
        payload = null;
      }

      if (!resp.ok) {
        hideTypingIndicator();
        var errMessage = String(
          (payload && payload.error) || "Could not send message. Please try again."
        );
        showError(errMessage);
        return;
      }

      state.conversationId = String(payload && payload.conversationId ? payload.conversationId : state.conversationId || "") || null;
      state.externalConversationId = String(
        (payload && payload.externalConversationId) || state.externalConversationId || ("website:" + state.visitorId)
      );
      state.visitorId = String((payload && payload.visitorId) || state.visitorId || createId());
      var backendMax = Number(payload && payload.maxMessageChars);
      if (Number.isFinite(backendMax) && backendMax > 0) {
        state.maxMessageChars = backendMax;
      }
      persistState();

      var reply = String((payload && payload.reply) || "").trim();
      hideTypingIndicator();
      if (reply) {
        appendBubble("assistant", reply, true);
      }
      renderCounter();
    } catch (err) {
      logWidgetError("send message", err);
      hideTypingIndicator();
      showError("Could not send message. Please try again.");
    } finally {
      hideTypingIndicator(true);
      setLoading(false);
      inputEl.focus();
    }
  }

  launcher.addEventListener("click", function () {
    setOpen(true);
  });
  closeBtn.addEventListener("click", function () {
    setOpen(false);
  });
  sendBtn.addEventListener("click", function () {
    void sendMessage();
  });
  inputEl.addEventListener("keydown", function (event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  });
  inputEl.addEventListener("input", renderCounter);

  renderSavedMessages();
  renderCounter();
  void fetchWidgetConfig();
})();
