(() => {
  "use strict";

  const THINKING_TAG_RE = /<\/?(?:think|thinking|reasoning|analysis|scratchpad)[^>]*>/gi;
  const THINKING_BLOCK_RE = /<(?:think|thinking|reasoning|analysis|scratchpad)[^>]*>[\s\S]*?<\/(?:think|thinking|reasoning|analysis|scratchpad)>/gi;
  const TOOL_BLOCK_RE = /<(?:tool_call|tool_calls|function_call|tool|tool_result)[^>]*>[\s\S]*?<\/(?:tool_call|tool_calls|function_call|tool|tool_result)>/gi;
  const FENCED_TOOL_JSON_RE = /```(?:json)?\s*\{\s*"(?:tool_calls|tool_call|function_call|arguments|name)"[\s\S]*?```/gi;

  function stripThinkingAndToolText(value) {
    if (typeof value !== "string") return value;
    let text = value
      .replace(THINKING_BLOCK_RE, "")
      .replace(TOOL_BLOCK_RE, "")
      .replace(FENCED_TOOL_JSON_RE, "")
      .replace(THINKING_TAG_RE, "")
      .replace(/^\s*(?:analysis|thinking|reasoning|scratchpad)\s*:\s*/gim, "")
      .replace(/^\s*(?:tool_call|tool_calls|function_call)\s*:\s*[\s\S]*$/gim, "")
      .trim();

    // Some providers return only a JSON tool-call object as the assistant message.
    // Do not show that raw object as if it were the final answer.
    if (/^\{[\s\S]*\}$/.test(text)) {
      try {
        const parsed = JSON.parse(text);
        if (parsed && (parsed.tool_calls || parsed.tool_call || parsed.function_call || parsed.name === "tool_call")) {
          return "";
        }
      } catch (_) {}
    }
    return text;
  }

  function normalizeContent(content) {
    if (Array.isArray(content)) {
      return content
        .map((part) => {
          if (typeof part === "string") return part;
          if (!part || typeof part !== "object") return "";
          if (typeof part.text === "string") return part.text;
          if (typeof part.content === "string") return part.content;
          return "";
        })
        .join("\n")
        .trim();
    }
    return content;
  }

  function sanitizeMessage(message) {
    if (!message || typeof message !== "object") return;

    if (message.role === "assistant") {
      message.content = stripThinkingAndToolText(normalizeContent(message.content || ""));
      delete message.reasoning;
      delete message.reasoning_content;
      delete message.thought;
      delete message.thinking;
      delete message.analysis;

      if (message.tool_calls || message.function_call) {
        message.tool_calls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
        delete message.function_call;
        if (!message.content) {
          message.content = "I tried to use a tool, but the provider returned only a tool-call payload. Please retry or turn tools off for this model.";
        }
      }
    }
  }

  function sanitizeProviderPayload(payload) {
    if (!payload || typeof payload !== "object") return payload;

    if (Array.isArray(payload.choices)) {
      payload.choices.forEach((choice) => {
        sanitizeMessage(choice.message);
        sanitizeMessage(choice.delta);
        if (typeof choice.text === "string") choice.text = stripThinkingAndToolText(choice.text);
      });
    }

    if (typeof payload.text === "string") payload.text = stripThinkingAndToolText(payload.text);
    if (typeof payload.response === "string") payload.response = stripThinkingAndToolText(payload.response);
    if (typeof payload.output === "string") payload.output = stripThinkingAndToolText(payload.output);
    if (Array.isArray(payload.messages)) payload.messages.forEach(sanitizeMessage);

    return payload;
  }

  function looksLikeChatProvider(url) {
    const value = String(url || "").toLowerCase();
    return value.includes("/chat/completions")
      || value.includes("text.pollinations.ai")
      || value.includes("aihorde.net")
      || value.includes("/v1/completions");
  }

  function sanitizeRequestBody(init) {
    if (!init || typeof init.body !== "string") return init;
    try {
      const body = JSON.parse(init.body);
      if (!body || typeof body !== "object") return init;

      // Many free/OpenAI-compatible routes lie about tool support. Keep the app stable
      // by sending normal chat unless the selected provider truly handles tools.
      if (Array.isArray(body.tools) && !body.tool_choice) {
        body.tool_choice = "auto";
      }

      if (Array.isArray(body.messages)) {
        body.messages = body.messages
          .filter((msg) => msg && msg.role !== "tool")
          .map((msg) => ({ ...msg, content: normalizeContent(msg.content || "") }));
      }

      return { ...init, body: JSON.stringify(body) };
    } catch (_) {
      return init;
    }
  }

  function wrapFetch() {
    if (!window.fetch || window.__chatllmRuntimeFixesFetchWrapped) return;
    window.__chatllmRuntimeFixesFetchWrapped = true;
    const originalFetch = window.fetch.bind(window);

    window.fetch = async (input, init = {}) => {
      const url = typeof input === "string" ? input : input?.url;
      const nextInit = looksLikeChatProvider(url) ? sanitizeRequestBody(init) : init;
      const response = await originalFetch(input, nextInit);

      if (!looksLikeChatProvider(url)) return response;
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) return response;

      try {
        const clone = response.clone();
        const payload = sanitizeProviderPayload(await clone.json());
        return new Response(JSON.stringify(payload), {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      } catch (_) {
        return response;
      }
    };
  }

  function sanitizeRenderedMessages(root = document) {
    root.querySelectorAll(".message, .msg, [data-role='assistant'], .assistant").forEach((node) => {
      if (!node || node.__chatllmSanitized) return;
      const before = node.textContent || "";
      const after = stripThinkingAndToolText(before);
      if (after && after !== before && node.children.length === 0) {
        node.textContent = after;
      }
      node.__chatllmSanitized = true;
    });
  }

  function observeRenderedMessages() {
    if (!document.body || window.__chatllmRuntimeFixesObserver) return;
    window.__chatllmRuntimeFixesObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) sanitizeRenderedMessages(node);
        });
      }
    });
    window.__chatllmRuntimeFixesObserver.observe(document.body, { childList: true, subtree: true });
    sanitizeRenderedMessages();
  }

  wrapFetch();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", observeRenderedMessages, { once: true });
  } else {
    observeRenderedMessages();
  }
})();
