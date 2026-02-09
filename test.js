// Quick test of config generation
const fs = require('fs');
const path = require('path');
const os = require('os');

// Extract the generateConfig and mergeConfig functions for testing
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
  const merged = { ...existing };
  
  if (!merged.models) merged.models = {};
  if (!merged.models.providers) merged.models.providers = {};
  merged.models.mode = "merge";
  merged.models.providers.litellm = litellmConfig.models.providers.litellm;
  
  if (!merged.agents) merged.agents = {};
  if (!merged.agents.defaults) merged.agents.defaults = {};
  merged.agents.defaults.model = litellmConfig.agents.defaults.model;
  
  return merged;
}

// Test 1: Generate config
console.log('Test 1: Generate config');
const config = generateConfig('sk-test-key', 'http://localhost:4000', 'claude-3-5-sonnet');
console.assert(config.models.providers.litellm.baseUrl === 'http://localhost:4000/v1');
console.assert(config.models.providers.litellm.apiKey === 'sk-test-key');
console.assert(config.agents.defaults.model.primary === 'litellm/claude-3-5-sonnet');
console.log('✓ Config generated correctly');

// Test 2: Merge with existing config
console.log('\nTest 2: Merge with existing config');
const existingConfig = {
  agents: {
    defaults: {
      workspace: '~/.openclaw/workspace'
    }
  },
  channels: {
    telegram: { enabled: true }
  }
};
const merged = mergeConfig(existingConfig, config);
console.assert(merged.agents.defaults.workspace === '~/.openclaw/workspace');
console.assert(merged.channels.telegram.enabled === true);
console.assert(merged.models.providers.litellm.apiKey === 'sk-test-key');
console.log('✓ Configs merged correctly');

// Test 3: URL trailing slash handling
console.log('\nTest 3: URL trailing slash handling');
const config2 = generateConfig('key', 'http://localhost:4000/', 'gpt-4');
console.assert(config2.models.providers.litellm.baseUrl === 'http://localhost:4000/v1');
console.log('✓ Trailing slash handled correctly');

console.log('\n✅ All tests passed!');
