# LiteLLM ClawRouter 🦞⚡

Smart LLM router for [OpenClaw](https://github.com/openclaw/openclaw) → [LiteLLM](https://github.com/BerriAI/litellm).

**Save 78%+ on inference costs** with automatic request routing.

```
"What is 2+2?"              → gemini-flash     saved 99%
"Summarize this article"    → deepseek-chat    saved 99%
"Build a React component"   → claude-sonnet    best balance
"Prove this theorem"        → deepseek-reasoner reasoning
```

## Quick Start

```bash
# Install
npm install -g litellm-clawrouter

# Run setup wizard
litellm-clawrouter

# That's it! OpenClaw now auto-routes through LiteLLM
```

## How It Works

LiteLLM ClawRouter runs a local proxy that:

1. **Analyzes each request** using 14-dimension weighted scoring
2. **Selects the optimal model tier** based on complexity
3. **Routes to LiteLLM** which handles the actual API call

All routing happens locally in <1ms — no external API calls.

### Routing Tiers

| Tier | Default Model | Use Case | Savings |
|------|--------------|----------|---------|
| SIMPLE | gemini-flash | Q&A, translations | 99% |
| MEDIUM | deepseek-chat | General tasks | 99% |
| COMPLEX | claude-sonnet | Complex coding | 80% |
| REASONING | deepseek-reasoner | Step-by-step | 99% |

### 14-Dimension Scoring

| Dimension | Weight | Detects |
|-----------|--------|---------|
| Reasoning markers | 0.18 | "prove", "theorem", "step by step" |
| Code presence | 0.15 | functions, imports, SQL |
| Simple indicators | 0.12 | "what is", "define", "translate" |
| Multi-step patterns | 0.12 | "first...then", numbered lists |
| Technical terms | 0.10 | kubernetes, algorithms, APIs |
| Token count | 0.08 | short vs long prompts |
| Creative markers | 0.05 | "story", "brainstorm" |
| ... and 7 more | | |

## Commands

```bash
# Setup wizard (interactive)
litellm-clawrouter

# Start the routing proxy
litellm-clawrouter start

# Stop the proxy
litellm-clawrouter stop

# Check status
litellm-clawrouter status

# Test routing for a message
litellm-clawrouter test "What is 2+2?"
litellm-clawrouter test "Prove sqrt(2) is irrational step by step"
```

## Configuration

After setup, config is stored at:
- `~/.openclaw/litellm-clawrouter/config.json` — Router settings
- `~/.openclaw/openclaw.json` — OpenClaw integration

### Custom Tier Models

During setup, you can customize which models handle each tier:

```
SIMPLE    [gemini/gemini-2.0-flash]: openai/gpt-4o-mini
MEDIUM    [deepseek/deepseek-chat]: 
COMPLEX   [anthropic/claude-sonnet-4]: anthropic/claude-opus-4
REASONING [deepseek/deepseek-reasoner]: openai/o1
```

## Programmatic Usage

Use the router directly in your code:

```javascript
const { route, estimateSavings } = require('litellm-clawrouter');

const decision = route("Prove sqrt(2) is irrational");
console.log(decision);
// {
//   tier: 'REASONING',
//   model: 'deepseek/deepseek-reasoner',
//   confidence: 0.97,
//   method: 'rules'
// }

const savings = estimateSavings(decision.model);
console.log(`Savings: ${(savings * 100).toFixed(0)}%`);
// Savings: 99%
```

### Start Proxy Programmatically

```javascript
const { startProxy } = require('litellm-clawrouter/proxy');

const proxy = await startProxy({
  litellmBaseUrl: 'http://localhost:4000',
  litellmApiKey: 'sk-...',
  onRouted: (d) => console.log(`[${d.tier}] ${d.routedModel}`),
});

// Use proxy.baseUrl with any OpenAI-compatible client
// Model: "auto" or "litellm-clawrouter/auto"
```

## Why LiteLLM ClawRouter?

### vs Raw LiteLLM
LiteLLM gives you access to 100+ models. ClawRouter adds **intelligent routing** to automatically pick the best model for each request.

### vs OpenRouter
OpenRouter's routing is proprietary. ClawRouter is **open source and runs locally** — you can inspect and customize the routing logic.

### Cost Example

| Request Type | % of Traffic | Without Router | With Router |
|--------------|--------------|----------------|-------------|
| Simple Q&A | 45% | $75/M (Opus) | $0.27/M |
| General | 35% | $75/M (Opus) | $0.42/M |
| Complex | 15% | $75/M (Opus) | $15/M |
| Reasoning | 5% | $75/M (Opus) | $0.55/M |
| **Blended** | | **$75/M** | **$3.17/M** |

**96% savings** on a typical workload.

## Prerequisites

- [OpenClaw](https://docs.openclaw.ai) installed
- [LiteLLM Proxy](https://docs.litellm.ai/docs/proxy/quick_start) running
- Node.js 18+

## Troubleshooting

### "Proxy is not running"
```bash
litellm-clawrouter start
```

### "Could not connect to LiteLLM"
- Verify LiteLLM proxy is running
- Check the base URL (include port: `http://localhost:4000`)
- Verify API key is valid

### Port conflict
Default port is 8401. Set a custom port:
```bash
export LITELLM_CLAWROUTER_PORT=8402
litellm-clawrouter start
```

## Links

- [LiteLLM Docs](https://docs.litellm.ai)
- [OpenClaw Docs](https://docs.openclaw.ai)
- [GitHub Issues](https://github.com/BerriAI/litellm-clawrouter/issues)

## License

MIT — [BerriAI](https://github.com/BerriAI)
