/**
 * LiteLLM ClawRouter - Smart routing logic
 * 
 * 14-dimension weighted scoring (inspired by ClawRouter)
 * Runs 100% locally, <1ms, zero API calls
 */

// Default tier → model mapping (user can override)
const DEFAULT_TIER_MODELS = {
  SIMPLE: 'gemini/gemini-2.0-flash',      // $0.10/M - simple Q&A
  MEDIUM: 'deepseek/deepseek-chat',       // $0.27/M - general tasks  
  COMPLEX: 'anthropic/claude-sonnet-4',   // $3.00/M - complex coding
  REASONING: 'deepseek/deepseek-reasoner', // $0.55/M - step-by-step reasoning
};

// Scoring weights (total = 1.0)
const WEIGHTS = {
  reasoning: 0.20,      // "prove", "theorem", "step by step"
  code: 0.18,           // "function", "async", "import", "```"
  simple: 0.10,         // "what is", "define", "translate"
  multiStep: 0.10,      // "first...then", "step 1", numbered lists
  technical: 0.10,      // "algorithm", "kubernetes", "distributed"
  tokenCount: 0.08,     // short (<50) vs long (>500) prompts
  creative: 0.05,       // "story", "poem", "brainstorm"
  questionComplexity: 0.04, // Multiple question marks
  constraints: 0.04,    // "at most", "O(n)", "maximum"
  imperative: 0.04,     // "build", "create", "implement"
  outputFormat: 0.03,   // "json", "yaml", "schema"
  domain: 0.02,         // "quantum", "fpga", "genomics"
  reference: 0.01,      // "the docs", "the api", "above"
  negation: 0.01,       // "don't", "avoid", "without"
};

