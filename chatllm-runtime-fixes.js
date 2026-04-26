(() => {
  "use strict";

  const THINKING_TAG_RE = /<\/?(?:think|thinking|reasoning|analysis|scratchpad)[^>]*>/gi;
  const THINKING_BLOCK_RE = /<(?:think|thinking|reasoning|analysis|scratchpad)[^>]*>[\s\S]*?<\/(?:think|thinking|reasoning|analysis|scratchpad)>/gi;
  const TOOL_BLOCK_RE = /<(?:tool_call|tool_calls|function_call|tool|tool_result)[^>]*>[\s\S]*?<\/(?:tool_call|tool_calls|function_call|tool|tool_result)>/gi;
  const FENCED_TOOL_JSON_RE = /```(?:json)?\s*\{\s*"(?:tool_calls|tool_call|function_call|arguments|name)"[\s\S]*?```/gi;
  const POLLINATIONS_FOOTER_RE = /\n?\s*-{3,}\s*\n+\s*Support Pollinations\.AI:[\s\S]*$/i;
  const POLLINATIONS_AD_RE = /\n?\s*🌸\s*Ad\s*🌸[\s\S]*?(?:accessible for everyone\.|$)/gi;
  const WEATHER_ERROR_RE = /\b(?:502|bad gateway|weather api|couldn['’]?t return data|try again a bit later)\b/i;
  const TOOL_PAYLOAD_ERROR_RE = /provider returned only a tool-call payload|retry or turn tools off/i;
  const WTTR_URL_RE = /https?:\/\/wttr\.in\/([^\s)]+)(?:\?[^\s)]*)?/i;
  const SLASH_TOOL_RE = /^\s*\/?([a-zA-Z][\w-]*)\s*(\{[\s\S]*\})\s*$/;

  const WEATHER_CODES = {
    0: "Clear", 1: "Mainly clear", 2: "Partly cloudy", 3: "Cloudy",
    45: "Fog", 48: "Freezing fog", 51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle",
    56: "Light freezing drizzle", 57: "Freezing drizzle", 61: "Light rain", 63: "Rain", 65: "Heavy rain",
    66: "Light freezing rain", 67: "Freezing rain", 71: "Light snow", 73: "Snow", 75: "Heavy snow",
    77: "Snow grains", 80: "Light rain showers", 81: "Rain showers", 82: "Heavy rain showers",
    85: "Light snow showers", 86: "Snow showers", 95: "Thunderstorm", 96: "Thunderstorm with hail", 99: "Thunderstorm with heavy hail"
  };

  function stripProviderNoise(value) {
    if (typeof value !== "string") return value;
    return value
      .replace(POLLINATIONS_FOOTER_RE, "")
      .replace(POLLINATIONS_AD_RE, "")
      .trim();
  }

  function stripThinkingAndToolText(value) {
    if (typeof value !== "string") return value;
    let text = stripProviderNoise(value)
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
    return typeof content === "string" ? content : "";
  }

  function parseJsonMaybe(value) {
    if (!value) return {};
    if (typeof value === "object") return value;
    try { return JSON.parse(value); } catch (_) { return {}; }
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

  function normalizeToolName(name) {
    return String(name || "").toLowerCase().replace(/^functions?\./, "").replace(/_/g, "-");
  }

  function getLastUserText(body) {
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i]?.role === "user") return normalizeContent(messages[i].content || "");
    }
    return "";
  }

  function isWeatherQuery(text) {
    const value = String(text || "");
    return /\b(weather|forecast|temperature|temp|how hot|how cold|rain|snow)\b/i.test(value)
      && /\b(in|near|for|at|today|tomorrow|right now|current|hamburg|nj|new jersey)\b/i.test(value);
  }

  function extractWeatherPlace(query) {
    const raw = String(query || "").trim();
    if (!raw) return "";
    const cleaned = raw
      .replace(/what(?:'s| is)?\s+the\s+/i, "")
      .replace(/how\s+(?:hot|cold)\s+(?:is|will)\s+it\s+(?:be\s+)?/i, "")
      .replace(/\b(weather|forecast|today|tomorrow|right now|current|currently|temperature|temp|rain|snow)\b/gi, "")
      .replace(/\s+/g, " ")
      .replace(/^\s*(in|for|near|at)\s+/i, "")
      .replace(/[?.!]+$/g, "")
      .trim();
    return cleaned || raw;
  }

  function extractPlaceFromWeatherError(text) {
    if (!WEATHER_ERROR_RE.test(String(text || ""))) return "";
    const wttrMatch = String(text).match(WTTR_URL_RE);
    if (wttrMatch?.[1]) {
      return decodeURIComponent(wttrMatch[1]).replace(/,/g, ", ").replace(/\+/g, " ").trim();
    }
    const queryMatch = String(text).match(/weather\s+(?:in|for)\s+([^.?\n]+)/i);
    return queryMatch?.[1]?.trim() || "";
  }

  async function fetchJsonWithTimeout(url, timeoutMs = 7500) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal, cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async function getOpenMeteoWeather(place) {
    const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(place)}&count=1&language=en&format=json`;
    const geo = await fetchJsonWithTimeout(geoUrl);
    const loc = geo?.results?.[0];
    if (!loc) throw new Error("Location not found");

    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(loc.latitude)}&longitude=${encodeURIComponent(loc.longitude)}&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m,precipitation&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto`;
    const weather = await fetchJsonWithTimeout(weatherUrl);
    const current = weather?.current;
    if (!current) throw new Error("Current weather unavailable");

    const condition = WEATHER_CODES[current.weather_code] || "Unknown conditions";
    const name = `${loc.name}${loc.admin1 ? `, ${loc.admin1}` : ""}`;
    const temp = Math.round(current.temperature_2m);
    const feels = Math.round(current.apparent_temperature);
    const wind = Math.round(current.wind_speed_10m);
    const humidity = Math.round(current.relative_humidity_2m);
    const precip = Number(current.precipitation || 0);

    return `In ${name}, it's about ${temp}°F and ${condition.toLowerCase()}. Feels like ${feels}°F, wind around ${wind} mph, humidity ${humidity}%, precipitation ${precip.toFixed(2)} in.`;
  }

  async function getWttrWeather(place) {
    const clean = place || "Hamburg, NJ";
    const wttrUrl = `https://wttr.in/${encodeURIComponent(clean)}?format=j1`;
    const data = await fetchJsonWithTimeout(wttrUrl, 9000);
    const current = data?.current_condition?.[0];
    if (!current) throw new Error("wttr current weather unavailable");

    const area = data?.nearest_area?.[0];
    const name = [area?.areaName?.[0]?.value || clean, area?.region?.[0]?.value].filter(Boolean).join(", ");
    const condition = current.weatherDesc?.[0]?.value || "unknown conditions";
    const temp = Math.round(Number(current.temp_F));
    const feels = Math.round(Number(current.FeelsLikeF));
    const wind = Math.round(Number(current.windspeedMiles));
    const humidity = Math.round(Number(current.humidity));
    const precip = Number(current.precipInches || 0);

    return `In ${name}, it's about ${temp}°F and ${condition.toLowerCase()}. Feels like ${feels}°F, wind around ${wind} mph, humidity ${humidity}%, precipitation ${precip.toFixed(2)} in.`;
  }

  async function answerWeatherQuery(query) {
    const place = extractWeatherPlace(query) || query || "Hamburg, NJ";
    try {
      return await getOpenMeteoWeather(place);
    } catch (_) {
      try {
        return await getWttrWeather(place);
      } catch (_) {
        return `I tried to check the weather for ${place}, but both weather sources failed. Try again in a bit.`;
      }
    }
  }

  async function answerSimpleWebSearch(query) {
    const q = String(query || "").trim();
    if (!q) return "I need a search query for that.";
    if (isWeatherQuery(q)) return answerWeatherQuery(q);
    try {
      const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(q)}`;
      const data = await fetchJsonWithTimeout(url, 7000);
      if (data?.extract) return `${data.extract}${data.content_urls?.desktop?.page ? `\n\nSource: ${data.content_urls.desktop.page}` : ""}`;
    } catch (_) {}
    return `I can't run a full web search in this static app yet, but the search query was: ${q}`;
  }

  async function executeLocalToolCall(rawCall) {
    if (!rawCall) return "";
    const fn = rawCall.function || rawCall;
    const name = normalizeToolName(fn.name || rawCall.name || rawCall.type);
    const args = parseJsonMaybe(fn.arguments || rawCall.arguments || rawCall.args || rawCall.input);
    const query = args.query || args.q || args.location || args.city || args.prompt || "";

    if (["web", "search", "web-search", "browser-search", "search-web"].includes(name)) {
      return answerSimpleWebSearch(query);
    }
    if (["weather", "get-weather", "current-weather"].includes(name)) {
      return answerWeatherQuery(query || args.place || args.city || "Hamburg, NJ");
    }
    return `The model tried to use the ${fn.name || rawCall.name || "unknown"} tool, but ChatLLM cannot run that tool locally yet.`;
  }

  async function executeSlashToolCall(call) {
    if (!call) return null;
    const query = call.args?.query || call.args?.q || call.args?.location || "";
    return executeLocalToolCall({ name: call.name, arguments: call.args || { query } });
  }

  async function sanitizeAssistantText(text) {
    let content = stripThinkingAndToolText(normalizeContent(text || ""));
    const slashCall = parseSlashToolCall(content);
    if (slashCall) return executeSlashToolCall(slashCall);
    const weatherPlace = extractPlaceFromWeatherError(content);
    if (weatherPlace) return answerWeatherQuery(weatherPlace);
    if (TOOL_PAYLOAD_ERROR_RE.test(content)) {
      return "That model tried to use a tool but did not return a normal answer. I stopped showing the raw tool error; try asking again, or use a model/provider with reliable tool support.";
    }
    return content;
  }

  async function sanitizeMessage(message) {
    if (!message || typeof message !== "object") return;

    if (message.role === "assistant" || !message.role) {
      message.content = await sanitizeAssistantText(message.content || "");
      delete message.reasoning;
      delete message.reasoning_content;
      delete message.thought;
      delete message.thinking;
      delete message.analysis;

      if (message.tool_calls || message.function_call) {
        const toolCalls = Array.isArray(message.tool_calls) ? message.tool_calls : [];
        const first = toolCalls[0] || message.function_call;
        delete message.function_call;
        delete message.tool_calls;
        if (!message.content) {
          message.content = await executeLocalToolCall(first);
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
        if (typeof choice.text === "string") choice.text = await sanitizeAssistantText(choice.text);
      }
    }

    for (const key of ["text", "response", "output"]) {
      if (typeof payload[key] === "string") payload[key] = await sanitizeAssistantText(payload[key]);
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

  function buildChatCompletionResponse(content, model = "chatllm-local-tool") {
    return new Response(JSON.stringify({
      id: `chatllm-local-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content } }]
    }), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
    });
  }

  async function maybeHandleBeforeProvider(url, body) {
    const lastUserText = getLastUserText(body);
    if (isWeatherQuery(lastUserText)) {
      const answer = await answerWeatherQuery(lastUserText);
      return buildChatCompletionResponse(answer, body?.model || "chatllm-weather");
    }
    return null;
  }

  function sanitizeRequestBody(init, url) {
    if (!init || typeof init.body !== "string") return { init, body: null };
    try {
      const body = JSON.parse(init.body);
      if (!body || typeof body !== "object") return { init, body: null };

      // The public/free providers used by this static app often return raw tool payloads.
      // Strip native tool schemas and let ChatLLM handle obvious local tools itself.
      delete body.tools;
      delete body.tool_choice;
      delete body.functions;
      delete body.function_call;

      const noToolsInstruction = "Do not output raw tool calls, JSON tool payloads, /web commands, function_call, or hidden reasoning. If you cannot access current data, say so normally.";
      if (Array.isArray(body.messages)) {
        body.messages = body.messages
          .filter((msg) => msg && msg.role !== "tool")
          .map((msg) => ({ ...msg, content: normalizeContent(msg.content || "") }));
        const first = body.messages[0];
        if (first?.role === "system") {
          first.content = `${first.content}\n\n${noToolsInstruction}`;
        } else {
          body.messages.unshift({ role: "system", content: noToolsInstruction });
        }
      }

      return { init: { ...init, body: JSON.stringify(body) }, body };
    } catch (_) {
      return { init, body: null };
    }
  }

  function wrapFetch() {
    if (!window.fetch || window.__chatllmRuntimeFixesFetchWrapped) return;
    window.__chatllmRuntimeFixesFetchWrapped = true;
    const originalFetch = window.fetch.bind(window);

    window.fetch = async (input, init = {}) => {
      const url = typeof input === "string" ? input : input?.url;
      const isChat = looksLikeChatProvider(url);
      const sanitized = isChat ? sanitizeRequestBody(init, url) : { init, body: null };

      if (isChat) {
        const localResponse = await maybeHandleBeforeProvider(url, sanitized.body);
        if (localResponse) return localResponse;
      }

      const response = await originalFetch(input, sanitized.init);

      if (!isChat) return response;
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

  async function replaceRenderedWeatherOrTool(node, text) {
    const slashCall = parseSlashToolCall(text);
    const weatherPlace = extractPlaceFromWeatherError(text);
    if (!slashCall && !weatherPlace && !TOOL_PAYLOAD_ERROR_RE.test(text)) return false;
    node.textContent = slashCall || weatherPlace ? "Checking weather..." : "Tool call failed.";
    try {
      if (slashCall) node.textContent = await executeSlashToolCall(slashCall);
      else if (weatherPlace) node.textContent = await answerWeatherQuery(weatherPlace);
      else node.textContent = "That provider returned a tool call instead of a normal answer. I disabled native tool schemas for future requests.";
    } catch (_) {
      node.textContent = "I tried to run that tool locally, but it failed.";
    }
    return true;
  }

  function sanitizeRenderedMessages(root = document) {
    root.querySelectorAll(".message, .msg, [data-role='assistant'], .assistant").forEach((node) => {
      if (!node || node.__chatllmSanitized) return;
      const before = node.textContent || "";
      const after = stripThinkingAndToolText(before);
      if ((parseSlashToolCall(after) || extractPlaceFromWeatherError(after) || TOOL_PAYLOAD_ERROR_RE.test(after)) && node.children.length === 0) {
        node.__chatllmSanitized = true;
        replaceRenderedWeatherOrTool(node, after);
        return;
      }
      if (after !== before && node.children.length === 0) node.textContent = after;
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
