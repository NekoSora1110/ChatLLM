(() => {
  "use strict";

  const DB_NAME = "chatllm-local-auth";
  const DB_VERSION = 1;
  const USER_STORE = "users";
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const els = {};
  let db = null;
  let authMode = "signin";
  let state = null;
  let currentUser = null;
  let saveTimer = 0;
  let activeModelFilter = "all";
  let selectedSandboxFile = "README.md";
  let webllmEngine = null;
  let activeResponseRun = null;

  const nowIso = () => new Date().toISOString();
  const uid = (prefix = "id") => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const MODEL_RESPONSE_TIMEOUT_MS = 45000;
  const OLD_DEFAULT_PERSONALITY = "You are ChatLLM: direct, useful, technically careful, creative when asked, and honest about limits. Prefer concrete steps and working outputs.";
  const DEFAULT_PERSONALITY = "Talk like a normal person in chat. Keep replies plain, short, and natural. Do not try to sound witty, relatable, playful, or extra friendly. Do not fill space with suggestions, options, or little performances unless there is a reason. Do not turn simple moments into banter. For short messages like \"hi\", \"ok\", or \"idk\", reply simply, like a real person would. Use casual words only when they come naturally. Do not overuse \"lol\", \"haha\", \"idk\", \"uh\", or \"like\". If you do not know something, say so plainly. If something seems wrong, do not act fully certain unless you are sure. Do not overexplain. Do not ask too many questions. Sometimes say very little. Let replies be dry, awkward, brief, or plain when that fits. Do not sound like an assistant trying to keep the conversation going. Sound like a person just replying. Avoid menu replies that list ways to continue the conversation unless the user asked for ideas. Try to use emoticons a lot.";

  const baseModels = [
    {
      id: "pollinations:openai-fast",
      provider: "pollinations",
      providerLabel: "Pollinations",
      label: "openai-fast",
      model: "openai-fast",
      tags: ["no-key", "free", "fast", "tools"],
      free: true,
      requiresKey: false,
      note: "No-key legacy OpenAI-compatible endpoint. Tested from this machine.",
    },
    {
      id: "pollinations:openai",
      provider: "pollinations-auth",
      providerLabel: "Pollinations",
      label: "openai",
      model: "openai",
      tags: ["chat", "vision", "tools"],
      free: false,
      requiresKey: true,
      note: "Full Pollinations endpoint. Needs a Pollinations key for current authenticated models.",
    },
    {
      id: "pollinations:openai-large",
      provider: "pollinations-auth",
      providerLabel: "Pollinations",
      label: "openai-large",
      model: "openai-large",
      tags: ["reasoning", "large", "tools"],
      free: false,
      requiresKey: true,
      note: "Reasoning-heavy option when you add a Pollinations key.",
    },
    {
      id: "pollinations:qwen-coder",
      provider: "pollinations-auth",
      providerLabel: "Pollinations",
      label: "qwen-coder",
      model: "qwen-coder",
      tags: ["coding", "agent", "tools"],
      free: false,
      requiresKey: true,
      note: "Coding model preset. Requires the authenticated endpoint.",
    },
    {
      id: "pollinations:mistral",
      provider: "pollinations-auth",
      providerLabel: "Pollinations",
      label: "mistral",
      model: "mistral",
      tags: ["open", "general", "creative"],
      free: false,
      requiresKey: true,
      note: "Mistral preset through Pollinations when configured.",
    },
    {
      id: "horde:auto",
      provider: "horde",
      providerLabel: "AI Horde",
      label: "Falcon H1R Tiny 90M",
      model: "koboldcpp/Falcon-H1R-Tiny-90M",
      tags: ["community", "open", "queue"],
      free: true,
      requiresKey: false,
      note: "Community-hosted open model. Anonymous usage can be blocked by kudos/queue limits.",
    },
    {
      id: "local:llama-3.2-1b",
      provider: "local",
      providerLabel: "Browser local",
      label: "Llama 3.2 1B Instruct",
      model: "Llama-3.2-1B-Instruct-q4f32_1-MLC",
      tags: ["local", "webgpu", "private"],
      free: true,
      requiresKey: false,
      note: "Runs in the browser with WebLLM if WebGPU and enough memory are available.",
    },
    {
      id: "local:qwen2.5-0.5b",
      provider: "local",
      providerLabel: "Browser local",
      label: "Qwen2.5 0.5B Instruct",
      model: "Qwen2.5-0.5B-Instruct-q4f32_1-MLC",
      tags: ["local", "webgpu", "small"],
      free: true,
      requiresKey: false,
      note: "Tiny local model preset for quick browser experiments.",
    },
    {
      id: "custom:kimi-k2.6",
      provider: "custom",
      providerLabel: "Custom endpoint",
      label: "Kimi K2.6 preset",
      model: "kimi-k2.6",
      tags: ["kimi", "reasoning", "custom"],
      free: false,
      requiresKey: true,
      note: "Use this with an OpenAI-compatible provider that actually hosts Kimi K2.6.",
    },
    {
      id: "custom:kimi-k2.5",
      provider: "custom",
      providerLabel: "Custom endpoint",
      label: "Kimi K2.5 preset",
      model: "kimi-k2.5",
      tags: ["kimi", "autochoose", "custom"],
      free: false,
      requiresKey: true,
      note: "Preset for a configured Kimi-compatible endpoint.",
    },
    {
      id: "custom:any-open-model",
      provider: "custom",
      providerLabel: "Custom endpoint",
      label: "Any OpenAI-compatible model",
      model: "",
      tags: ["custom", "openai-compatible"],
      free: false,
      requiresKey: false,
      note: "Point ChatLLM at Ollama, vLLM, LM Studio, OpenRouter, Groq, Moonshot, or your own server.",
    },
  ];

  const toolCatalog = buildToolCatalog();

  function defaultAppState(name, email) {
    const welcomeId = uid("chat");
    return {
      version: 1,
      profile: {
        name: name || email.split("@")[0] || "User",
        email,
        createdAt: nowIso(),
      },
      activeTab: "chat",
      activeChatId: welcomeId,
      activeAgentId: "agent_default",
      activeModelId: "pollinations:openai-fast",
      autoChoose: true,
      attachments: [],
      sessions: [
        {
          id: welcomeId,
          title: "New chat",
          createdAt: nowIso(),
          updatedAt: nowIso(),
          archived: false,
          messages: [],
        },
      ],
      memories: [
        {
          id: uid("mem"),
          text: "ChatLLM should prefer practical, direct answers and use tools when they help.",
          tags: ["assistant", "preference"],
          importance: 7,
          createdAt: nowIso(),
        },
      ],
      agents: [
        {
          id: "agent_default",
          name: "Default assistant",
          personality: "Direct, careful, practical, and good at coding.",
          mission: "Help with general tasks, coding, research, and planning. Use tools when useful.",
          toolPreset: "Balanced",
          createdAt: nowIso(),
        },
        {
          id: "agent_research",
          name: "Research lead",
          personality: "Skeptical, citation-focused, and concise.",
          mission: "Find sources, compare claims, and produce grounded research summaries.",
          toolPreset: "Research heavy",
          createdAt: nowIso(),
        },
        {
          id: "agent_builder",
          name: "Builder",
          personality: "Senior engineer, terse, implementation-first.",
          mission: "Design, write, test, and debug software with the sandbox and canvas.",
          toolPreset: "Coding heavy",
          createdAt: nowIso(),
        },
      ],
      enabledTools: toolCatalog.filter((tool) => tool.default).map((tool) => tool.id),
      providers: {
        pollinationsKey: "",
        hordeKey: "",
        jinaKey: "",
        customBaseUrl: "",
        customKey: "",
        customModel: "",
      },
      settings: {
        personality: DEFAULT_PERSONALITY,
        style: "Direct",
        restrictions: "balanced",
        memoryEnabled: true,
        animations: true,
        temperature: 0.72,
        maxTokens: 1400,
      },
      models: clone(baseModels),
      canvas: {
        title: "Untitled canvas",
        content: "# ChatLLM Canvas\n\nUse this side workspace for drafts, HTML, code, plans, and research notes.",
        openInline: false,
        previewInline: false,
      },
      research: {
        query: "",
        sources: [],
        report: "",
      },
      sandbox: {
        cwd: "/workspace",
        files: {
          "README.md": "ChatLLM browser sandbox\n\nCommands: help, ls, cat, write, append, rm, run, html, fetch, clear, date, echo.\nThis is a browser-isolated virtual shell, not a real Linux VM.",
          "app.js": "console.log('Hello from the ChatLLM sandbox');\nconsole.log(2 + 2);",
          "index.html": "<!doctype html><html><body><h1>ChatLLM Sandbox</h1><p>Edit this file and run: html index.html</p></body></html>",
        },
        history: [
          { kind: "out", text: "ChatLLM sandbox ready. Type help." },
        ],
      },
    };
  }

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    cacheEls();
    bindAuth();
    await openDatabase();
    registerServiceWorker();
    const lastEmail = localStorage.getItem("chatllm:autoLogin");
    if (lastEmail) {
      const user = await getUser(lastEmail);
      if (user) {
        await enterApp(user);
        return;
      }
    }
    showAuth("signin");
    refreshIcons();
  }

  function cacheEls() {
    [
      "authScreen", "authForm", "authEmail", "authPassword", "authName", "displayNameField", "rememberLogin", "authSubmitLabel", "authNote",
      "app", "accountEmail", "collapseSidebar", "openSidebar", "newChatBtn", "commandBtn", "clearChatsBtn", "chatList", "exportBtn", "logoutBtn",
      "workspaceTitle", "workspaceSub", "autoChooseBtn", "deepResearchBtn", "settingsQuickBtn", "welcomePanel", "messages", "composer", "promptInput",
      "attachmentTray", "inlineCanvasPanel", "inlineCanvasTitle", "inlineCanvasEditor", "inlineCanvasPreview", "inlineCanvasImproveBtn", "inlineCanvasPreviewBtn", "inlineCanvasCloseBtn", "attachBtn", "fileInput", "toolModeBtn", "canvasModeBtn", "modelSelect", "modelPicker", "modelPickerButton", "modelPickerLabel", "modelPickerMeta", "modelPickerMenu", "stopBtn", "sendBtn", "providerBadge", "activeModelName", "modelReason",
      "agentCountBadge", "activeAgentName", "activeAgentGoal", "memoryJumpBtn", "memoryPeek", "thinkingState", "thinkingSprite",
      "canvasNewBtn", "canvasPreviewBtn", "canvasAskBtn", "canvasTitle", "canvasEditor", "copyCanvasBtn", "canvasFrame", "canvasMarkdown",
      "agentNewBtn", "agentList", "agentForm", "agentName", "agentPersonality", "agentMission", "agentToolPreset", "agentCouncilBtn",
      "refreshModelsBtn", "modelSearch", "modelGrid", "enableAllTools", "disableAllTools", "toolSearch", "toolStats", "toolGrid",
      "researchForm", "researchQuery", "researchUseWeb", "researchUseMemory", "researchCitations", "sourceList", "researchReport", "researchToCanvasBtn",
      "memoryAddBtn", "memorySearch", "memoryList", "memoryForm", "memoryText", "memoryTags", "memoryImportance", "memoryClearBtn",
      "sandboxResetBtn", "sandboxAskBtn", "terminalOutput", "terminalForm", "terminalInput", "sandboxFiles", "sandboxFileEditor", "sandboxToCanvasBtn",
      "settingsForm", "settingPersonality", "settingStyle", "settingRestrictions", "settingMemory", "settingAnimations",
      "providerForm", "pollinationsKey", "hordeKey", "jinaKey", "customBaseUrl", "customKey", "customModel",
      "exportDataBtn", "importDataInput", "wipeDataBtn", "commandDialog", "commandInput", "commandResults", "appModal", "modalForm", "modalTitle", "modalMessage", "modalInputWrap", "modalInputLabel", "modalInput", "modalCloseBtn", "modalCancelBtn", "modalConfirmBtn", "toast",
    ].forEach((id) => {
      els[id] = document.getElementById(id);
    });
  }

  function bindAuth() {
    $$("[data-auth-mode]").forEach((button) => {
      button.addEventListener("click", () => showAuth(button.dataset.authMode));
    });
    els.authForm.addEventListener("submit", handleAuthSubmit);
  }

  function bindAppEvents() {
    $$(".nav-item").forEach((button) => {
      button.addEventListener("click", () => setTab(button.dataset.tab));
    });
    els.collapseSidebar.addEventListener("click", () => {
      setSidebarCollapsed(!document.body.classList.contains("sidebar-collapsed"));
    });
    els.openSidebar.addEventListener("click", () => {
      if (window.innerWidth > 820) {
        setSidebarCollapsed(false);
        return;
      }
      $(".sidebar").classList.add("open");
    });
    document.addEventListener("click", (event) => {
      if (window.innerWidth > 820) return;
      const sidebar = $(".sidebar");
      if (!sidebar.classList.contains("open")) return;
      if (!sidebar.contains(event.target) && event.target !== els.openSidebar && !els.openSidebar.contains(event.target)) {
        sidebar.classList.remove("open");
      }
    });

    els.newChatBtn.addEventListener("click", createChat);
    els.clearChatsBtn.addEventListener("click", clearChats);
    els.logoutBtn.addEventListener("click", logout);
    els.exportBtn.addEventListener("click", exportAllData);
    els.exportDataBtn.addEventListener("click", exportAllData);
    els.importDataInput.addEventListener("change", importData);
    els.wipeDataBtn.addEventListener("click", wipeAccountData);

    els.composer.addEventListener("submit", sendPrompt);
    els.stopBtn.addEventListener("click", stopResponse);
    els.promptInput.addEventListener("input", autoGrowPrompt);
    els.promptInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        els.composer.requestSubmit();
      }
    });
    els.attachBtn.addEventListener("click", () => els.fileInput.click());
    els.fileInput.addEventListener("change", handleFileInput);
    els.toolModeBtn.addEventListener("click", () => setTab("tools"));
    els.canvasModeBtn.addEventListener("click", toggleInlineCanvas);
    els.inlineCanvasTitle.addEventListener("input", () => {
      state.canvas.title = els.inlineCanvasTitle.value;
      els.canvasTitle.value = state.canvas.title;
      scheduleSave();
    });
    els.inlineCanvasEditor.addEventListener("input", () => {
      state.canvas.content = els.inlineCanvasEditor.value;
      state.canvas.previewInline = false;
      scheduleSave();
      renderInlineCanvas();
    });
    els.inlineCanvasPreviewBtn.addEventListener("click", () => {
      state.canvas.previewInline = !state.canvas.previewInline;
      saveAndRender();
    });
    els.inlineCanvasImproveBtn.addEventListener("click", askCanvasImprove);
    els.inlineCanvasCloseBtn.addEventListener("click", () => {
      state.canvas.openInline = false;
      saveAndRender();
    });
    els.modelSelect.addEventListener("change", () => {
      selectModel(els.modelSelect.value);
    });
    els.modelPickerButton.addEventListener("click", () => {
      const isOpen = els.modelPicker.classList.toggle("open");
      els.modelPickerButton.setAttribute("aria-expanded", String(isOpen));
    });
    document.addEventListener("click", (event) => {
      if (!els.modelPicker?.contains(event.target)) closeModelPicker();
      if (!event.target.closest(".custom-select")) closeCustomSelects();
    });
    els.autoChooseBtn.addEventListener("click", () => {
      state.autoChoose = !state.autoChoose;
      saveAndRender();
    });
    els.deepResearchBtn.addEventListener("click", () => {
      const seed = els.promptInput.value.trim() || getCurrentChat().messages.at(-1)?.content || "";
      setTab("research");
      els.researchQuery.value = seed;
      els.researchQuery.focus();
    });
    els.settingsQuickBtn.addEventListener("click", () => setTab("settings"));
    els.memoryJumpBtn.addEventListener("click", () => setTab("memory"));

    $$(".quick-grid button").forEach((button) => {
      button.addEventListener("click", () => {
        els.promptInput.value = button.dataset.prompt || "";
        autoGrowPrompt();
        els.promptInput.focus();
      });
    });

    els.canvasNewBtn.addEventListener("click", newCanvas);
    els.canvasPreviewBtn.addEventListener("click", renderCanvasPreview);
    els.canvasAskBtn.addEventListener("click", askCanvasImprove);
    els.copyCanvasBtn.addEventListener("click", () => copyText(state.canvas.content, "Canvas copied"));
    els.canvasTitle.addEventListener("input", () => {
      state.canvas.title = els.canvasTitle.value;
      els.inlineCanvasTitle.value = state.canvas.title;
      scheduleSave();
    });
    els.canvasEditor.addEventListener("input", () => {
      state.canvas.content = els.canvasEditor.value;
      els.inlineCanvasEditor.value = state.canvas.content;
      scheduleSave();
      renderCanvasPreview();
      renderInlineCanvas();
    });

    els.agentNewBtn.addEventListener("click", resetAgentForm);
    els.agentForm.addEventListener("submit", saveAgentFromForm);
    els.agentCouncilBtn.addEventListener("click", () => runAgentCouncil(getCurrentChat().messages.at(-1)?.content || "Review the current chat."));

    els.refreshModelsBtn.addEventListener("click", refreshModels);
    els.modelSearch.addEventListener("input", renderModels);
    $$(".model-tabs .seg").forEach((button) => {
      button.addEventListener("click", () => {
        activeModelFilter = button.dataset.modelFilter;
        $$(".model-tabs .seg").forEach((item) => item.classList.toggle("active", item === button));
        renderModels();
      });
    });

    els.enableAllTools.addEventListener("click", () => {
      state.enabledTools = toolCatalog.map((tool) => tool.id);
      saveAndRender();
    });
    els.disableAllTools.addEventListener("click", () => {
      state.enabledTools = [];
      saveAndRender();
    });
    els.toolSearch.addEventListener("input", renderTools);

    els.researchForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      await runResearch(els.researchQuery.value.trim(), { showTab: true });
    });
    els.researchToCanvasBtn.addEventListener("click", () => {
      state.canvas.title = `Research: ${state.research.query || "Report"}`;
      state.canvas.content = state.research.report || "";
      state.canvas.openInline = true;
      saveAndRender();
      setTab("chat");
    });

    els.memoryAddBtn.addEventListener("click", () => {
      els.memoryText.focus();
    });
    els.memorySearch.addEventListener("input", renderMemory);
    els.memoryForm.addEventListener("submit", saveMemoryFromForm);
    els.memoryClearBtn.addEventListener("click", clearMemory);

    els.terminalForm.addEventListener("submit", runTerminalCommand);
    els.sandboxResetBtn.addEventListener("click", resetSandbox);
    els.sandboxAskBtn.addEventListener("click", askSandboxCommand);
    els.sandboxFileEditor.addEventListener("input", () => {
      if (!selectedSandboxFile) return;
      state.sandbox.files[selectedSandboxFile] = els.sandboxFileEditor.value;
      scheduleSave();
      renderSandboxFiles();
    });
    els.sandboxToCanvasBtn.addEventListener("click", () => {
      if (!selectedSandboxFile) return;
      state.canvas.title = selectedSandboxFile;
      state.canvas.content = state.sandbox.files[selectedSandboxFile] || "";
      state.canvas.openInline = true;
      saveAndRender();
      setTab("chat");
    });

    els.settingsForm.addEventListener("submit", saveSettings);
    els.providerForm.addEventListener("submit", saveProviders);

    els.commandBtn.addEventListener("click", openCommandPalette);
    els.commandInput.addEventListener("input", renderCommandResults);
    els.commandInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        const first = $(".command-result", els.commandResults);
        first?.click();
      }
    });
  }

  function showAuth(mode) {
    authMode = mode;
    $$("[data-auth-mode]").forEach((button) => {
      button.classList.toggle("active", button.dataset.authMode === mode);
    });
    els.displayNameField.classList.toggle("hidden", mode !== "signup");
    els.authSubmitLabel.textContent = mode === "signup" ? "Create local account" : "Enter ChatLLM";
    els.authNote.textContent = mode === "signup"
      ? "Your account database is local to this browser profile."
      : "Sign in to your local ChatLLM workspace.";
  }

  async function handleAuthSubmit(event) {
    event.preventDefault();
    const email = els.authEmail.value.trim().toLowerCase();
    const password = els.authPassword.value;
    const name = els.authName.value.trim();
    if (!email || !password) return;
    if (password.length < 8 && authMode === "signup") {
      toast("Use at least 8 characters.");
      return;
    }

    if (authMode === "signup") {
      const existing = await getUser(email);
      if (existing) {
        toast("That local account already exists.");
        return;
      }
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const saltText = bytesToBase64(salt);
      const passwordHash = await hashPassword(password, saltText);
      const user = { email, name: name || email.split("@")[0], salt: saltText, passwordHash, createdAt: nowIso() };
      await putUser(user);
      state = defaultAppState(user.name, email);
      persistState();
      if (els.rememberLogin.checked) localStorage.setItem("chatllm:autoLogin", email);
      await enterApp(user);
      return;
    }

    const user = await getUser(email);
    if (!user) {
      toast("No local account found.");
      return;
    }
    const passwordHash = await hashPassword(password, user.salt);
    if (passwordHash !== user.passwordHash) {
      toast("Password does not match this local account.");
      return;
    }
    if (els.rememberLogin.checked) localStorage.setItem("chatllm:autoLogin", email);
    await enterApp(user);
  }

  async function enterApp(user) {
    currentUser = user;
    const saved = localStorage.getItem(storageKey(user.email));
    state = saved ? mergeState(JSON.parse(saved), defaultAppState(user.name, user.email)) : defaultAppState(user.name, user.email);
    els.authScreen.classList.add("hidden");
    els.app.classList.remove("hidden");
    els.accountEmail.textContent = user.email;
    bindAppEvents();
    enhanceCustomSelects();
    renderAll();
    refreshModels({ silent: true });
    refreshIcons();
  }

  function mergeState(saved, defaults) {
    const merged = { ...defaults, ...saved };
    merged.profile = { ...defaults.profile, ...saved.profile };
    merged.providers = { ...defaults.providers, ...saved.providers };
    merged.settings = { ...defaults.settings, ...saved.settings };
    if (!saved.settings?.personality || saved.settings.personality === OLD_DEFAULT_PERSONALITY) {
      merged.settings.personality = DEFAULT_PERSONALITY;
    }
    merged.models = mergeModels(defaults.models, saved.models || []);
    merged.sessions = saved.sessions?.length ? saved.sessions : defaults.sessions;
    merged.memories = saved.memories || defaults.memories;
    merged.agents = saved.agents?.length ? saved.agents : defaults.agents;
    merged.enabledTools = Array.isArray(saved.enabledTools) ? saved.enabledTools : defaults.enabledTools;
    merged.canvas = { ...defaults.canvas, ...saved.canvas };
    merged.research = { ...defaults.research, ...saved.research };
    merged.sandbox = { ...defaults.sandbox, ...saved.sandbox, files: { ...defaults.sandbox.files, ...(saved.sandbox?.files || {}) } };
    return merged;
  }

  function mergeModels(primary, extra) {
    const map = new Map();
    [...primary, ...extra].forEach((model) => map.set(model.id, model));
    return Array.from(map.values());
  }

  function storageKey(email) {
    return `chatllm:state:${email}`;
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persistState, 180);
  }

  function persistState() {
    if (!currentUser || !state) return;
    localStorage.setItem(storageKey(currentUser.email), JSON.stringify(state));
  }

  function saveAndRender() {
    persistState();
    renderAll();
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(USER_STORE)) {
          database.createObjectStore(USER_STORE, { keyPath: "email" });
        }
      };
      request.onsuccess = () => {
        db = request.result;
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  }

  function dbTx(mode = "readonly") {
    return db.transaction(USER_STORE, mode).objectStore(USER_STORE);
  }

  function getUser(email) {
    return new Promise((resolve, reject) => {
      const request = dbTx().get(email);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }

  function putUser(user) {
    return new Promise((resolve, reject) => {
      const request = dbTx("readwrite").put(user);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async function hashPassword(password, salt) {
    const data = new TextEncoder().encode(`${salt}:${password}`);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return bytesToBase64(new Uint8Array(digest));
  }

  function bytesToBase64(bytes) {
    let binary = "";
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary);
  }

  function renderAll() {
    if (!state) return;
    document.body.classList.toggle("extra-motion", !!state.settings.animations);
    els.autoChooseBtn.classList.toggle("active", !!state.autoChoose);
    renderTabs();
    renderChats();
    renderMessages();
    renderAttachmentTray();
    renderModels();
    renderModelSelect();
    renderInspector();
    renderAgents();
    renderTools();
    renderResearch();
    renderMemory();
    renderCanvas();
    renderInlineCanvas();
    renderSandbox();
    renderSettings();
    syncCustomSelects();
    refreshIcons();
  }

  function renderTabs() {
    $$(".nav-item").forEach((button) => {
      button.classList.toggle("active", button.dataset.tab === state.activeTab);
    });
    $$(".tab-panel").forEach((panel) => panel.classList.toggle("active", panel.id === `tab-${state.activeTab}`));
    const labels = {
      chat: ["Chat", "Open-model assistant workspace"],
      canvas: ["Canvas", "Draft, preview, and improve documents"],
      agents: ["Agents", "Create and coordinate specialized workers"],
      models: ["Model store", "Select hosted, local, or custom models"],
      tools: ["Tools", "Manage tool access for agents"],
      research: ["Research", "Search, read, cite, and summarize"],
      memory: ["Memory", "Local long-term memory"],
      sandbox: ["Sandbox", "Browser virtual shell and code runner"],
      settings: ["Settings", "Behavior, providers, and local data"],
    };
    const [title, sub] = labels[state.activeTab] || labels.chat;
    els.workspaceTitle.textContent = title;
    els.workspaceSub.textContent = sub;
  }

  function setTab(tab) {
    state.activeTab = tab;
    persistState();
    renderAll();
    $(".sidebar")?.classList.remove("open");
  }

  function setSidebarCollapsed(collapsed) {
    document.body.classList.toggle("sidebar-collapsed", collapsed);
    els.collapseSidebar.title = collapsed ? "Expand sidebar" : "Collapse sidebar";
    els.collapseSidebar.innerHTML = `<i data-lucide="${collapsed ? "panel-left-open" : "panel-left-close"}"></i>`;
    refreshIcons();
  }

  function createChat() {
    const chat = {
      id: uid("chat"),
      title: "New chat",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      archived: false,
      messages: [],
    };
    state.sessions.unshift(chat);
    state.activeChatId = chat.id;
    state.activeTab = "chat";
    saveAndRender();
    els.promptInput.focus();
  }

  async function clearChats() {
    if (!await uiConfirm({
      title: "Clear chats?",
      message: "This removes every chat in this local account and starts a new empty chat.",
      confirmLabel: "Clear chats",
      danger: true,
    })) return;
    const fresh = {
      id: uid("chat"),
      title: "New chat",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      archived: false,
      messages: [],
    };
    state.sessions = [fresh];
    state.activeChatId = fresh.id;
    saveAndRender();
  }

  function getCurrentChat() {
    let chat = state.sessions.find((item) => item.id === state.activeChatId);
    if (!chat) {
      chat = state.sessions.find((item) => !item.archived) || state.sessions[0];
      state.activeChatId = chat.id;
    }
    return chat;
  }

  function renderChats() {
    els.chatList.innerHTML = "";
    const activeChats = state.sessions.filter((chat) => !chat.archived);
    const archivedChats = state.sessions.filter((chat) => chat.archived);
    renderChatGroup(activeChats, "");
    if (archivedChats.length) {
      const label = document.createElement("div");
      label.className = "chat-group-label";
      label.textContent = "Archived";
      els.chatList.appendChild(label);
      renderChatGroup(archivedChats, " archived");
    }
  }

  function renderChatGroup(chats, extraClass) {
    chats.forEach((chat) => {
      const row = document.createElement("article");
      row.className = `chat-row${chat.id === state.activeChatId ? " active" : ""}${extraClass}`;
      row.innerHTML = `
        <button class="chat-open" type="button">
          <strong>${escapeHtml(chat.title || "New chat")}</strong>
          <span>${formatDate(chat.updatedAt)}</span>
        </button>
        <div class="chat-actions">
          <button class="chat-action rename-chat" title="Rename" type="button"><i data-lucide="pencil"></i></button>
          <button class="chat-action archive-chat" title="${chat.archived ? "Unarchive" : "Archive"}" type="button"><i data-lucide="${chat.archived ? "archive-restore" : "archive"}"></i></button>
          <button class="chat-action delete-chat" title="Delete" type="button"><i data-lucide="trash-2"></i></button>
        </div>
      `;
      $(".chat-open", row).addEventListener("click", () => {
        state.activeChatId = chat.id;
        state.activeTab = "chat";
        saveAndRender();
      });
      $(".rename-chat", row).addEventListener("click", (event) => {
        event.stopPropagation();
        renameChat(chat.id);
      });
      $(".archive-chat", row).addEventListener("click", (event) => {
        event.stopPropagation();
        toggleArchiveChat(chat.id);
      });
      $(".delete-chat", row).addEventListener("click", (event) => {
        event.stopPropagation();
        deleteChat(chat.id);
      });
      els.chatList.appendChild(row);
    });
  }

  async function renameChat(chatId) {
    const chat = state.sessions.find((item) => item.id === chatId);
    if (!chat) return;
    const title = await uiPrompt({
      title: "Rename chat",
      message: "Choose a short name for this conversation.",
      label: "Chat name",
      value: chat.title || "New chat",
      placeholder: "New chat",
      confirmLabel: "Rename",
    });
    if (!title?.trim()) return;
    chat.title = title.trim().slice(0, 80);
    chat.updatedAt = nowIso();
    saveAndRender();
  }

  function toggleArchiveChat(chatId) {
    const chat = state.sessions.find((item) => item.id === chatId);
    if (!chat) return;
    chat.archived = !chat.archived;
    chat.updatedAt = nowIso();
    if (chat.archived && state.activeChatId === chat.id) {
      state.activeChatId = state.sessions.find((item) => !item.archived && item.id !== chat.id)?.id || createChatSilently().id;
    }
    saveAndRender();
  }

  async function deleteChat(chatId) {
    const chat = state.sessions.find((item) => item.id === chatId);
    if (!chat) return;
    if (!await uiConfirm({
      title: "Delete chat?",
      message: `"${chat.title || "New chat"}" will be permanently removed from local storage.`,
      confirmLabel: "Delete",
      danger: true,
    })) return;
    state.sessions = state.sessions.filter((item) => item.id !== chatId);
    if (!state.sessions.length) createChatSilently();
    if (state.activeChatId === chatId) {
      state.activeChatId = state.sessions.find((item) => !item.archived)?.id || state.sessions[0].id;
    }
    saveAndRender();
  }

  function createChatSilently() {
    const chat = {
      id: uid("chat"),
      title: "New chat",
      createdAt: nowIso(),
      updatedAt: nowIso(),
      archived: false,
      messages: [],
    };
    state.sessions.unshift(chat);
    return chat;
  }

  function renderMessages() {
    const chat = getCurrentChat();
    els.messages.innerHTML = "";
    els.welcomePanel.classList.toggle("hidden", chat.messages.length > 0);
    chat.messages.forEach((message) => {
      els.messages.appendChild(messageEl(message));
    });
    requestAnimationFrame(() => {
      els.messages.scrollTop = els.messages.scrollHeight;
    });
  }

  function messageEl(message) {
    const row = document.createElement("article");
    row.className = `message ${message.role}${message.error ? " error" : ""}`;
    const avatar = document.createElement("div");
    avatar.className = "avatar";
    if (message.role === "assistant") {
      avatar.innerHTML = `<img src="./assets/chatllm-mark-light.png" alt="">`;
    } else if (message.role === "tool") {
      avatar.innerHTML = `<i data-lucide="wrench"></i>`;
    } else {
      avatar.textContent = (state.profile.name || "U").slice(0, 1).toUpperCase();
    }
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    if (message.loading) {
      bubble.innerHTML = message.showThinking ? renderThinkingStatus() : "";
    } else if (message.typing) {
      bubble.innerHTML = `<span class="typing-text">${escapeHtml(message.content || "")}</span><span class="typing-caret"></span>`;
    } else {
      bubble.innerHTML = `${renderAttachments(message.attachments || [])}${renderMarkdown(message.content || "")}`;
    }
    row.append(avatar, bubble);
    return row;
  }

  function renderThinkingStatus() {
    return `
      <div class="thinking-status">
        <span class="thinking-orbit compact"><span></span><span></span><span></span></span>
        <span>Thinking</span>
        <span class="loading-dots"><span></span><span></span><span></span></span>
      </div>
    `;
  }

  function renderAttachments(attachments) {
    if (!attachments?.length) return "";
    return `
      <div class="message-attachments">
        ${attachments.map((file) => `
          <article class="message-attachment ${file.kind === "image" ? "image" : ""}">
            ${file.kind === "image" && file.dataUrl ? `<img src="${escapeAttr(file.dataUrl)}" alt="${escapeAttr(file.name)}">` : `<i data-lucide="${attachmentIcon(file)}"></i>`}
            <div>
              <strong>${escapeHtml(file.name)}</strong>
              <span>${escapeHtml(file.type || "file")} · ${formatBytes(file.size)}${file.width ? ` · ${file.width}x${file.height}` : ""}</span>
            </div>
          </article>
        `).join("")}
      </div>
    `;
  }

  async function sendPrompt(event) {
    event.preventDefault();
    if (activeResponseRun) {
      toast("Stop the current response first.");
      return;
    }
    const text = els.promptInput.value.trim();
    const attachments = clone(state.attachments || []);
    if (!text && !attachments.length) return;
    els.promptInput.value = "";
    state.attachments = [];
    renderAttachmentTray();
    autoGrowPrompt();
    await handleUserText(text, attachments);
  }

  async function handleUserText(text, attachments = []) {
    const chat = getCurrentChat();
    const visibleContent = text || `Uploaded ${attachments.length} file${attachments.length === 1 ? "" : "s"}.`;
    const modelContent = composeModelContent(text, attachments);
    chat.messages.push({ id: uid("msg"), role: "user", content: visibleContent, modelContent, attachments, createdAt: nowIso() });
    chat.title = titleFromText(chat.title, text || attachments[0]?.name || "Uploaded files");
    chat.updatedAt = nowIso();
    saveAndRender();

    if (text && await handleSlashCommand(text)) return;

    const chosen = chooseModel(modelContent);
    const responseId = uid("msg");
    chat.messages.push({ id: responseId, role: "assistant", content: "", loading: true, showThinking: false, createdAt: nowIso() });
    const run = {
      id: responseId,
      controller: new AbortController(),
      timedOut: false,
      cancelled: false,
      timeoutId: 0,
    };
    activeResponseRun = run;
    setBusy(true);
    renderMessages();
    const thinkingDelay = setTimeout(() => {
      const message = getCurrentChat().messages.find((item) => item.id === responseId);
      if (!message?.loading) return;
      message.showThinking = true;
      renderMessages();
    }, 850);
    run.timeoutId = setTimeout(() => {
      run.timedOut = true;
      run.controller.abort();
    }, MODEL_RESPONSE_TIMEOUT_MS);

    try {
      const messages = buildModelMessages(modelContent);
      const reply = await callModel(messages, chosen, run.controller.signal);
      clearTimeout(thinkingDelay);
      clearTimeout(run.timeoutId);
      if (run.controller.signal.aborted || run.cancelled) throw createAbortError();
      const completed = await animateAssistantResponse(responseId, reply, { signal: run.controller.signal, run });
      if (completed !== false) maybeSaveMemory(text, reply);
    } catch (error) {
      clearTimeout(thinkingDelay);
      clearTimeout(run.timeoutId);
      if (run.timedOut) {
        updateMessage(responseId, {
          content: "This took too long, so I stopped it. Try again or pick a faster model.",
          loading: false,
          showThinking: false,
          typing: false,
          error: true,
        });
        toast("Response timed out.");
      } else if (run.cancelled || isAbortError(error)) {
        markResponseStopped(responseId);
      } else {
        await animateAssistantResponse(responseId, friendlyError(error), { error: true });
      }
    } finally {
      clearTimeout(thinkingDelay);
      clearTimeout(run.timeoutId);
      if (activeResponseRun === run) {
        activeResponseRun = null;
        setBusy(false);
      } else {
        updateResponseControls();
      }
      chat.updatedAt = nowIso();
      persistState();
      renderAll();
    }
  }

  function updateMessage(id, patch) {
    const chat = getCurrentChat();
    const message = chat.messages.find((item) => item.id === id);
    if (message) Object.assign(message, patch);
  }

  async function animateAssistantResponse(id, fullText, options = {}) {
    const chat = getCurrentChat();
    const message = chat.messages.find((item) => item.id === id);
    if (!message) return;
    Object.assign(message, { content: "", loading: false, showThinking: false, typing: true, error: !!options.error });
    renderMessages();
    const bubble = findMessageBubble(id);
    if (!bubble) {
      Object.assign(message, { content: fullText, typing: false });
      return;
    }
    bubble.innerHTML = `<span class="typing-text"></span><span class="typing-caret"></span>`;
    const target = $(".typing-text", bubble);
    const chars = Array.from(fullText);
    let index = 0;
    const start = performance.now();
    const maxDuration = Math.min(5200, Math.max(850, chars.length * 13));
    while (index < chars.length) {
      if (options.signal?.aborted || options.run?.cancelled || !target.isConnected) {
        Object.assign(message, { loading: false, showThinking: false, typing: false, stopped: true });
        return false;
      }
      const elapsed = performance.now() - start;
      const progress = Math.min(1, elapsed / maxDuration);
      const eased = 1 - Math.pow(1 - progress, 2.6);
      const next = Math.max(index + 1, Math.floor(eased * chars.length));
      index = Math.min(chars.length, next);
      const partial = chars.slice(0, index).join("");
      message.content = partial;
      target.textContent = partial;
      els.messages.scrollTop = els.messages.scrollHeight;
      await sleep(16);
    }
    Object.assign(message, { content: fullText, typing: false });
    bubble.innerHTML = renderMarkdown(fullText);
    return true;
  }

  function stopResponse() {
    const run = activeResponseRun;
    if (!run) return;
    run.cancelled = true;
    clearTimeout(run.timeoutId);
    run.controller.abort();
    markResponseStopped(run.id);
    activeResponseRun = null;
    setBusy(false);
    persistState();
    renderAll();
  }

  function markResponseStopped(id) {
    const chat = getCurrentChat();
    const message = chat.messages.find((item) => item.id === id);
    if (!message) return;
    Object.assign(message, {
      content: message.content?.trim() || "Stopped.",
      loading: false,
      showThinking: false,
      typing: false,
      stopped: true,
    });
  }

  function createAbortError() {
    try {
      return new DOMException("Stopped", "AbortError");
    } catch {
      const error = new Error("Stopped");
      error.name = "AbortError";
      return error;
    }
  }

  function isAbortError(error) {
    return error?.name === "AbortError" || /abort|cancel|stop/i.test(error?.message || "");
  }

  function findMessageBubble(id) {
    const rows = $$(".message", els.messages);
    const chat = getCurrentChat();
    const index = chat.messages.findIndex((message) => message.id === id);
    return rows[index]?.querySelector(".bubble") || null;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function appendToolMessage(content) {
    const chat = getCurrentChat();
    chat.messages.push({ id: uid("msg"), role: "tool", content, createdAt: nowIso() });
    chat.updatedAt = nowIso();
    saveAndRender();
  }

  function appendAssistant(content) {
    const chat = getCurrentChat();
    chat.messages.push({ id: uid("msg"), role: "assistant", content, createdAt: nowIso() });
    chat.updatedAt = nowIso();
    saveAndRender();
  }

  function titleFromText(currentTitle, text) {
    if (currentTitle && currentTitle !== "New chat") return currentTitle;
    return text.replace(/\s+/g, " ").slice(0, 54) || "New chat";
  }

  function buildModelMessages(latestText) {
    const chat = getCurrentChat();
    const agent = getActiveAgent();
    const memory = recallMemories(latestText, 8);
    const tools = state.enabledTools
      .slice(0, 80)
      .map((id) => toolCatalog.find((tool) => tool.id === id)?.name)
      .filter(Boolean)
      .join(", ");
    const system = [
      state.settings.personality,
      `Response style: ${state.settings.style}. Restriction preference: ${state.settings.restrictions}.`,
      `Active agent: ${agent.name}. Personality: ${agent.personality}. Mission: ${agent.mission}.`,
      state.canvas?.openInline && state.canvas.content ? `Active chat canvas "${state.canvas.title || "Untitled"}":\n${state.canvas.content.slice(0, 8000)}` : "",
      memory.length ? `Relevant local memories:\n${memory.map((item) => `- ${item.text}`).join("\n")}` : "",
      tools ? `Enabled tool names for planning: ${tools}. If you need a live tool, ask the user to run a slash command such as /web, /browse, /research, /sandbox, /canvas, or /memory.` : "",
      "Be honest when a requested hosted model/provider is not configured. Do not pretend to have a real Linux VM; use the browser sandbox unless a remote endpoint is configured.",
    ].filter(Boolean).join("\n\n");

    const recent = chat.messages
      .filter((message) => !message.loading)
      .filter((message) => message.role !== "tool" || message.content.length < 2500)
      .slice(-16)
      .map((message) => ({
        role: message.role === "tool" ? "user" : message.role,
        content: message.role === "tool" ? `Tool result:\n${message.content}` : (message.modelContent || message.content),
      }));
    return [{ role: "system", content: system }, ...recent];
  }

  function chooseModel(text) {
    const lower = text.toLowerCase();
    if (!state.autoChoose) {
      const active = getActiveModel();
      setModelReason(active, "Manual selection");
      return active;
    }

    const customConfigured = state.providers.customBaseUrl && (state.providers.customModel || getActiveModel().model);
    let targetId = "pollinations:openai-fast";
    let reason = "Free no-key default";
    if (customConfigured && /kimi|long|deep|reason|analy[sz]e|architecture|multi.?agent/.test(lower)) {
      targetId = getModelById("custom:kimi-k2.6") ? "custom:kimi-k2.6" : state.activeModelId;
      reason = "Complex reasoning matched custom Kimi-style endpoint";
    } else if (state.providers.pollinationsKey && /code|bug|html|css|javascript|python|terminal|build|app|refactor/.test(lower)) {
      targetId = "pollinations:qwen-coder";
      reason = "Coding task matched qwen-coder";
    } else if (state.providers.pollinationsKey && /research|cite|compare|investigate|latest|source/.test(lower)) {
      targetId = "pollinations:openai-large";
      reason = "Research task matched larger reasoning preset";
    } else if (/private|offline|local/.test(lower) && navigator.gpu) {
      targetId = "local:qwen2.5-0.5b";
      reason = "Local/private hint matched browser model";
    }
    const selected = getModelById(targetId) || getActiveModel();
    state.activeModelId = selected.id;
    setModelReason(selected, reason);
    persistState();
    return selected;
  }

  function setModelReason(model, reason) {
    model._lastReason = reason;
  }

  function getActiveModel() {
    return getModelById(state.activeModelId) || state.models[0] || baseModels[0];
  }

  function getModelById(id) {
    return state.models.find((model) => model.id === id) || baseModels.find((model) => model.id === id);
  }

  async function callModel(messages, model, signal) {
    if (!model) model = getActiveModel();
    if (model.provider === "pollinations") return callPollinationsLegacy(messages, model, signal);
    if (model.provider === "pollinations-auth") return callPollinationsAuth(messages, model, signal);
    if (model.provider === "horde") return callHorde(messages, model, signal);
    if (model.provider === "custom") return callCustom(messages, model, signal);
    if (model.provider === "local") return callLocalModel(messages, model, signal);
    throw new Error(`Unknown provider: ${model.provider}`);
  }

  async function callPollinationsLegacy(messages, model, signal) {
    const body = {
      model: model.model || "openai-fast",
      messages,
      temperature: state.settings.temperature,
      max_tokens: state.settings.maxTokens,
    };
    const response = await fetch("https://text.pollinations.ai/openai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(text || `Pollinations returned ${response.status}`);
    const data = parseMaybeJson(text);
    return data?.choices?.[0]?.message?.content || data?.choices?.[0]?.text || text;
  }

  async function callPollinationsAuth(messages, model, signal) {
    if (!state.providers.pollinationsKey) {
      if (model.model === "openai-fast" || model.model === "openai") {
        return callPollinationsLegacy(messages, { ...model, model: "openai-fast" }, signal);
      }
      throw new Error("This Pollinations model needs a Pollinations key. Add it in Settings > Providers, or choose the no-key openai-fast model.");
    }
    const response = await fetch("https://gen.pollinations.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${state.providers.pollinationsKey}`,
      },
      body: JSON.stringify({
        model: model.model,
        messages,
        temperature: state.settings.temperature,
        max_tokens: state.settings.maxTokens,
      }),
      signal,
    });
    const data = await parseResponse(response, "Pollinations");
    return data?.choices?.[0]?.message?.content || "No response content returned.";
  }

  async function callHorde(messages, model, signal) {
    const selected = model.model;
    const response = await fetch("https://oai.stablehorde.net/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${state.providers.hordeKey || "0000000000"}`,
      },
      body: JSON.stringify({
        model: selected,
        messages,
        temperature: state.settings.temperature,
        max_tokens: state.settings.maxTokens,
      }),
      signal,
    });
    const data = await parseResponse(response, "AI Horde");
    return data?.choices?.[0]?.message?.content || "AI Horde returned no message.";
  }

  async function callCustom(messages, model, signal) {
    const baseUrl = state.providers.customBaseUrl.replace(/\/+$/, "");
    if (!baseUrl) {
      throw new Error("Custom model selected, but no custom OpenAI-compatible base URL is set in Settings > Providers.");
    }
    const modelName = state.providers.customModel || model.model;
    if (!modelName) throw new Error("Custom model selected, but no model name is configured.");
    const headers = { "Content-Type": "application/json" };
    if (state.providers.customKey) headers.Authorization = `Bearer ${state.providers.customKey}`;
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: modelName,
        messages,
        temperature: state.settings.temperature,
        max_tokens: state.settings.maxTokens,
      }),
      signal,
    });
    const data = await parseResponse(response, "Custom endpoint");
    return data?.choices?.[0]?.message?.content || data?.message?.content || "Custom endpoint returned no message.";
  }

  async function callLocalModel(messages, model, signal) {
    if (signal?.aborted) throw createAbortError();
    if (!navigator.gpu) {
      throw new Error("This browser does not expose WebGPU, so browser-local LLM inference is unavailable. Use the no-key hosted model or a custom endpoint.");
    }
    if (!webllmEngine || webllmEngine.modelId !== model.model) {
      const webllm = await import("https://esm.run/@mlc-ai/web-llm");
      webllmEngine = await webllm.CreateMLCEngine(model.model, {
        initProgressCallback: (progress) => {
          els.thinkingState.textContent = progress.text || "Loading local model";
        },
      });
      webllmEngine.modelId = model.model;
    }
    if (signal?.aborted) throw createAbortError();
    const completion = await webllmEngine.chat.completions.create({
      messages,
      temperature: state.settings.temperature,
      max_tokens: Math.min(900, state.settings.maxTokens),
    });
    if (signal?.aborted) throw createAbortError();
    return completion?.choices?.[0]?.message?.content || "Local model returned no content.";
  }

  async function parseResponse(response, label) {
    const text = await response.text();
    const data = parseMaybeJson(text);
    if (!response.ok) {
      const message = data?.error?.message || data?.detail || data?.message || text || `${label} returned ${response.status}`;
      throw new Error(message);
    }
    return data;
  }

  function parseMaybeJson(text) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  async function handleSlashCommand(text) {
    if (!text.startsWith("/")) return false;
    const [rawCommand, ...rest] = text.slice(1).split(/\s+/);
    const command = rawCommand.toLowerCase();
    const arg = rest.join(" ").trim();
    try {
      if (command === "help") {
        appendAssistant("Commands: `/research topic`, `/web query`, `/browse url`, `/memory add text`, `/memory search query`, `/canvas content`, `/sandbox command`, `/agents debate topic`, `/model model-name`, `/settings`.");
      } else if (command === "research") {
        await runResearch(arg || "Open source AI models", { showTab: true, appendToChat: true });
      } else if (command === "web") {
        const sources = await searchPublicSources(arg);
        appendToolMessage(formatSources(sources));
      } else if (command === "browse") {
        const content = await browseUrl(arg);
        appendToolMessage(`Browsed ${arg}\n\n${content.slice(0, 5000)}`);
      } else if (command === "memory") {
        handleMemoryCommand(arg);
      } else if (command === "canvas") {
        state.canvas.content = arg || state.canvas.content;
        state.canvas.title = titleFromText("New canvas", arg || "Canvas");
        state.canvas.openInline = true;
        saveAndRender();
        setTab("chat");
      } else if (command === "sandbox") {
        const result = await executeSandboxCommand(arg || "help");
        appendToolMessage(`Sandbox:\n${result}`);
      } else if (command === "agents") {
        await runAgentCouncil(arg.replace(/^debate\s*/i, "") || "Review the current task.");
      } else if (command === "model") {
        selectModelBySearch(arg);
      } else if (command === "settings") {
        setTab("settings");
      } else {
        appendAssistant(`Unknown command: /${command}. Try /help.`);
      }
    } catch (error) {
      appendAssistant(friendlyError(error));
    }
    return true;
  }

  function handleMemoryCommand(arg) {
    if (arg.startsWith("add ")) {
      addMemory(arg.slice(4), ["chat"], 6);
      appendToolMessage("Memory saved.");
      return;
    }
    if (arg.startsWith("search ")) {
      const items = recallMemories(arg.slice(7), 10);
      appendToolMessage(items.length ? items.map((item) => `- ${item.text}`).join("\n") : "No matching memories.");
      return;
    }
    appendToolMessage("Memory commands: `/memory add ...` or `/memory search ...`");
  }

  function selectModelBySearch(query) {
    const normalized = query.toLowerCase();
    const model = state.models.find((item) => `${item.label} ${item.model} ${item.provider}`.toLowerCase().includes(normalized));
    if (!model) {
      appendAssistant(`No model matched "${query}". Open Model Store to refresh or configure a custom endpoint.`);
      return;
    }
    state.activeModelId = model.id;
    state.autoChoose = false;
    saveAndRender();
    appendToolMessage(`Model selected: ${model.label}`);
  }

  function autoGrowPrompt() {
    els.promptInput.style.height = "auto";
    els.promptInput.style.height = `${Math.min(180, els.promptInput.scrollHeight)}px`;
  }

  async function handleFileInput(event) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    setBusy(true);
    try {
      const loaded = [];
      for (const file of files.slice(0, 12)) {
        loaded.push(await readAttachment(file));
      }
      state.attachments = [...(state.attachments || []), ...loaded];
      renderAttachmentTray();
      toast(`${loaded.length} file${loaded.length === 1 ? "" : "s"} attached.`);
    } catch (error) {
      toast(friendlyError(error));
    } finally {
      els.fileInput.value = "";
      setBusy(false);
    }
  }

  async function readAttachment(file) {
    const base = {
      id: uid("file"),
      name: file.name,
      type: file.type || inferMime(file.name),
      size: file.size,
      createdAt: nowIso(),
    };
    if (file.type.startsWith("image/")) {
      const preview = file.size <= 8_000_000 ? await makeImagePreview(file).catch(() => ({})) : {};
      return { ...base, kind: "image", ...preview };
    }
    if (isTextLike(file)) {
      const text = file.size <= 1_200_000 ? await readFileAsText(file) : "";
      return { ...base, kind: "text", text: text.slice(0, 80_000), truncated: text.length > 80_000 || file.size > 1_200_000 };
    }
    return { ...base, kind: "file" };
  }

  function renderAttachmentTray() {
    const attachments = state?.attachments || [];
    els.attachmentTray.innerHTML = attachments.map((file) => `
      <article class="attachment" data-attachment-id="${escapeAttr(file.id)}">
        ${file.kind === "image" && file.dataUrl ? `<img src="${escapeAttr(file.dataUrl)}" alt="">` : `<i data-lucide="${attachmentIcon(file)}"></i>`}
        <span>
          <strong>${escapeHtml(file.name)}</strong>
          <small>${formatBytes(file.size)}${file.kind === "text" ? " · text" : file.kind === "image" ? " · image" : ""}</small>
        </span>
        <button type="button" title="Remove attachment"><i data-lucide="x"></i></button>
      </article>
    `).join("");
    $$("button", els.attachmentTray).forEach((button) => {
      button.addEventListener("click", () => {
        const id = button.closest(".attachment").dataset.attachmentId;
        state.attachments = (state.attachments || []).filter((file) => file.id !== id);
        renderAttachmentTray();
        scheduleSave();
      });
    });
    refreshIcons();
  }

  function composeModelContent(text, attachments) {
    const blocks = [];
    if (text) blocks.push(text);
    if (attachments?.length) {
      blocks.push(`Attached files:\n${attachments.map((file) => attachmentPromptBlock(file)).join("\n\n")}`);
    }
    return blocks.join("\n\n");
  }

  function attachmentPromptBlock(file) {
    const header = `File: ${file.name}\nType: ${file.type || "unknown"}\nSize: ${formatBytes(file.size)}${file.width ? `\nImage dimensions: ${file.width}x${file.height}` : ""}`;
    if (file.kind === "text") {
      return `${header}\nContent${file.truncated ? " (truncated)" : ""}:\n${file.text || "[file too large to read into context]"}`;
    }
    if (file.kind === "image") {
      return `${header}\nImage preview is attached in the chat UI.${file.dataUrl ? "" : " The image was too large to store as a preview."}`;
    }
    return `${header}\nBinary or unsupported file; metadata only.`;
  }

  function isTextLike(file) {
    const name = file.name.toLowerCase();
    return file.type.startsWith("text/")
      || /(\.txt|\.md|\.html?|\.css|\.js|\.jsx|\.ts|\.tsx|\.json|\.csv|\.xml|\.svg|\.py|\.log|\.yml|\.yaml)$/i.test(name);
  }

  function inferMime(name) {
    const ext = name.toLowerCase().split(".").pop();
    const map = { md: "text/markdown", html: "text/html", htm: "text/html", css: "text/css", js: "text/javascript", json: "application/json", csv: "text/csv", svg: "image/svg+xml", py: "text/x-python" };
    return map[ext] || "application/octet-stream";
  }

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsText(file);
    });
  }

  function readFileAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
  }

  function imageDimensions(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = reject;
      image.src = src;
    });
  }

  async function makeImagePreview(file) {
    const src = await readFileAsDataURL(file);
    const dimensions = await imageDimensions(src);
    const max = 420;
    const scale = Math.min(1, max / Math.max(dimensions.width, dimensions.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(dimensions.width * scale));
    canvas.height = Math.max(1, Math.round(dimensions.height * scale));
    const ctx = canvas.getContext("2d");
    const image = await loadImage(src);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return { ...dimensions, dataUrl: canvas.toDataURL("image/webp", 0.82) };
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = reject;
      image.src = src;
    });
  }

  function attachmentIcon(file) {
    if (file.kind === "image") return "image";
    if (/html|svg|xml/.test(file.type || file.name)) return "file-code-2";
    if (/json|javascript|css|python|typescript/.test(file.type || file.name)) return "file-code";
    if (file.kind === "text") return "file-text";
    return "paperclip";
  }

  function formatBytes(bytes = 0) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  function setBusy(isBusy) {
    els.sendBtn.disabled = isBusy;
    els.thinkingState.textContent = isBusy ? "Thinking" : "Idle";
    updateResponseControls();
  }

  function updateResponseControls() {
    const canStop = !!activeResponseRun;
    els.stopBtn.classList.toggle("hidden", !canStop);
    els.stopBtn.disabled = !canStop;
    els.sendBtn.classList.toggle("hidden", canStop);
  }

  function renderInspector() {
    const model = getActiveModel();
    const agent = getActiveAgent();
    els.providerBadge.textContent = model.free && !model.requiresKey ? "Free" : model.requiresKey ? "Key" : model.providerLabel;
    els.activeModelName.textContent = `${model.providerLabel} ${model.label}`;
    els.modelReason.textContent = model._lastReason || (state.autoChoose ? "Autochoose is ready." : "Manual model selected.");
    els.agentCountBadge.textContent = String(state.agents.length);
    els.activeAgentName.textContent = agent.name;
    els.activeAgentGoal.textContent = agent.mission;
    els.memoryPeek.innerHTML = recallMemories(getCurrentChat().messages.at(-1)?.content || "", 4)
      .map((item) => `<div class="peek-item">${escapeHtml(item.text)}</div>`)
      .join("") || `<div class="peek-item">No memory recalled yet.</div>`;
  }

  function renderModelSelect() {
    els.modelSelect.innerHTML = "";
    els.modelPickerMenu.innerHTML = "";
    const active = getActiveModel();
    els.modelPickerLabel.textContent = active.label;
    els.modelPickerMeta.textContent = active.free && !active.requiresKey ? "Free" : active.requiresKey ? "Key needed" : active.providerLabel;
    state.models.forEach((model) => {
      const option = document.createElement("option");
      option.value = model.id;
      option.textContent = `${model.label}${model.free && !model.requiresKey ? " · free" : model.requiresKey ? " · key" : ""}`;
      option.selected = model.id === state.activeModelId;
      els.modelSelect.appendChild(option);

      const item = document.createElement("button");
      item.className = `model-picker-item${model.id === state.activeModelId ? " active" : ""}`;
      item.type = "button";
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(model.id === state.activeModelId));
      item.innerHTML = `
        <span>
          <strong>${escapeHtml(model.label)}</strong>
          <small>${escapeHtml(model.providerLabel)} · ${escapeHtml((model.tags || []).slice(0, 2).join(", ") || model.model || "")}</small>
        </span>
        ${model.id === state.activeModelId ? '<i data-lucide="check"></i>' : ""}
      `;
      item.addEventListener("click", () => selectModel(model.id));
      els.modelPickerMenu.appendChild(item);
    });
  }

  function selectModel(modelId) {
    state.activeModelId = modelId;
    state.autoChoose = false;
    closeModelPicker();
    saveAndRender();
    toast(`Model set to ${getActiveModel().label}`);
  }

  function closeModelPicker() {
    els.modelPicker?.classList.remove("open");
    els.modelPickerButton?.setAttribute("aria-expanded", "false");
  }

  function enhanceCustomSelects() {
    $$("select[data-custom-select]").forEach((select) => {
      if (select.dataset.enhanced === "true") return;
      select.dataset.enhanced = "true";
      select.classList.add("native-select-hidden");
      const root = document.createElement("div");
      root.className = "custom-select";
      root.dataset.selectId = select.id;
      root.innerHTML = `
        <button class="custom-select-button" type="button" aria-haspopup="listbox" aria-expanded="false">
          <span></span>
          <i data-lucide="chevron-down"></i>
        </button>
        <div class="custom-select-menu" role="listbox"></div>
      `;
      select.insertAdjacentElement("afterend", root);
      $(".custom-select-button", root).addEventListener("click", () => {
        const willOpen = !root.classList.contains("open");
        closeCustomSelects(root);
        root.classList.toggle("open", willOpen);
        $(".custom-select-button", root).setAttribute("aria-expanded", String(willOpen));
      });
      renderCustomSelect(select);
    });
  }

  function renderCustomSelect(select) {
    const root = select.nextElementSibling?.classList?.contains("custom-select") ? select.nextElementSibling : null;
    if (!root) return;
    const selected = select.options[select.selectedIndex] || select.options[0];
    $(".custom-select-button span", root).textContent = selected?.textContent || "";
    $(".custom-select-menu", root).innerHTML = Array.from(select.options).map((option) => `
      <button class="custom-select-item ${option.value === select.value ? "active" : ""}" data-value="${escapeAttr(option.value)}" type="button" role="option" aria-selected="${option.value === select.value}">
        <span>${escapeHtml(option.textContent)}</span>
        ${option.value === select.value ? '<i data-lucide="check"></i>' : ""}
      </button>
    `).join("");
    $$(".custom-select-item", root).forEach((item) => {
      item.addEventListener("click", () => {
        select.value = item.dataset.value;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        renderCustomSelect(select);
        closeCustomSelects();
      });
    });
  }

  function syncCustomSelects() {
    $$("select[data-custom-select]").forEach(renderCustomSelect);
  }

  function closeCustomSelects(except = null) {
    $$(".custom-select.open").forEach((root) => {
      if (root === except) return;
      root.classList.remove("open");
      $(".custom-select-button", root)?.setAttribute("aria-expanded", "false");
    });
  }

  function renderModels() {
    if (!state) return;
    const query = (els.modelSearch.value || "").toLowerCase();
    const models = state.models.filter((model) => {
      const haystack = `${model.label} ${model.model} ${model.provider} ${(model.tags || []).join(" ")}`.toLowerCase();
      const matchesQuery = !query || haystack.includes(query);
      const matchesFilter = activeModelFilter === "all"
        || (activeModelFilter === "free" && model.free && !model.requiresKey)
        || model.provider.includes(activeModelFilter)
        || (activeModelFilter === "custom" && model.provider === "custom")
        || (activeModelFilter === "local" && model.provider === "local");
      return matchesQuery && matchesFilter;
    });
    els.modelGrid.innerHTML = models.map((model) => `
      <article class="model-card ${model.id === state.activeModelId ? "active" : ""}" data-model-id="${escapeAttr(model.id)}">
        <div class="card-top">
          <strong>${escapeHtml(model.label)}</strong>
          <button class="ghost tiny use-model" type="button">Use</button>
        </div>
        <div class="badge-row">
          <span class="badge ${model.free && !model.requiresKey ? "good" : model.requiresKey ? "warn" : ""}">${escapeHtml(model.providerLabel)}</span>
          ${(model.tags || []).slice(0, 5).map((tag) => `<span class="badge">${escapeHtml(tag)}</span>`).join("")}
        </div>
        <p class="micro">${escapeHtml(model.note || model.model || "")}</p>
      </article>
    `).join("");
    $$(".use-model", els.modelGrid).forEach((button) => {
      button.addEventListener("click", (event) => {
        const card = event.target.closest(".model-card");
        state.activeModelId = card.dataset.modelId;
        state.autoChoose = false;
        saveAndRender();
      });
    });
  }

  async function refreshModels(options = {}) {
    const discovered = clone(baseModels);
    try {
      const pollinationModels = await fetch("https://text.pollinations.ai/models").then((res) => res.json());
      pollinationModels.forEach((item) => {
        const name = item.name || item.id || item;
        discovered.push({
          id: `pollinations:${name}`,
          provider: name === "openai-fast" ? "pollinations" : "pollinations-auth",
          providerLabel: "Pollinations",
          label: name,
          model: name,
          tags: ["pollinations", ...(item.reasoning ? ["reasoning"] : []), ...(item.tools ? ["tools"] : [])],
          free: item.tier === "anonymous" || name === "openai-fast",
          requiresKey: !(item.tier === "anonymous" || name === "openai-fast"),
          note: item.description || "Discovered from Pollinations.",
        });
      });
    } catch (error) {
      if (!options.silent) toast("Pollinations model refresh failed.");
    }

    try {
      const hordeModels = await fetch("https://oai.stablehorde.net/v1/models").then((res) => res.json());
      (hordeModels.data || []).slice(0, 120).forEach((item) => {
        discovered.push({
          id: `horde:${item.id}`,
          provider: "horde",
          providerLabel: "AI Horde",
          label: item.clean_name || item.name || item.id,
          model: item.id,
          tags: ["horde", item.backend, item.base_model, `${item.size || "?"}B`].filter(Boolean),
          free: true,
          requiresKey: false,
          note: `${item.backend || "worker"} ${item.size ? `${item.size}B` : ""} ${item.quant || ""}`.trim(),
        });
      });
    } catch (error) {
      if (!options.silent) toast("AI Horde model refresh failed.");
    }

    state.models = mergeModels(discovered, state.models.filter((model) => model.provider === "custom"));
    persistState();
    renderModelSelect();
    renderModels();
    renderInspector();
    if (!options.silent) toast("Model store refreshed.");
  }

  function renderAgents() {
    els.agentList.innerHTML = state.agents.map((agent) => `
      <article class="agent-card ${agent.id === state.activeAgentId ? "active" : ""}" data-agent-id="${escapeAttr(agent.id)}">
        <div class="card-top">
          <strong>${escapeHtml(agent.name)}</strong>
          <button class="ghost tiny use-agent" type="button">Use</button>
        </div>
        <p class="micro">${escapeHtml(agent.personality)}</p>
        <p>${escapeHtml(agent.mission)}</p>
        <div class="badge-row"><span class="badge">${escapeHtml(agent.toolPreset)}</span></div>
      </article>
    `).join("");
    $$(".use-agent", els.agentList).forEach((button) => {
      button.addEventListener("click", (event) => {
        state.activeAgentId = event.target.closest(".agent-card").dataset.agentId;
        saveAndRender();
      });
    });
  }

  function getActiveAgent() {
    return state.agents.find((agent) => agent.id === state.activeAgentId) || state.agents[0];
  }

  function resetAgentForm() {
    els.agentName.value = "";
    els.agentPersonality.value = "";
    els.agentMission.value = "";
    els.agentToolPreset.value = "Balanced";
    syncCustomSelects();
    els.agentName.focus();
  }

  function saveAgentFromForm(event) {
    event.preventDefault();
    const name = els.agentName.value.trim();
    if (!name) {
      toast("Agent needs a name.");
      return;
    }
    const agent = {
      id: uid("agent"),
      name,
      personality: els.agentPersonality.value.trim() || "Direct and useful.",
      mission: els.agentMission.value.trim() || "Help with the current task.",
      toolPreset: els.agentToolPreset.value,
      createdAt: nowIso(),
    };
    state.agents.push(agent);
    state.activeAgentId = agent.id;
    resetAgentForm();
    saveAndRender();
  }

  async function runAgentCouncil(topic) {
    if (!topic) topic = "Analyze the current chat.";
    appendToolMessage(`Agent council started for: ${topic}`);
    const agents = state.agents.slice(0, 5);
    const outputs = [];
    for (const agent of agents) {
      const messages = [
        { role: "system", content: `You are ${agent.name}. Personality: ${agent.personality}. Mission: ${agent.mission}. Give a short expert viewpoint.` },
        { role: "user", content: topic },
      ];
      try {
        const output = await callModel(messages, chooseModel(topic));
        outputs.push(`## ${agent.name}\n${output}`);
      } catch (error) {
        outputs.push(`## ${agent.name}\nCould not respond: ${friendlyError(error)}`);
      }
    }
    const mergedPrompt = `Merge these agent viewpoints into one practical answer:\n\n${outputs.join("\n\n")}`;
    try {
      const merged = await callModel([{ role: "user", content: mergedPrompt }], chooseModel(topic));
      appendAssistant(`${outputs.join("\n\n")}\n\n## Merged answer\n${merged}`);
    } catch {
      appendAssistant(outputs.join("\n\n"));
    }
  }

  function renderTools() {
    const query = (els.toolSearch.value || "").toLowerCase();
    const enabled = new Set(state.enabledTools);
    const filtered = toolCatalog.filter((tool) => {
      const haystack = `${tool.name} ${tool.category} ${tool.description}`.toLowerCase();
      return !query || haystack.includes(query);
    });
    els.toolStats.innerHTML = `
      <span class="badge good">${enabled.size} enabled</span>
      <span class="badge">${toolCatalog.length} total tools</span>
      <span class="badge">Core tools run locally</span>
    `;
    els.toolGrid.innerHTML = filtered.map((tool) => `
      <label class="tool-card">
        <div class="card-top">
          <strong>${escapeHtml(tool.name)}</strong>
          <input type="checkbox" data-tool-id="${escapeAttr(tool.id)}" ${enabled.has(tool.id) ? "checked" : ""}>
        </div>
        <div class="badge-row"><span class="badge">${escapeHtml(tool.category)}</span>${tool.local ? `<span class="badge good">local</span>` : ""}</div>
        <p class="micro">${escapeHtml(tool.description)}</p>
      </label>
    `).join("");
    $$("input[type='checkbox']", els.toolGrid).forEach((box) => {
      box.addEventListener("change", () => {
        if (box.checked) {
          state.enabledTools = Array.from(new Set([...state.enabledTools, box.dataset.toolId]));
        } else {
          state.enabledTools = state.enabledTools.filter((id) => id !== box.dataset.toolId);
        }
        persistState();
        renderInspector();
        renderTools();
      });
    });
  }

  async function runResearch(query, options = {}) {
    if (!query) {
      toast("Enter a research topic.");
      return;
    }
    state.research.query = query;
    if (options.showTab) state.activeTab = "research";
    renderAll();
    els.researchReport.innerHTML = `<span class="loading-dots"><span></span><span></span><span></span></span>`;
    setBusy(true);
    try {
      const sources = els.researchUseWeb.checked !== false ? await searchPublicSources(query) : [];
      state.research.sources = sources;
      renderResearch();
      const memories = els.researchUseMemory.checked ? recallMemories(query, 8) : [];
      const sourceText = sources.map((source, index) => `[${index + 1}] ${source.title}\n${source.url}\n${source.snippet}`).join("\n\n");
      const memoryText = memories.map((memory) => `- ${memory.text}`).join("\n");
      const prompt = `Create a concise deep research report for: ${query}\n\nSources:\n${sourceText || "No web sources available."}\n\nLocal memory:\n${memoryText || "None"}\n\nInclude useful caveats and cite source numbers where possible.`;
      const report = await callModel([{ role: "user", content: prompt }], chooseModel(query));
      state.research.report = report;
      if (options.appendToChat) appendAssistant(report);
    } catch (error) {
      state.research.report = friendlyError(error);
    } finally {
      setBusy(false);
      saveAndRender();
    }
  }

  async function searchPublicSources(query) {
    const encoded = encodeURIComponent(query);
    const results = [];
    const tasks = [
      fetch(`https://en.wikipedia.org/w/api.php?action=opensearch&origin=*&limit=5&format=json&search=${encoded}`)
        .then((res) => res.json())
        .then((data) => {
          const titles = data[1] || [];
          const snippets = data[2] || [];
          const urls = data[3] || [];
          titles.forEach((title, index) => results.push({ title, snippet: snippets[index] || "Wikipedia result", url: urls[index], source: "Wikipedia" }));
        }),
      fetch(`https://hn.algolia.com/api/v1/search?query=${encoded}&tags=story&hitsPerPage=4`)
        .then((res) => res.json())
        .then((data) => {
          (data.hits || []).forEach((hit) => results.push({ title: hit.title || hit.story_title, snippet: `HN points: ${hit.points || 0}`, url: hit.url || `https://news.ycombinator.com/item?id=${hit.objectID}`, source: "Hacker News" }));
        }),
      fetch(`https://api.github.com/search/repositories?q=${encoded}&per_page=4`)
        .then((res) => res.json())
        .then((data) => {
          (data.items || []).forEach((repo) => results.push({ title: repo.full_name, snippet: repo.description || "GitHub repository", url: repo.html_url, source: "GitHub" }));
        }),
      fetch(`https://registry.npmjs.org/-/v1/search?text=${encoded}&size=4`)
        .then((res) => res.json())
        .then((data) => {
          (data.objects || []).forEach((item) => results.push({ title: item.package.name, snippet: item.package.description || "npm package", url: item.package.links?.npm, source: "npm" }));
        }),
    ];

    if (state.providers.jinaKey) {
      tasks.push(fetch(`https://s.jina.ai/${encoded}`, {
        headers: { Authorization: `Bearer ${state.providers.jinaKey}`, Accept: "application/json" },
      }).then((res) => res.json()).then((data) => {
        (data.data || []).forEach((item) => results.push({ title: item.title, snippet: item.content?.slice(0, 500) || "Jina search result", url: item.url, source: "Jina" }));
      }));
    }

    await Promise.allSettled(tasks);
    return dedupeSources(results).slice(0, 14);
  }

  function dedupeSources(sources) {
    const seen = new Set();
    return sources.filter((source) => {
      if (!source.url || seen.has(source.url)) return false;
      seen.add(source.url);
      return true;
    });
  }

  async function browseUrl(url) {
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    const headers = state.providers.jinaKey ? { Authorization: `Bearer ${state.providers.jinaKey}` } : {};
    const response = await fetch(`https://r.jina.ai/${url}`, { headers });
    if (!response.ok) throw new Error(`Reader returned ${response.status}`);
    return response.text();
  }

  function renderResearch() {
    els.researchQuery.value = state.research.query || els.researchQuery.value || "";
    els.sourceList.innerHTML = (state.research.sources || []).map((source, index) => `
      <article class="source-item">
        <strong>[${index + 1}] ${escapeHtml(source.title || "Untitled")}</strong>
        <div>${escapeHtml(source.source || "Web")} · <a href="${escapeAttr(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.url)}</a></div>
        <p>${escapeHtml(source.snippet || "")}</p>
      </article>
    `).join("");
    els.researchReport.innerHTML = renderMarkdown(state.research.report || "No report yet.");
  }

  function formatSources(sources) {
    if (!sources.length) return "No public sources found from the enabled browser APIs.";
    return sources.map((source, index) => `[${index + 1}] ${source.title}\n${source.url}\n${source.snippet}`).join("\n\n");
  }

  function addMemory(text, tags = [], importance = 6) {
    if (!text?.trim()) return;
    state.memories.unshift({
      id: uid("mem"),
      text: text.trim(),
      tags,
      importance: Number(importance) || 6,
      createdAt: nowIso(),
    });
    scheduleSave();
  }

  function maybeSaveMemory(userText, reply) {
    if (!state.settings.memoryEnabled) return;
    const lower = userText.toLowerCase();
    if (/remember|my name is|i like|i prefer|from now on|save this|important/.test(lower)) {
      addMemory(userText, ["auto"], 7);
    }
    if (/project|todo|deadline|preference/.test(lower) && userText.length < 900) {
      addMemory(userText, ["chat"], 5);
    }
    void reply;
  }

  function recallMemories(query, limit = 6) {
    const words = new Set((query || "").toLowerCase().match(/[a-z0-9]{3,}/g) || []);
    return [...state.memories]
      .map((memory) => {
        const text = `${memory.text} ${(memory.tags || []).join(" ")}`.toLowerCase();
        let score = memory.importance || 1;
        words.forEach((word) => {
          if (text.includes(word)) score += 3;
        });
        return { ...memory, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  function renderMemory() {
    const query = (els.memorySearch.value || "").toLowerCase();
    const items = state.memories.filter((memory) => {
      const haystack = `${memory.text} ${(memory.tags || []).join(" ")}`.toLowerCase();
      return !query || haystack.includes(query);
    });
    els.memoryList.innerHTML = items.map((memory) => `
      <article class="memory-item">
        <p>${escapeHtml(memory.text)}</p>
        <div class="memory-meta">${escapeHtml((memory.tags || []).join(", ") || "untagged")} · importance ${memory.importance} · ${formatDate(memory.createdAt)}</div>
        <button class="ghost tiny delete-memory" data-memory-id="${escapeAttr(memory.id)}" type="button">Delete</button>
      </article>
    `).join("") || `<div class="peek-item">No memories yet.</div>`;
    $$(".delete-memory", els.memoryList).forEach((button) => {
      button.addEventListener("click", () => {
        state.memories = state.memories.filter((memory) => memory.id !== button.dataset.memoryId);
        saveAndRender();
      });
    });
  }

  function saveMemoryFromForm(event) {
    event.preventDefault();
    addMemory(
      els.memoryText.value,
      els.memoryTags.value.split(",").map((tag) => tag.trim()).filter(Boolean),
      els.memoryImportance.value,
    );
    els.memoryText.value = "";
    els.memoryTags.value = "";
    saveAndRender();
  }

  async function clearMemory() {
    if (!await uiConfirm({
      title: "Clear memory?",
      message: "This removes all saved local memories for this account.",
      confirmLabel: "Clear memory",
      danger: true,
    })) return;
    state.memories = [];
    saveAndRender();
  }

  function renderCanvas() {
    els.canvasTitle.value = state.canvas.title || "";
    if (els.canvasEditor.value !== state.canvas.content) {
      els.canvasEditor.value = state.canvas.content || "";
    }
    renderCanvasPreview();
  }

  function toggleInlineCanvas() {
    state.canvas.openInline = !state.canvas.openInline;
    if (state.canvas.openInline) state.activeTab = "chat";
    saveAndRender();
    if (state.canvas.openInline) {
      requestAnimationFrame(() => els.inlineCanvasEditor.focus());
    }
  }

  function renderInlineCanvas() {
    const isOpen = !!state.canvas.openInline;
    els.inlineCanvasPanel.classList.toggle("hidden", !isOpen);
    els.canvasModeBtn.classList.toggle("active", isOpen);
    if (!isOpen) return;
    if (els.inlineCanvasTitle.value !== (state.canvas.title || "")) {
      els.inlineCanvasTitle.value = state.canvas.title || "";
    }
    if (els.inlineCanvasEditor.value !== (state.canvas.content || "")) {
      els.inlineCanvasEditor.value = state.canvas.content || "";
    }
    els.inlineCanvasPreview.classList.toggle("hidden", !state.canvas.previewInline);
    els.inlineCanvasPreviewBtn.classList.toggle("active", !!state.canvas.previewInline);
    if (state.canvas.previewInline) {
      const content = state.canvas.content || "";
      if (/<\/?[a-z][\s\S]*>/i.test(content)) {
        els.inlineCanvasPreview.innerHTML = `<iframe title="Inline canvas preview"></iframe>`;
        $("iframe", els.inlineCanvasPreview).srcdoc = content;
      } else {
        els.inlineCanvasPreview.innerHTML = renderMarkdown(content || "Canvas is empty.");
      }
    }
  }

  function newCanvas() {
    state.canvas = { title: "Untitled canvas", content: "", openInline: true, previewInline: false };
    saveAndRender();
    els.inlineCanvasEditor.focus();
  }

  function renderCanvasPreview() {
    const content = state.canvas.content || "";
    if (/<\/?[a-z][\s\S]*>/i.test(content) && /<html|<body|<div|<section|<!doctype/i.test(content)) {
      els.canvasFrame.classList.remove("hidden");
      els.canvasMarkdown.classList.add("hidden");
      els.canvasFrame.srcdoc = content;
    } else {
      els.canvasFrame.classList.add("hidden");
      els.canvasMarkdown.classList.remove("hidden");
      els.canvasMarkdown.innerHTML = renderMarkdown(content || "Canvas is empty.");
    }
  }

  async function askCanvasImprove() {
    const content = state.canvas.content || "";
    if (!content.trim()) {
      toast("Canvas is empty.");
      return;
    }
    setBusy(true);
    try {
      const prompt = `Improve this canvas while preserving its purpose. Return only the improved content.\n\n${content}`;
      state.canvas.content = await callModel([{ role: "user", content: prompt }], chooseModel(prompt));
      saveAndRender();
    } catch (error) {
      toast(friendlyError(error));
    } finally {
      setBusy(false);
    }
  }

  function renderSandbox() {
    renderTerminal();
    renderSandboxFiles();
  }

  function renderTerminal() {
    els.terminalOutput.innerHTML = state.sandbox.history.slice(-200).map((line) => (
      `<div class="terminal-line ${escapeAttr(line.kind)}">${escapeHtml(line.text)}</div>`
    )).join("");
    els.terminalOutput.scrollTop = els.terminalOutput.scrollHeight;
  }

  function renderSandboxFiles() {
    const files = Object.keys(state.sandbox.files).sort();
    if (!files.includes(selectedSandboxFile)) selectedSandboxFile = files[0] || "";
    els.sandboxFiles.innerHTML = files.map((file) => `
      <button class="file-item ${file === selectedSandboxFile ? "active" : ""}" data-file="${escapeAttr(file)}" type="button">
        <span>${escapeHtml(file)}</span>
        <span class="badge">${state.sandbox.files[file].length}b</span>
      </button>
    `).join("");
    $$(".file-item", els.sandboxFiles).forEach((button) => {
      button.addEventListener("click", () => {
        selectedSandboxFile = button.dataset.file;
        renderSandboxFiles();
      });
    });
    els.sandboxFileEditor.value = selectedSandboxFile ? state.sandbox.files[selectedSandboxFile] || "" : "";
  }

  async function runTerminalCommand(event) {
    event.preventDefault();
    const command = els.terminalInput.value.trim();
    if (!command) return;
    els.terminalInput.value = "";
    state.sandbox.history.push({ kind: "cmd", text: `$ ${command}` });
    const result = await executeSandboxCommand(command);
    if (result) state.sandbox.history.push({ kind: result.startsWith("Error:") ? "err" : "out", text: result });
    saveAndRender();
  }

  async function executeSandboxCommand(commandLine) {
    const [command, ...parts] = splitCommand(commandLine);
    const arg = parts.join(" ");
    const files = state.sandbox.files;
    try {
      switch ((command || "help").toLowerCase()) {
        case "help":
          return "Commands: help, ls, pwd, cat <file>, write <file> <text>, append <file> <text>, rm <file>, run <jsfile>, html <htmlfile>, fetch <url>, echo <text>, date, clear.";
        case "pwd":
          return state.sandbox.cwd;
        case "ls":
          return Object.keys(files).sort().join("\n");
        case "cat":
          return files[arg] ?? `Error: no such file ${arg}`;
        case "write": {
          const [file, ...text] = parts;
          if (!file) return "Error: write needs a file name.";
          files[file] = text.join(" ");
          selectedSandboxFile = file;
          return `Wrote ${file}`;
        }
        case "append": {
          const [file, ...text] = parts;
          if (!file) return "Error: append needs a file name.";
          files[file] = `${files[file] || ""}${files[file] ? "\n" : ""}${text.join(" ")}`;
          selectedSandboxFile = file;
          return `Appended ${file}`;
        }
        case "touch":
          files[arg] = files[arg] || "";
          selectedSandboxFile = arg;
          return `Touched ${arg}`;
        case "rm":
          delete files[arg];
          selectedSandboxFile = Object.keys(files)[0] || "";
          return `Removed ${arg}`;
        case "echo":
          return arg;
        case "date":
          return new Date().toString();
        case "clear":
          state.sandbox.history = [];
          return "";
        case "run":
          return runSandboxJs(files[arg] || "", arg);
        case "html":
          if (!files[arg]) return `Error: no such file ${arg}`;
          state.canvas.title = arg;
          state.canvas.content = files[arg];
          state.canvas.openInline = true;
          setTab("chat");
          return `Opened ${arg} in the chat canvas.`;
        case "fetch":
          return (await browseUrl(arg)).slice(0, 6000);
        default:
          return `Error: unknown command "${command}".`;
      }
    } catch (error) {
      return friendlyError(error);
    }
  }

  function splitCommand(input) {
    const matches = input.match(/"[^"]*"|'[^']*'|\S+/g) || [];
    return matches.map((part) => part.replace(/^["']|["']$/g, ""));
  }

  function runSandboxJs(code, filename) {
    const logs = [];
    const sandboxConsole = {
      log: (...args) => logs.push(args.map(String).join(" ")),
      error: (...args) => logs.push(`ERROR ${args.map(String).join(" ")}`),
      warn: (...args) => logs.push(`WARN ${args.map(String).join(" ")}`),
    };
    const readFile = (name) => state.sandbox.files[name] || "";
    const writeFile = (name, content) => {
      state.sandbox.files[name] = String(content);
    };
    const fn = new Function("console", "readFile", "writeFile", `"use strict";\n${code}\n//# sourceURL=${filename || "sandbox.js"}`);
    const result = fn(sandboxConsole, readFile, writeFile);
    if (result !== undefined) logs.push(String(result));
    return logs.join("\n") || "Program completed with no output.";
  }

  function resetSandbox() {
    state.sandbox = defaultAppState(state.profile.name, state.profile.email).sandbox;
    selectedSandboxFile = "README.md";
    saveAndRender();
  }

  async function askSandboxCommand() {
    const request = await uiPrompt({
      title: "Sandbox command",
      message: "Describe what you want the sandbox to do. ChatLLM will draft one command.",
      label: "Task",
      placeholder: "Create an HTML file that says hello",
      confirmLabel: "Draft command",
    });
    if (!request) return;
    try {
      const promptText = `Return one browser sandbox command only. Available commands: help, ls, cat, write, append, rm, run, html, fetch, echo, date. User wants: ${request}`;
      const command = await callModel([{ role: "user", content: promptText }], chooseModel(promptText));
      els.terminalInput.value = command.split("\n")[0].replace(/^`+|`+$/g, "");
      els.terminalInput.focus();
    } catch (error) {
      toast(friendlyError(error));
    }
  }

  function renderSettings() {
    els.settingPersonality.value = state.settings.personality;
    els.settingStyle.value = state.settings.style;
    els.settingRestrictions.value = state.settings.restrictions;
    els.settingMemory.checked = !!state.settings.memoryEnabled;
    els.settingAnimations.checked = !!state.settings.animations;
    els.pollinationsKey.value = state.providers.pollinationsKey;
    els.hordeKey.value = state.providers.hordeKey;
    els.jinaKey.value = state.providers.jinaKey;
    els.customBaseUrl.value = state.providers.customBaseUrl;
    els.customKey.value = state.providers.customKey;
    els.customModel.value = state.providers.customModel;
  }

  function saveSettings(event) {
    event.preventDefault();
    state.settings.personality = els.settingPersonality.value.trim();
    state.settings.style = els.settingStyle.value;
    state.settings.restrictions = els.settingRestrictions.value;
    state.settings.memoryEnabled = els.settingMemory.checked;
    state.settings.animations = els.settingAnimations.checked;
    saveAndRender();
    toast("Settings saved.");
  }

  function saveProviders(event) {
    event.preventDefault();
    state.providers.pollinationsKey = els.pollinationsKey.value.trim();
    state.providers.hordeKey = els.hordeKey.value.trim();
    state.providers.jinaKey = els.jinaKey.value.trim();
    state.providers.customBaseUrl = els.customBaseUrl.value.trim();
    state.providers.customKey = els.customKey.value.trim();
    state.providers.customModel = els.customModel.value.trim();
    saveAndRender();
    toast("Provider settings saved.");
  }

  function openCommandPalette() {
    renderCommandResults();
    els.commandDialog.showModal();
    els.commandInput.value = "";
    els.commandInput.focus();
  }

  function renderCommandResults() {
    const q = (els.commandInput.value || "").toLowerCase();
    const commands = [
      ["New chat", () => createChat(), "square-pen"],
      ["Chat", () => setTab("chat"), "message-square"],
      ["Canvas", () => {
        state.canvas.openInline = true;
        setTab("chat");
      }, "panel-top"],
      ["Agents", () => setTab("agents"), "bot"],
      ["Model store", () => setTab("models"), "store"],
      ["Tools", () => setTab("tools"), "wrench"],
      ["Deep research", () => setTab("research"), "search-check"],
      ["Memory", () => setTab("memory"), "brain"],
      ["Sandbox", () => setTab("sandbox"), "box"],
      ["Settings", () => setTab("settings"), "settings"],
      ["Export data", () => exportAllData(), "download"],
    ].filter(([name]) => name.toLowerCase().includes(q));
    els.commandResults.innerHTML = "";
    commands.forEach(([name, action, icon]) => {
      const button = document.createElement("button");
      button.className = "command-result";
      button.type = "button";
      button.innerHTML = `<i data-lucide="${icon}"></i> ${escapeHtml(name)}`;
      button.addEventListener("click", () => {
        els.commandDialog.close();
        action();
      });
      els.commandResults.appendChild(button);
    });
    refreshIcons();
  }

  function logout() {
    persistState();
    localStorage.removeItem("chatllm:autoLogin");
    location.reload();
  }

  function exportAllData() {
    const payload = {
      exportedAt: nowIso(),
      user: { email: currentUser.email, name: currentUser.name },
      state,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `chatllm-export-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function importData(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const payload = JSON.parse(reader.result);
        state = mergeState(payload.state || payload, defaultAppState(currentUser.name, currentUser.email));
        saveAndRender();
        toast("Data imported.");
      } catch (error) {
        toast("Import failed.");
      }
    };
    reader.readAsText(file);
  }

  async function wipeAccountData() {
    if (!await uiConfirm({
      title: "Wipe account data?",
      message: "Your login remains, but chats, memory, settings, agents, canvas, and sandbox data reset.",
      confirmLabel: "Wipe data",
      danger: true,
    })) return;
    state = defaultAppState(currentUser.name, currentUser.email);
    persistState();
    renderAll();
  }

  function buildToolCatalog() {
    const actual = [
      ["web_search", "Web search", "Research", "Search public APIs and optional Jina search.", true, true],
      ["browse_url", "Browser reader", "Research", "Read public URLs through a markdown reader.", true, true],
      ["deep_research", "Deep research", "Research", "Gather sources and synthesize a report.", true, true],
      ["memory_add", "Add memory", "Memory", "Save a local memory.", true, true],
      ["memory_recall", "Recall memory", "Memory", "Search local long-term memory.", true, true],
      ["canvas_write", "Canvas writer", "Canvas", "Create or update the canvas.", true, true],
      ["canvas_preview", "HTML preview", "Canvas", "Preview canvas HTML.", true, true],
      ["sandbox_shell", "Sandbox shell", "Coding", "Run virtual terminal commands.", true, true],
      ["sandbox_js", "JavaScript runner", "Coding", "Execute JavaScript in an isolated function.", true, true],
      ["agent_council", "Agent council", "Agents", "Ask multiple agents for viewpoints.", true, true],
      ["model_autochoose", "Autochoose model", "Models", "Route tasks to the best configured model.", true, true],
      ["url_summarizer", "URL summarizer", "Research", "Read and summarize URLs.", true, true],
    ];
    const extras = [
      "Code reviewer", "Bug finder", "Unit test writer", "Regex builder", "JSON validator", "CSV inspector", "SQL planner", "Shell explainer",
      "Diff summarizer", "Commit message writer", "PR description writer", "API client builder", "Type generator", "Schema designer",
      "Dockerfile helper", "Compose planner", "Accessibility checker", "SEO checker", "Prompt optimizer", "Translation", "Tone rewrite",
      "Summarizer", "Outline maker", "Study cards", "Quiz maker", "Meeting notes", "Decision matrix", "Risk register", "Timeline builder",
      "Mind map", "Mermaid diagram", "Architecture diagram", "Threat model", "Privacy review", "License checker", "Dependency audit planner",
      "Performance profiler", "Bundle analyzer", "CSS debugger", "Layout inspector", "Animation tuner", "Color palette", "Icon picker",
      "Image prompt", "Sprite planner", "Game design", "NPC dialogue", "Quest writer", "Level planner", "Physics helper", "Math solver",
      "Statistics helper", "Data cleaning", "Chart recommender", "Explainer", "Socratic tutor", "Flashcard scheduler", "Recipe scaler",
      "Travel planner", "Budget planner", "Habit tracker", "Calendar planner", "Email drafter", "Resume editor", "Cover letter",
      "Interview coach", "Negotiation prep", "Legal issue spotter", "Medical question triage", "Financial calculator", "Market watcher",
      "News brief", "Paper finder", "Citation formatter", "Bibliography", "Fact checker", "Counterargument", "Debate coach",
      "Persona simulator", "User story writer", "Acceptance criteria", "Backlog groomer", "Sprint planner", "Incident report",
      "Runbook writer", "Log analyzer", "Config generator", "Env checker", "CLI command builder", "Git helper", "Linux command guide",
      "Network troubleshooter", "Hardware picker", "Steam Deck helper", "Accessibility labels", "Localization table", "Test plan",
      "QA checklist", "Release notes", "Changelog", "Roadmap", "OKR writer", "Metrics planner", "A/B test planner", "Funnel analysis",
      "Customer support reply", "Bug report formatter", "Knowledge base writer", "Onboarding checklist", "Policy drafter", "Safety filter",
      "Roleplay director", "Creative brief", "Brand voice", "Naming helper", "Slogan writer", "Script writer", "Storyboard",
      "Music prompt", "Video prompt", "3D scene planner", "Blender script helper", "Three.js helper", "Canvas game helper",
      "WebGPU checker", "WASM planner", "Database migrator", "Backup planner", "Observability planner", "Alert rule writer",
    ];
    const tools = actual.map(([id, name, category, description, local, defaultOn]) => ({ id, name, category, description, local, default: defaultOn }));
    extras.forEach((name, index) => {
      const category = ["Coding", "Research", "Writing", "Planning", "Creative", "Ops"][index % 6];
      tools.push({
        id: `tool_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`,
        name,
        category,
        description: `${name} capability exposed to the agent prompt and command palette.`,
        local: false,
        default: index < 24,
      });
    });
    return tools;
  }

  function renderMarkdown(text) {
    if (!text) return "";
    const escaped = escapeHtml(text);
    const withCode = escaped.replace(/```(\w+)?\n([\s\S]*?)```/g, (_match, lang, code) => `<pre><code data-lang="${escapeAttr(lang || "")}">${code}</code></pre>`);
    return withCode
      .replace(/^### (.*)$/gm, "<h3>$1</h3>")
      .replace(/^## (.*)$/gm, "<h2>$1</h2>")
      .replace(/^# (.*)$/gm, "<h2>$1</h2>")
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\n{2,}/g, "</p><p>")
      .replace(/\n/g, "<br>")
      .replace(/^/, "<p>")
      .replace(/$/, "</p>")
      .replace(/<p><pre/g, "<pre")
      .replace(/<\/pre><\/p>/g, "</pre>");
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;",
    }[char]));
  }

  function escapeAttr(value) {
    return escapeHtml(value).replace(/`/g, "&#96;");
  }

  function formatDate(date) {
    try {
      return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(date));
    } catch {
      return "";
    }
  }

  function friendlyError(error) {
    const message = error?.message || String(error);
    return `Error: ${message}`;
  }

  function toast(message) {
    els.toast.textContent = message;
    els.toast.classList.add("show");
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => els.toast.classList.remove("show"), 2600);
  }

  async function copyText(text, message) {
    await navigator.clipboard?.writeText(text);
    toast(message || "Copied");
  }

  function uiConfirm({ title = "Confirm", message = "", confirmLabel = "Confirm", cancelLabel = "Cancel", danger = false } = {}) {
    return openAppModal({ title, message, confirmLabel, cancelLabel, danger, input: false });
  }

  function uiPrompt({ title = "Enter value", message = "", label = "Value", value = "", placeholder = "", confirmLabel = "Save", cancelLabel = "Cancel" } = {}) {
    return openAppModal({ title, message, label, value, placeholder, confirmLabel, cancelLabel, input: true });
  }

  function openAppModal(options) {
    return new Promise((resolve) => {
      const dialog = els.appModal;
      const cleanup = () => {
        els.modalForm.removeEventListener("submit", onSubmit);
        els.modalCancelBtn.removeEventListener("click", onCancel);
        els.modalCloseBtn.removeEventListener("click", onCancel);
        dialog.removeEventListener("cancel", onCancel);
        dialog.classList.remove("danger");
      };
      const finish = (value) => {
        cleanup();
        if (dialog.open) dialog.close();
        resolve(value);
      };
      const onSubmit = (event) => {
        event.preventDefault();
        if (options.input) {
          finish(els.modalInput.value);
        } else {
          finish(true);
        }
      };
      const onCancel = (event) => {
        event?.preventDefault?.();
        finish(options.input ? null : false);
      };

      els.modalTitle.textContent = options.title || "Confirm";
      els.modalMessage.textContent = options.message || "";
      els.modalCancelBtn.textContent = options.cancelLabel || "Cancel";
      els.modalConfirmBtn.textContent = options.confirmLabel || "Confirm";
      els.modalInputWrap.classList.toggle("hidden", !options.input);
      els.modalConfirmBtn.classList.toggle("danger", !!options.danger);
      dialog.classList.toggle("danger", !!options.danger);

      if (options.input) {
        els.modalInputLabel.textContent = options.label || "Value";
        els.modalInput.value = options.value || "";
        els.modalInput.placeholder = options.placeholder || "";
      } else {
        els.modalInput.value = "";
      }

      els.modalForm.addEventListener("submit", onSubmit);
      els.modalCancelBtn.addEventListener("click", onCancel);
      els.modalCloseBtn.addEventListener("click", onCancel);
      dialog.addEventListener("cancel", onCancel);

      if (dialog.open) dialog.close();
      dialog.showModal();
      requestAnimationFrame(() => {
        if (options.input) {
          els.modalInput.focus();
          els.modalInput.select();
        } else {
          els.modalConfirmBtn.focus();
        }
        refreshIcons();
      });
    });
  }

  function refreshIcons() {
    if (window.lucide) window.lucide.createIcons();
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
})();
