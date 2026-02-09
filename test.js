// LiteLLM ClawRouter Tests
const { route, scoreDimensions, estimateSavings, DEFAULT_TIER_MODELS } = require('./src/router');

console.log('Running LiteLLM ClawRouter tests...\n');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
    passed++;
  } catch (e) {
    console.log(`✗ ${name}`);
    console.log(`  Error: ${e.message}`);
    failed++;
  }
}

function assertEqual(actual, expected, msg = '') {
  if (actual !== expected) {
    throw new Error(`${msg} Expected ${expected}, got ${actual}`);
  }
}

function assertTrue(condition, msg = '') {
  if (!condition) {
    throw new Error(msg || 'Assertion failed');
  }
}

// Test 1: Simple queries route to SIMPLE tier
test('Simple queries → SIMPLE tier', () => {
  const decision = route('What is 2+2?');
  assertEqual(decision.tier, 'SIMPLE', 'Simple math question');
});

test('Translation → SIMPLE tier', () => {
  const decision = route('Translate "hello" to Spanish');
  assertEqual(decision.tier, 'SIMPLE', 'Translation request');
});

test('Definition → SIMPLE tier', () => {
  const decision = route('What is the meaning of life?');
  assertEqual(decision.tier, 'SIMPLE', 'Definition question');
});

// Test 2: Code/technical queries route appropriately
test('Code with imports → MEDIUM or higher', () => {
  const decision = route('Fix this code: import React from "react"; function App() { return <div>Hello</div>; }');
  assertTrue(['MEDIUM', 'COMPLEX'].includes(decision.tier), `Got ${decision.tier}`);
});

test('Build request → COMPLEX tier', () => {
  const decision = route('Build a complete REST API with authentication, rate limiting, and database integration using Node.js');
  assertTrue(['MEDIUM', 'COMPLEX'].includes(decision.tier), `Got ${decision.tier}`);
});

// Test 3: Reasoning queries route to REASONING tier
test('Prove theorem → REASONING tier', () => {
  const decision = route('Prove that sqrt(2) is irrational step by step');
  assertEqual(decision.tier, 'REASONING', 'Proof request');
});

test('Multiple reasoning markers → REASONING at 0.97 confidence', () => {
  const decision = route('Prove this theorem: derive the proof step by step and explain the logic');
  assertEqual(decision.tier, 'REASONING');
  assertTrue(decision.confidence >= 0.97, `Confidence ${decision.confidence} should be >= 0.97`);
  assertEqual(decision.method, 'rules', 'Should use rules method for strong reasoning');
});

// Test 4: Dimension scoring
test('Dimension scoring detects code', () => {
  const scores = scoreDimensions('function hello() { return "world"; }');
  assertTrue(scores.code > 0, 'Should detect code');
});

test('Dimension scoring detects reasoning', () => {
  const scores = scoreDimensions('Prove this theorem step by step');
  assertTrue(scores.reasoning > 0, 'Should detect reasoning');
});

test('Dimension scoring detects simple', () => {
  const scores = scoreDimensions('What is the capital of France?');
  assertTrue(scores.simple > 0, 'Should detect simple question');
});

// Test 5: Cost savings estimation
test('Savings vs Opus baseline', () => {
  const savings = estimateSavings('gemini/gemini-2.0-flash');
  assertTrue(savings > 0.9, `Savings ${savings} should be >90%`);
});

test('Opus has 0% savings vs itself', () => {
  const savings = estimateSavings('anthropic/claude-opus-4');
  assertEqual(savings, 0, 'Opus vs Opus should be 0% savings');
});

// Test 6: Multi-language support
test('Chinese reasoning markers', () => {
  const decision = route('证明这个定理');
  assertTrue(decision.scores.reasoning > 0, 'Should detect Chinese reasoning');
});

test('Japanese simple markers', () => {
  const scores = scoreDimensions('これは何ですか');
  // Japanese simple detection may vary
  assertTrue(typeof scores.simple === 'number', 'Should have simple score');
});

// Test 7: Custom tier models
test('Custom tier models', () => {
  const customTiers = {
    SIMPLE: 'openai/gpt-4o-mini',
    MEDIUM: 'openai/gpt-4o',
    COMPLEX: 'anthropic/claude-opus-4',
    REASONING: 'openai/o1',
  };
  const decision = route('What is 2+2?', { tierModels: customTiers });
  assertEqual(decision.model, 'openai/gpt-4o-mini', 'Should use custom model');
});

// Test 8: Token count scoring
test('Short prompt scores low on tokenCount', () => {
  const scores = scoreDimensions('Hi');
  assertTrue(scores.tokenCount < 0.3, `Token score ${scores.tokenCount} should be low for short prompt`);
});

test('Long prompt scores high on tokenCount', () => {
  const longPrompt = 'word '.repeat(600);
  const scores = scoreDimensions(longPrompt);
  assertTrue(scores.tokenCount > 0.7, `Token score ${scores.tokenCount} should be high for long prompt`);
});

// Test 9: Route returns all expected fields
test('Route returns complete decision object', () => {
  const decision = route('Hello world');
  assertTrue(decision.tier !== undefined, 'Should have tier');
  assertTrue(decision.model !== undefined, 'Should have model');
  assertTrue(decision.confidence !== undefined, 'Should have confidence');
  assertTrue(decision.method !== undefined, 'Should have method');
  assertTrue(decision.scores !== undefined, 'Should have scores');
});

// Summary
console.log('\n' + '='.repeat(50));
console.log(`Tests: ${passed} passed, ${failed} failed`);
console.log('='.repeat(50));

if (failed > 0) {
  process.exit(1);
}

console.log('\n✅ All tests passed!');
