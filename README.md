# LiteLLM ClawRouter 🦞⚡

One command to route [OpenClaw](https://github.com/openclaw/openclaw) through [LiteLLM Proxy](https://github.com/BerriAI/litellm).

## Why?

OpenClaw is a powerful AI assistant that runs on your machine. LiteLLM is a unified API gateway that lets you call 100+ LLMs through one interface.

**LiteLLM ClawRouter** = OpenClaw + LiteLLM in seconds.

## Quick Start

```bash
# Install
npm install -g litellm-clawrouter

# Run the setup wizard
litellm-clawrouter
```

That's it! The wizard will:
1. Ask for your LiteLLM proxy URL and API key
2. Test the connection
3. Let you pick a default model
4. Configure OpenClaw automatically
5. Restart the Gateway (optional)

## Prerequisites

- [OpenClaw](https://docs.openclaw.ai) installed (`openclaw` in PATH)
- [LiteLLM Proxy](https://docs.litellm.ai/docs/proxy/quick_start) running somewhere
- Node.js 18+

## What it configures

The tool adds a `litellm` provider to your OpenClaw config:

```json5
{
  models: {
    mode: "merge",  // Keep existing providers as fallbacks
    providers: {
      litellm: {
        baseUrl: "http://your-proxy:4000/v1",
        apiKey: "your-key",
        api: "openai-responses",
        models: [{ id: "gpt-4o", ... }]
      }
    }
  },
  agents: {
    defaults: {
      model: { primary: "litellm/gpt-4o" }
    }
  }
}
```

## Manual Setup

If you prefer to configure manually:

1. Edit `~/.openclaw/openclaw.json`
2. Add the provider config above
3. Run `openclaw gateway restart`

## Benefits

- **100+ Models**: Access OpenAI, Anthropic, Azure, Bedrock, Vertex, and more through one interface
- **Cost Tracking**: LiteLLM tracks usage and costs across all providers
- **Load Balancing**: Distribute requests across multiple API keys/endpoints
- **Fallbacks**: Automatic failover between providers
- **Caching**: Optional semantic caching to reduce costs

## Troubleshooting

### "OpenClaw not found"
Make sure OpenClaw is installed and `openclaw` is in your PATH.

### "Could not connect to LiteLLM"
- Check your LiteLLM proxy is running
- Verify the URL is correct (include port, e.g., `http://localhost:4000`)
- Ensure your API key is valid

### "Gateway restart failed"
The Gateway may not be running. Start it with:
```bash
openclaw gateway start
```

## Links

- [LiteLLM Docs](https://docs.litellm.ai)
- [OpenClaw Docs](https://docs.openclaw.ai)
- [GitHub Issues](https://github.com/BerriAI/litellm-clawrouter/issues)

## License

MIT