// Keyword patterns for each dimension
const PATTERNS = {
  reasoning: [
    /\b(prove|theorem|proof|derive|deduce|infer|logic|reasoning)\b/i,
    /\b(step[- ]by[- ]step|think through|work through|explain why)\b/i,
    /(因为|所以|证明|推理|定理)/, // Chinese (no word boundary needed)
    /(なぜ|証明|理由)/, // Japanese (no word boundary needed)
    /\b(доказать|теорема|вывод)/i, // Russian
  ],
  code: [
    /\b(function|async|await|import|export|const|let|var|class|interface)\b/,
    /```[\s\S]*```/,
    /\b(def |return |if __name__|lambda)\b/,
    /\b(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE)\b/i,
    /[{}();].*[{}();]/, // Multiple code brackets
    /<[a-zA-Z][^>]*>/, // JSX/HTML tags
    /\bimport\s+\w+\s+from\b/, // ES6 imports
  ],
  simple: [
    /\b(what is|what's|define|meaning of|translate|convert)\b/i,
    /\b(who is|when was|where is|how many)\b/i,
    /\b(什么是|是什么|翻译|定义)/i, // Chinese
    /\b(とは|意味|翻訳)/i, // Japanese
  ],
  multiStep: [
    /\b(first|then|next|after that|finally|step \d)/i,
    /\b(1\.|2\.|3\.)/,
    /\b(phase|stage|part \d)/i,
  ],
  technical: [
    /\b(algorithm|kubernetes|docker|terraform|nginx|redis)\b/i,
    /\b(distributed|microservice|scalable|concurrent|async)\b/i,
    /\b(api|sdk|rest|graphql|grpc|websocket)\b/i,
    /\b(oauth|jwt|authentication|authorization)\b/i,
  ],
  creative: [
    /\b(write a story|poem|creative|brainstorm|imagine)\b/i,
    /\b(fiction|narrative|character|plot)\b/i,
  ],
  constraints: [
    /\b(at most|at least|maximum|minimum|no more than)\b/i,
    /\bO\([nN\d\^logLog]+\)/,
    /\b(constraint|limit|bound|restriction)\b/i,
  ],
  imperative: [
    /\b(build|create|implement|develop|design|write|make)\b/i,
    /\b(fix|debug|optimize|refactor|improve)\b/i,
  ],
  outputFormat: [
    /\b(json|yaml|xml|csv|markdown|html)\b/i,
    /\b(schema|format|structure|template)\b/i,
  ],
  domain: [
    /\b(quantum|genomics|bioinformatics|fpga|verilog)\b/i,
    /\b(machine learning|neural network|transformer|llm)\b/i,
  ],
  reference: [
    /\b(the docs|the documentation|the api|the code above)\b/i,
    /\b(as mentioned|as shown|see above|referenced)\b/i,
  ],
  negation: [
    /\b(don't|do not|avoid|without|never|shouldn't)\b/i,
    /\b(不要|禁止|避免)/i, // Chinese
  ],
};

/**
 * Calculate dimension scores for a prompt
 */
function scoreDimensions(prompt) {
  const scores = {};
  const promptLower = prompt.toLowerCase();
  const tokenCount = prompt.split(/\s+/).length;
  
  // Pattern-based scores
  for (const [dim, patterns] of Object.entries(PATTERNS)) {
    let matches = 0;
    for (const pattern of patterns) {
      if (pattern.test(prompt)) matches++;
    }
    scores[dim] = Math.min(matches / patterns.length, 1.0);
  }
  
  // Token count score (short = simple, long = complex)
  if (tokenCount < 50) {
    scores.tokenCount = 0.2; // Likely simple
  } else if (tokenCount > 500) {
    scores.tokenCount = 0.9; // Likely complex
  } else {
    scores.tokenCount = 0.5 + (tokenCount - 50) / 900; // Linear interpolation
  }
  
  // Question complexity (multiple question marks = more complex)
  const questionMarks = (prompt.match(/\?/g) || []).length;
  scores.questionComplexity = Math.min(questionMarks / 3, 1.0);
  
  return scores;
}

/**
 * Calculate weighted score and select tier
 */
function route(prompt, options = {}) {
  const tierModels = options.tierModels || DEFAULT_TIER_MODELS;
  const scores = scoreDimensions(prompt);
  
  // Calculate weighted sum
  let weightedSum = 0;
  for (const [dim, weight] of Object.entries(WEIGHTS)) {
    weightedSum += (scores[dim] || 0) * weight;
  }
  
  // Sigmoid calibration for confidence
  const confidence = 1 / (1 + Math.exp(-10 * (weightedSum - 0.5)));
  
  // Special rule: 2+ strong reasoning markers → REASONING at 0.97 confidence
  const reasoningPatterns = PATTERNS.reasoning;
  let reasoningMatches = 0;
  for (const pattern of reasoningPatterns) {
    if (pattern.test(prompt)) reasoningMatches++;
  }
  if (reasoningMatches >= 2) {
    return {
      tier: 'REASONING',
      model: tierModels.REASONING,
      confidence: 0.97,
      method: 'rules',
      scores,
    };
  }
  
  // Tier selection based on weighted score and dimension signals
  let tier;
  
  // Strong code signal → at least MEDIUM
  const hasStrongCode = scores.code > 0.3 || scores.technical > 0.3;
  const hasStrongImperative = scores.imperative > 0.3 && (scores.code > 0.1 || scores.technical > 0.1);
  
  if (weightedSum < 0.20 && !hasStrongCode && !hasStrongImperative) {
    tier = 'SIMPLE';
  } else if (scores.reasoning > 0.5 || reasoningMatches >= 1) {
    tier = 'REASONING';
  } else if (weightedSum < 0.40 && !hasStrongImperative) {
    tier = 'MEDIUM';
  } else {
    tier = 'COMPLEX';
  }
  
  return {
    tier,
    model: tierModels[tier],
    confidence,
    weightedScore: weightedSum,
    method: 'weighted',
    scores,
  };
}

/**
 * Get cost estimate for a model (approximate)
 */
const MODEL_COSTS = {
  'gemini/gemini-2.0-flash': { input: 0.10, output: 0.40 },
  'deepseek/deepseek-chat': { input: 0.14, output: 0.28 },
  'anthropic/claude-sonnet-4': { input: 3.00, output: 15.00 },
  'deepseek/deepseek-reasoner': { input: 0.55, output: 2.19 },
  'openai/gpt-4o-mini': { input: 0.15, output: 0.60 },
  'openai/gpt-4o': { input: 2.50, output: 10.00 },
  'anthropic/claude-opus-4': { input: 15.00, output: 75.00 },
};

function estimateCost(model, inputTokens, outputTokens = 500) {
  const costs = MODEL_COSTS[model] || { input: 1.00, output: 5.00 };
  return (inputTokens / 1_000_000 * costs.input) + (outputTokens / 1_000_000 * costs.output);
}

function estimateSavings(routedModel, baselineModel = 'anthropic/claude-opus-4', inputTokens = 1000, outputTokens = 500) {
  const routedCost = estimateCost(routedModel, inputTokens, outputTokens);
  const baselineCost = estimateCost(baselineModel, inputTokens, outputTokens);
  return baselineCost > 0 ? (baselineCost - routedCost) / baselineCost : 0;
}

module.exports = {
  route,
  scoreDimensions,
  estimateCost,
  estimateSavings,
  DEFAULT_TIER_MODELS,
  WEIGHTS,
  PATTERNS,
  MODEL_COSTS,
};
