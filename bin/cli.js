#!/usr/bin/env node

const { spawn, execSync } = require('child_process');
const readline = require('readline');
const path = require('path');
const fs = require('fs');
const os = require('os');

const OPENCLAW_CONFIG_PATH = path.join(os.homedir(), '.openclaw', 'openclaw.json');

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  red: '\x1b[31m',
};

function log(msg) {
  console.log(msg);
}

function success(msg) {
  console.log(`${colors.green}✓${colors.reset} ${msg}`);
}

function info(msg) {
  console.log(`${colors.blue}ℹ${colors.reset} ${msg}`);
}

function warn(msg) {
  console.log(`${colors.yellow}⚠${colors.reset} ${msg}`);
}

function error(msg) {
  console.log(`${colors.red}✗${colors.reset} ${msg}`);
}

function banner() {
  console.log(`
${colors.cyan}╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   ${colors.bright}LiteLLM ClawRouter${colors.reset}${colors.cyan}                                    ║
║   Route OpenClaw through LiteLLM Proxy                    ║
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
        // Ctrl+C
        process.exit(1);
      } else if (char === '\x7f' || char === '\b') {
        // Backspace
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
      // Basic JSON5 support - remove comments and trailing commas
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

function generateConfig(apiKey, baseUrl, model) {
  return {
    models: {
      mode: "merge",
      providers: {
        litellm: {
          baseUrl: baseUrl.replace(/\/$/, '') + '/v1',
          apiKey: apiKey,
          api: "openai-responses",
          models: [
            {
              id: model || "gpt-4o",
              name: model || "gpt-4o",
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
          primary: `litellm/${model || "gpt-4o"}`
        }
      }
    }
  };
}

function mergeConfig(existing, litellmConfig) {
  // Deep merge the configs
  const merged = { ...existing };
  
  // Merge models.providers
  if (!merged.models) merged.models = {};
  if (!merged.models.providers) merged.models.providers = {};
  merged.models.mode = "merge";
  merged.models.providers.litellm = litellmConfig.models.providers.litellm;
  
  // Merge agents.defaults.model
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
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
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
  banner();
  
  // Check if OpenClaw is installed
  if (!checkOpenClaw()) {
    error('OpenClaw not found in PATH.');
    info('Install OpenClaw first: https://docs.openclaw.ai');
    process.exit(1);
  }
  success('OpenClaw detected');
  
  // Get LiteLLM details
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
  
  // Test connection
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
  
  // Select model
  let model = 'gpt-4o';
  if (availableModels.length > 0) {
    log('');
    info('Available models:');
    availableModels.slice(0, 10).forEach((m, i) => {
      log(`  ${i + 1}. ${m}`);
    });
    if (availableModels.length > 10) {
      log(`  ... and ${availableModels.length - 10} more`);
    }
    log('');
    const modelInput = await prompt(`${colors.cyan}Default model${colors.reset} [${availableModels[0]}]: `);
    model = modelInput || availableModels[0];
  } else {
    const modelInput = await prompt(`${colors.cyan}Default model${colors.reset} [gpt-4o]: `);
    model = modelInput || 'gpt-4o';
  }
  
  // Generate and merge config
  log('');
  info('Generating OpenClaw configuration...');
  
  const existingConfig = getOpenClawConfig();
  const litellmConfig = generateConfig(apiKey, baseUrl, model);
  const mergedConfig = mergeConfig(existingConfig, litellmConfig);
  
  // Write config
  const configDir = path.dirname(OPENCLAW_CONFIG_PATH);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  
  // Create backup if exists
  if (fs.existsSync(OPENCLAW_CONFIG_PATH)) {
    const backupPath = OPENCLAW_CONFIG_PATH + '.backup.' + Date.now();
    fs.copyFileSync(OPENCLAW_CONFIG_PATH, backupPath);
    info(`Backup saved to: ${backupPath}`);
  }
  
  fs.writeFileSync(
    OPENCLAW_CONFIG_PATH,
    JSON.stringify(mergedConfig, null, 2),
    'utf8'
  );
  
  success(`Configuration written to: ${OPENCLAW_CONFIG_PATH}`);
  
  // Restart OpenClaw if running
  log('');
  const restart = await prompt('Restart OpenClaw Gateway now? (Y/n): ');
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
  info('OpenClaw is now configured to route through LiteLLM.');
  info(`Primary model: litellm/${model}`);
  log('');
  info('To verify, start a chat and check /status');
  log('');
}

// Handle errors
process.on('uncaughtException', (e) => {
  error(e.message);
  process.exit(1);
});

// Run
run().catch((e) => {
  error(e.message);
  process.exit(1);
});
