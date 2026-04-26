(() => {
  "use strict";

  const THINKING_TAG_RE = /<\/?(?:think|thinking|reasoning|analysis|scratchpad)[^>]*>/gi;
  const THINKING_BLOCK_RE = /<(?:think|thinking|reasoning|analysis|scratchpad)[^>]*>[\s\S]*?<\/(?:think|thinking|reasoning|analysis|scratchpad)>/gi;
  const TOOL_BLOCK_RE = /<(?:tool_call|tool_calls|function_call|tool|tool_result)[^>]*>[\s\S]*?<\/(?:tool_call|tool_calls|function_call|tool|tool_result)>/gi;
  const FENCED_TOOL_JSON_RE = /```(?:json)?\s*\{\s*"(?:tool_calls|tool_call|function_call|arguments|name)"[\s\S]*?```/gi;
  const SLASH_TOOL_RE = /^\s*\/?([a-zA-Z][\w-]*)\s*(\{[\s\S]*\})\s*$/;

  const WEATHER_CODES = {
    0: "Clear", 1: "Mainly clear", 2: "Partly cloudy", 3: "Cloudy",
    45: "Fog", 48: "Freezing fog", 51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle",
    56: "Light freezing drizzle", 57: "Freezing drizzle", 61: "Light rain", 63: "Rain", 65: "Heavy rain",
    66: "Light freezing rain", 67: "Freezing rain", 71: "Light snow", 73: "Snow", 75: "Heavy snow",
    77: "Snow grains", 80: "Light rain showers", 81: "Rain showers", 82: "Heavy rain showers",
    85: "Light snow showers", 86: "Snow showers", 95: "Thunderstorm", 96: "Thunderstorm with hail", 99: "Thunderstorm with heavy hail"
  };

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

    if (/^\{[\s\S]*\}$/.test(text)) {
      try {
        const parsed = JSON.parse(text);
        if (parsed && (parsed.tool_calls || parsed.tool_call || parsed.function_call || parsed.name === "tool_call")) return "";
      } catch (_) {}
    }
    return text;
  }

  function normalizeContent(content) {
    if (Array.isArray(content)) {
      return content.map((part) => {
        if (typeof part === "string") return part;
        if (!part || typeof part !== "object") return "";
        if (typeof part.text === "string") return part.text;
        if (typeof part.content === "string") return part.content;
        return "";
      }).join("\n").trim();
    }
    return content;
  }

  function parseSlashToolCall(text) {
    if (typeof text !== "string") return null;
    const match = text.match(SLASH_TOOL_RE);
    if (!match) return null;
    try {
      return { name: match[1].toLowerCase(), args: JSON.parse(match[2]) };
    } catch (_) {
      return null;
    }
  }

  function extractWeatherPlace(query) {
    const raw = String(query || "").trim();
    if (!raw) return "";
    return raw
      .replace(/\b(weather|forecast|today|right now|current|currently|temperature|temp)\b/gi, "")
      .replace(/\s+/g, " ")
      .replace(/^\s*(in|for|near)\s+/i, "")
      .trim();
  }

  async function answerWeatherQuery(query) {
    const place = extractWeatherPlace(query) || query;
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1&language=en&format=json`;
    const geo = await fetch(geoUrl).then((res) => res.ok ? res.json() : null).catch(() => null);
    const loc = geo?.results?.[0];
    if (!loc) return `I tried to check the weather for ${place}, but I couldn't find that location.`;

    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(loc.latitude)}&longitude=${encodeURIComponent(loc.longitude)}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m,precipitation&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto`;
    const weather = await fetch(weatherUrl).then((res) => res.ok ? res.json() : null).catch(() => null);
    const current = weather?.current;
    if (!current) return `I found ${loc.name}${loc.admin1 ? `, ${loc.admin1}` : ""}, but couldn't load the current weather.`;

    const condition = WEATHER_CODES[current.weather_code] || "Unknown conditions";
    const name = `${loc.name}${loc.admin1 ? `, ${loc.admin1}` : ""}`;
    const temp = Math.round(current.temperature_2m);
    const feels = Math.round(current.apparent_temperature);
    const wind = Math.round(current.wind_speed_10m);
    const humidity = Math.round(current.relative_humidity_2m);
    const precip = Number(current.precipitation || 0);

    return `In ${name}, it's about ${temp}°F and ${condition.toLowerCase()}. Feels like ${feels}°F, wind around ${wind} mph, humidity ${humidity}%, precipitation ${precip.toFixed(2)} in.`;
  }

  async function executeSlashToolCall(call) {
    if (!call) return null;
    const query = call.args?.query || call.args?.q || call.args?.location || "";
    if (call.name === "web" && /weather|forecast|temperature|temp/i.test(String(query))) {
      return answerWeatherQuery(query);
    }
    if (call.name === "web") {
      return `I tried to search the web for “${query || "that"}”, but this browser app can only auto-handle weather tool calls right now.`;
    }
    return `I tried to use the ${call.name} tool, but this model returned the tool call as text instead of running it.`;
  }

  async function sanitizeMessage(message) {
    if (!message || typeof message !== "object") return;

    if (message.role === "assistant" || !message.role) {
      let content = stripThinkingAndToolText(normalizeContent(message.content || ""));
      const slashCall = parseSlashToolCall(content);
      if (slashCall) {
        content = await executeSlashToolCall(slashCall);
      }
      message.content = content;
      delete message.reasoning;
      delete message.reasoning_content;
      delete message.thought;
      delete message.thinking;
      delete message.analysis;

      if (message.tool_calls || message.function_call) {
        const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
        const first = toolCalls[0]?.function || message.function_call;
        delete message.function_call;
        delete message.tool_calls;
        if (!message.content) {
          message.content = first?.name
            ? `I tried to use the ${first.name} tool, but the provider returned only a tool-call payload. Please retry or turn tools off for this model.`
            : "I tried to use a tool, but the provider returned only a tool-call payload. Please retry or turn tools off for this model.";
        }
      }
    }
  }

  async function sanitizeProviderPayload(payload) {
    if (!payload || typeof payload !== "object") return payload;

    if (Array.isArray(payload.choices)) {
      for (const choice of payload.choices) {
        await sanitizeMessage(choice.message);
        await sanitizeMessage(choice.delta);
        if (typeof choice.text === "string") {
          const stripped = stripThinkingAndToolText(choice.text);
          const slashCall = parseSlashToolCall(stripped);
          choice.text = slashCall ? await executeSlashToolCall(slashCall) : stripped;
        }
      }
    }

    for (const key of ["text", "response", "output"]) {
      if (typeof payload[key] === "string") {
        const stripped = stripThinkingAndToolText(payload[key]);
        const slashCall = parseSlashToolCall(stripped);
        payload[key] = slashCall ? await executeSlashToolCall(slashCall) : stripped;
      }
    }
    if (Array.isArray(payload.messages)) {
      for (const message of payload.messages) await sanitizeMessage(message);
    }

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

      if (Array.isArray(body.tools) && !body.tool_choice) body.tool_choice = "auto";
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
        const payload = await sanitizeProviderPayload(await clone.json());
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

  async function replaceRenderedSlashTool(node, text) {
    const call = parseSlashToolCall(text);
    if (!call) return false;
    node.textContent = "Checking...";
    try {
      node.textContent = await executeSlashToolCall(call);
    } catch (_) {
      node.textContent = `I tried to use the ${call.name} tool, but it failed.`;
    }
    return true;
  }

  function sanitizeRenderedMessages(root = document) {
    root.querySelectorAll(".message, .msg, [data-role='assistant'], .assistant").forEach((node) => {
      if (!node || node.__chatllmSanitized) return;
      const before = node.textContent || "";
      const after = stripThinkingAndToolText(before);
      if (parseSlashToolCall(after) && node.children.length === 0) {
        node.__chatllmSanitized = true;
        replaceRenderedSlashTool(node, after);
        return;
      }
      if (after && after !== before && node.children.length === 0) node.textContent = after;
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
