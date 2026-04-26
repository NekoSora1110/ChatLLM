# ChatLLM

ChatLLM is a local static web app in this folder. It stores accounts, chats, agents, settings, memory, canvas docs, and sandbox files in your browser storage.

## Run

```bash
cd ~/Downloads/ChatLLM
python3 -m http.server 8765
```

Open `http://127.0.0.1:8765`.

## What works without keys

- Local account creation and auto-login on this browser profile.
- Chat through Pollinations' no-key `text.pollinations.ai/openai` route using the anonymous `openai-fast` model.
- Model store discovery for Pollinations and AI Horde.
- Local memory, agents, canvas mode, tool toggles, research workspace, and the browser sandbox.
- Public-source search through APIs such as Wikipedia, Hacker News, GitHub, and npm.
- URL reading through Jina Reader's no-key reader endpoint when available.

## Optional provider keys

Settings > Providers supports:

- Pollinations key for the newer full model list.
- AI Horde key for better queue/kudos behavior.
- Jina key for Jina search.
- Any custom OpenAI-compatible endpoint, including local servers such as Ollama/vLLM/LM Studio or hosted endpoints that expose Kimi, Qwen, Llama, DeepSeek, GLM, and similar models.

## Honest limits

A static browser app cannot truly access every open-source model online for free. It can call free public endpoints while they allow it, run small browser-local models when WebGPU is available, or connect to a provider/server you configure.

The sandbox is a browser-isolated virtual shell with JavaScript execution and virtual files. It is not a real Linux VM unless you connect ChatLLM to a remote sandbox service through a custom backend.
