#!/usr/bin/env node

const { spawn, execSync } = require('child_process');
const readline = require('readline');
const path = require('path');
const fs = require('fs');
const os = require('os');

const OPENCLAW_CONFIG_PATH = path.join(os.homedir(), '.openclaw', 'openclaw.json');
const CLAWROUTER_CONFIG_PATH = path.join(os.homedir(), '.openclaw', 'litellm-clawrouter', 'config.json');
const DEFAULT_PROXY_PORT = 8401;

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
};

function log(msg) { console.log(msg); }
function success(msg) { console.log(`${colors.green}✓${colors.reset} ${msg}`); }
function info(msg) { console.log(`${colors.blue}ℹ${colors.reset} ${msg}`); }
function warn(msg) { console.log(`${colors.yellow}⚠${colors.reset} ${msg}`); }
function error(msg) { console.log(`${colors.red}✗${colors.reset} ${msg}`); }

function banner() {
  console.log(`
${colors.cyan}╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   ${colors.bright}LiteLLM ClawRouter${colors.reset}${colors.cyan}                                    ║
║   Smart routing for OpenClaw → LiteLLM                    ║
║                                                           ║
║   ${colors.dim}Save 78%+ on inference costs with auto-routing${colors.reset}${colors.cyan}        ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝${colors.reset}
`);
}

async function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function promptSecret(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    stdin.setRawMode && stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let input = '';
    const onData = (char) => {
      if (char === '\n' || char === '\r') {
        stdin.removeListener('data', onData);
        stdin.setRawMode && stdin.setRawMode(wasRaw);
        stdin.pause();
        process.stdout.write('\n');
        resolve(input);
      } else if (char === '\x03') {
        process.exit(1);
      } else if (char === '\x7f' || char === '\b') {
        if (input.length > 0) {
          input = input.slice(0, -1);
          process.stdout.write('\b \b');
        }
      } else {
        input += char;
        process.stdout.write('*');
      }
    };
    stdin.on('data', onData);
  });
}

