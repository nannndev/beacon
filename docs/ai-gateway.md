# AI Gateway

Beacon runs a local AI gateway: one endpoint that speaks both the OpenAI and the Anthropic API, in front of every LLM provider you connect. Point Claude Code, Cursor, the OpenAI or Anthropic SDKs, or your own scripts at Beacon, and it forwards each request to the right provider.

Open it from the sidebar (**AI Gateway**) or the command palette.

## Set it up

1. **Connect a provider.** Pick OpenAI, Anthropic, DeepSeek, OpenRouter, Groq, Mistral, Together AI, Ollama, or any OpenAI-compatible server (**Custom**). Enter the API key and, if needed, a base URL. Beacon calls the provider's model list first and only saves the provider if that call succeeds.
2. **Create a gateway key.** Each tool gets its own `gw-sk-…` key. Beacon shows the full key once; copy it then.
3. **Point your client at Beacon.** Copy the base URLs from the **Connect a client** card.

```bash
# OpenAI SDK or any OpenAI-compatible tool
OPENAI_BASE_URL=http://127.0.0.1:<port>/gateway/v1
OPENAI_API_KEY=gw-sk-…

# Anthropic SDK or Claude Code
ANTHROPIC_BASE_URL=http://127.0.0.1:<port>/gateway
ANTHROPIC_API_KEY=gw-sk-…

curl $OPENAI_BASE_URL/chat/completions \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"oa/gpt-4o","messages":[{"role":"user","content":"hi"}]}'
```

The desktop app picks a free port each time it starts, so copy the base URLs again after a restart.

## Endpoints

| Method | Path | Format |
|---|---|---|
| `POST` | `/gateway/v1/chat/completions` | OpenAI Chat Completions (JSON or streaming) |
| `POST` | `/gateway/v1/messages` | Anthropic Messages (JSON or streaming) |
| `GET` | `/gateway/v1/models` | Every model of every connected provider, plus your combos |
| `GET` | `/gateway/health` | `{ "status": "ok" }`, no key needed |

Paths without `/v1` and with a doubled `/v1/v1` also work. The key is read from `Authorization: Bearer` or `x-api-key`. Errors come back in the format of the endpoint you called, so SDKs can parse them.

`/v1/messages` passes the body straight through to Anthropic, so tools, images, thinking, and prompt caching work unchanged. It only accepts Anthropic targets; use `/v1/chat/completions` for every other provider. `/v1/chat/completions` works with every provider and translates to and from Anthropic when needed.

## Choosing a model

The `model` field picks the provider:

| Model | Meaning |
|---|---|
| `oa/gpt-4o` | A provider alias, then the provider's own model name |
| `auto/fast` | A fallback combo you defined |
| `gpt-4o` | A plain name: Beacon guesses the provider from the name |

Aliases: `oa` OpenAI, `an` Anthropic, `ds` DeepSeek, `or` OpenRouter, `gq` Groq, `mi` Mistral, `tg` Together AI, `ol` Ollama, `cu` Custom.

## Fallback combos

A combo is an ordered list of models, for example `auto/fast` → `oa/gpt-4o`, then `ds/deepseek-chat`. Beacon tries each in turn and moves on when a provider answers 429, 401, 403, a 5xx, or cannot be reached. A bad request (400, 404, 413, 422) does not fall back, because the next provider would reject it too. Once a streamed answer has started, Beacon cannot switch providers.

After a 429, that provider is tried last until its cooldown ends (from `Retry-After`, or 5 minutes).

## Testing the gateway in Beacon

After you create a key, **Add a test request to this project** adds a ready-to-send `AI gateway chat completion` request with two assertions. The key goes into the private environment variable `gateway_api_key`, so it stays out of shared project files. From there you can send it, chain it, or load-test it like any other request.

## Security

- Only local and LAN clients are accepted. Requests from public IP addresses get 403.
- Gateway keys are stored only as SHA-256 hashes. Provider API keys are encrypted at rest (AES-256-GCM) and shown masked.
- A gateway key cannot reach Beacon's own settings.
- Beacon logs model, status, token counts, and timing for each request, never the prompt or the response.