function checkOpenClaw() {
  try {
    execSync('which openclaw', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function getOpenClawConfig() {
  try {
    if (fs.existsSync(OPENCLAW_CONFIG_PATH)) {
      const content = fs.readFileSync(OPENCLAW_CONFIG_PATH, 'utf8');
      const cleaned = content
        .replace(/\/\/.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/,(\s*[}\]])/g, '$1');
      return JSON.parse(cleaned);
    }
  } catch (e) {
    warn(`Could not parse existing config: ${e.message}`);
  }
  return {};
}

function saveClawRouterConfig(config) {
  const dir = path.dirname(CLAWROUTER_CONFIG_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(CLAWROUTER_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

function getClawRouterConfig() {
  try {
    if (fs.existsSync(CLAWROUTER_CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CLAWROUTER_CONFIG_PATH, 'utf8'));
    }
  } catch {}
  return null;
}

// Default tier models for auto-routing
const DEFAULT_TIER_MODELS = {
  SIMPLE: 'gemini/gemini-2.0-flash',
  MEDIUM: 'deepseek/deepseek-chat',
  COMPLEX: 'anthropic/claude-sonnet-4',
  REASONING: 'deepseek/deepseek-reasoner',
};

function generateConfig(apiKey, baseUrl, tierModels, proxyPort) {
  return {
    models: {
      mode: "merge",
      providers: {
        "litellm-clawrouter": {
          baseUrl: `http://localhost:${proxyPort}/v1`,
          apiKey: "local-proxy",
          api: "openai-responses",
          models: [
            {
              id: "auto",
              name: "Auto (Smart Routing)",
              reasoning: false,
              input: ["text", "image"],
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
              contextWindow: 128000,
              maxTokens: 16384,
            }
          ]
        }
      }
    },
    agents: {
      defaults: {
        model: {
          primary: "litellm-clawrouter/auto"
        }
      }
    }
  };
}

function mergeConfig(existing, litellmConfig) {
  const merged = { ...existing };
  if (!merged.models) merged.models = {};
  if (!merged.models.providers) merged.models.providers = {};
  merged.models.mode = "merge";
  merged.models.providers["litellm-clawrouter"] = litellmConfig.models.providers["litellm-clawrouter"];
  if (!merged.agents) merged.agents = {};
  if (!merged.agents.defaults) merged.agents.defaults = {};
  merged.agents.defaults.model = litellmConfig.agents.defaults.model;
  return merged;
}

async function testConnection(baseUrl, apiKey) {
  info('Testing connection to LiteLLM proxy...');
  const url = baseUrl.replace(/\/$/, '') + '/v1/models';
  try {
    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10000),
    });
    if (response.ok) {
      const data = await response.json();
      success(`Connected! Found ${data.data?.length || 0} models available.`);
      return data.data?.map(m => m.id) || [];
    } else {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text}`);
    }
  } catch (e) {
    if (e.name === 'TimeoutError') {
      throw new Error('Connection timed out after 10s');
    }
    throw e;
  }
}

async function run() {
  const args = process.argv.slice(2);
  
  // Handle subcommands
  if (args[0] === 'start') {
    return startProxy();
  }
  if (args[0] === 'stop') {
    return stopProxy();
  }
  if (args[0] === 'status') {
    return showStatus();
  }
  if (args[0] === 'test') {
    return testRouting(args[1]);
  }
  if (args[0] === '--help' || args[0] === '-h') {
    return showHelp();
  }

  // Default: setup wizard
  await setupWizard();
}

function showHelp() {
  log(`
${colors.bright}LiteLLM ClawRouter${colors.reset} — Smart routing for OpenClaw → LiteLLM

${colors.cyan}USAGE${colors.reset}
  litellm-clawrouter              Run setup wizard
  litellm-clawrouter start        Start the routing proxy
  litellm-clawrouter stop         Stop the routing proxy
  litellm-clawrouter status       Show proxy status
  litellm-clawrouter test <msg>   Test routing for a message

${colors.cyan}HOW IT WORKS${colors.reset}
  1. Run the setup wizard to configure LiteLLM connection
  2. Proxy starts automatically and routes requests:
     
     ${colors.dim}SIMPLE${colors.reset}    → gemini-flash     (save 99%)
     ${colors.dim}MEDIUM${colors.reset}    → deepseek-chat    (save 99%)
     ${colors.dim}COMPLEX${colors.reset}   → claude-sonnet    (best balance)
     ${colors.dim}REASONING${colors.reset} → deepseek-reasoner (step-by-step)

${colors.cyan}EXAMPLE${colors.reset}
  # Test routing
  litellm-clawrouter test "What is 2+2?"
  # → SIMPLE tier, gemini-flash

  litellm-clawrouter test "Prove sqrt(2) is irrational step by step"
  # → REASONING tier, deepseek-reasoner
`);
}

async function setupWizard() {
  banner();
  
  if (!checkOpenClaw()) {
    error('OpenClaw not found in PATH.');
    info('Install OpenClaw first: https://docs.openclaw.ai');
    process.exit(1);
  }
  success('OpenClaw detected');
  
  log('');
  info('Enter your LiteLLM proxy details:');
  log('');
  
  const baseUrl = await prompt(`${colors.cyan}LiteLLM Base URL${colors.reset} (e.g., http://localhost:4000): `);
  if (!baseUrl) {
    error('Base URL is required');
    process.exit(1);
  }
  
  const apiKey = await promptSecret(`${colors.cyan}LiteLLM API Key${colors.reset}: `);
  if (!apiKey) {
    error('API Key is required');
    process.exit(1);
  }
  
  log('');
  let availableModels = [];
  try {
    availableModels = await testConnection(baseUrl, apiKey);
  } catch (e) {
    warn(`Could not connect to LiteLLM: ${e.message}`);
    const proceed = await prompt('Continue anyway? (y/N): ');
    if (proceed.toLowerCase() !== 'y') {
      process.exit(1);
    }
  }
  
  // Configure tier models
  log('');
  info('Configure model tiers for auto-routing:');
  log(`${colors.dim}  Press Enter to use defaults, or type a model name${colors.reset}`);
  log('');
  
  const tierModels = { ...DEFAULT_TIER_MODELS };
  
  for (const [tier, defaultModel] of Object.entries(DEFAULT_TIER_MODELS)) {
    const tierColor = tier === 'SIMPLE' ? colors.green : 
                      tier === 'MEDIUM' ? colors.yellow :
                      tier === 'COMPLEX' ? colors.red : colors.magenta;
    const input = await prompt(`  ${tierColor}${tier}${colors.reset} [${defaultModel}]: `);
    if (input) {
      tierModels[tier] = input;
    }
  }
  
  // Save ClawRouter config
  log('');
  info('Saving configuration...');
  
  const proxyPort = DEFAULT_PROXY_PORT;
  const clawRouterConfig = {
    litellmBaseUrl: baseUrl,
    litellmApiKey: apiKey,
    proxyPort,
    tierModels,
    createdAt: new Date().toISOString(),
  };
  saveClawRouterConfig(clawRouterConfig);
  success(`Saved to: ${CLAWROUTER_CONFIG_PATH}`);
  
  // Update OpenClaw config
  info('Updating OpenClaw configuration...');
  
  const existingConfig = getOpenClawConfig();
  const openclawConfig = generateConfig(apiKey, baseUrl, tierModels, proxyPort);
  const mergedConfig = mergeConfig(existingConfig, openclawConfig);
  
  const configDir = path.dirname(OPENCLAW_CONFIG_PATH);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  
  if (fs.existsSync(OPENCLAW_CONFIG_PATH)) {
    const backupPath = OPENCLAW_CONFIG_PATH + '.backup.' + Date.now();
    fs.copyFileSync(OPENCLAW_CONFIG_PATH, backupPath);
    info(`Backup saved to: ${backupPath}`);
  }
  
  fs.writeFileSync(OPENCLAW_CONFIG_PATH, JSON.stringify(mergedConfig, null, 2), 'utf8');
  success(`OpenClaw config updated: ${OPENCLAW_CONFIG_PATH}`);
  
  // Start proxy
  log('');
  const startNow = await prompt('Start the routing proxy now? (Y/n): ');
  if (startNow.toLowerCase() !== 'n') {
    await startProxy();
  }
  
  // Restart OpenClaw
  log('');
  const restart = await prompt('Restart OpenClaw Gateway? (Y/n): ');
  if (restart.toLowerCase() !== 'n') {
    info('Restarting OpenClaw Gateway...');
    try {
      execSync('openclaw gateway restart', { stdio: 'inherit' });
      success('OpenClaw Gateway restarted!');
    } catch (e) {
      warn('Could not restart Gateway (it may not be running)');
      info('Start it with: openclaw gateway start');
    }
  }
  
  // Done!
  log('');
  console.log(`${colors.green}${colors.bright}✓ Setup complete!${colors.reset}`);
  log('');
  info('OpenClaw is now configured with smart auto-routing.');
  info(`Default model: ${colors.cyan}litellm-clawrouter/auto${colors.reset}`);
  log('');
  log(`${colors.dim}Routing tiers:${colors.reset}`);
  log(`  ${colors.green}SIMPLE${colors.reset}    → ${tierModels.SIMPLE}`);
  log(`  ${colors.yellow}MEDIUM${colors.reset}    → ${tierModels.MEDIUM}`);
  log(`  ${colors.red}COMPLEX${colors.reset}   → ${tierModels.COMPLEX}`);
  log(`  ${colors.magenta}REASONING${colors.reset} → ${tierModels.REASONING}`);
  log('');
  info('Test it: litellm-clawrouter test "What is 2+2?"');
  log('');
}

async function startProxy() {
  const config = getClawRouterConfig();
  if (!config) {
    error('No configuration found. Run setup first: litellm-clawrouter');
    process.exit(1);
  }
  
  info(`Starting proxy on port ${config.proxyPort}...`);
  
  const { startProxy: start } = require('../src/proxy');
  
  try {
    const proxy = await start({
      port: config.proxyPort,
      litellmBaseUrl: config.litellmBaseUrl,
      litellmApiKey: config.litellmApiKey,
      tierModels: config.tierModels,
      onReady: (port) => {
        success(`Proxy running on http://localhost:${port}`);
        log('');
        info('Routing requests with model "auto" or "litellm-clawrouter/auto"');
        info('Press Ctrl+C to stop');
        log('');
      },
      onRouted: (decision) => {
        const savings = (decision.savings * 100).toFixed(0);
        log(`[${decision.tier}] ${decision.routedModel} (saved ${savings}%)`);
      },
    });
    
    if (proxy.reused) {
      info('Using existing proxy instance');
    }
    
    // Keep running
    process.on('SIGINT', async () => {
      log('');
      info('Shutting down proxy...');
      await proxy.close();
      process.exit(0);
    });
    
    // Keep process alive
    await new Promise(() => {});
  } catch (e) {
    error(`Failed to start proxy: ${e.message}`);
    process.exit(1);
  }
}

async function stopProxy() {
  const config = getClawRouterConfig();
  const port = config?.proxyPort || DEFAULT_PROXY_PORT;
  
  info(`Stopping proxy on port ${port}...`);
  
  try {
    execSync(`lsof -ti:${port} | xargs kill -9 2>/dev/null || true`, { stdio: 'pipe' });
    success('Proxy stopped');
  } catch {
    warn('No proxy process found');
  }
}

async function showStatus() {
  const config = getClawRouterConfig();
  
  if (!config) {
    error('Not configured. Run: litellm-clawrouter');
    return;
  }
  
  log('');
  log(`${colors.bright}LiteLLM ClawRouter Status${colors.reset}`);
  log('');
  log(`${colors.cyan}LiteLLM Proxy:${colors.reset} ${config.litellmBaseUrl}`);
  log(`${colors.cyan}Router Port:${colors.reset}   ${config.proxyPort}`);
  log('');
  log(`${colors.dim}Tier Models:${colors.reset}`);
  for (const [tier, model] of Object.entries(config.tierModels || {})) {
    log(`  ${tier}: ${model}`);
  }
  log('');
  
  // Check if proxy is running
  try {
    const response = await fetch(`http://localhost:${config.proxyPort}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    if (response.ok) {
      success('Proxy is running');
    } else {
      warn('Proxy returned error');
    }
  } catch {
    warn('Proxy is not running');
    info('Start with: litellm-clawrouter start');
  }
}

function testRouting(message) {
  if (!message) {
    error('Usage: litellm-clawrouter test "Your message here"');
    process.exit(1);
  }
  
  const { route, estimateSavings } = require('../src/router');
  const config = getClawRouterConfig();
  
  const decision = route(message, { tierModels: config?.tierModels });
  const savings = estimateSavings(decision.model);
  
  log('');
  log(`${colors.bright}Routing Decision${colors.reset}`);
  log('');
  log(`${colors.cyan}Input:${colors.reset} "${message.slice(0, 80)}${message.length > 80 ? '...' : ''}"`);
  log('');
  log(`${colors.cyan}Tier:${colors.reset}       ${decision.tier}`);
  log(`${colors.cyan}Model:${colors.reset}      ${decision.model}`);
  log(`${colors.cyan}Confidence:${colors.reset} ${(decision.confidence * 100).toFixed(1)}%`);
  log(`${colors.cyan}Savings:${colors.reset}    ${(savings * 100).toFixed(0)}% vs Claude Opus`);
  log('');
  
  if (decision.scores) {
    log(`${colors.dim}Dimension Scores:${colors.reset}`);
    const topScores = Object.entries(decision.scores)
      .filter(([_, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
    for (const [dim, score] of topScores) {
      log(`  ${dim}: ${(score * 100).toFixed(0)}%`);
    }
  }
  log('');
}

process.on('uncaughtException', (e) => {
  error(e.message);
  process.exit(1);
});

run().catch((e) => {
  error(e.message);
  process.exit(1);
});
