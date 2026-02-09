/**
 * LiteLLM ClawRouter Proxy
 * 
 * Local proxy that intercepts OpenAI-compatible requests,
 * applies smart routing, and forwards to LiteLLM.
 */

const http = require('http');
const https = require('https');
const { route, estimateSavings, DEFAULT_TIER_MODELS } = require('./router');

const DEFAULT_PORT = 8401;

/**
 * Start the routing proxy
 */
async function startProxy(options = {}) {
  const {
    port = process.env.LITELLM_CLAWROUTER_PORT || DEFAULT_PORT,
    litellmBaseUrl,
    litellmApiKey,
    tierModels = DEFAULT_TIER_MODELS,
    onReady,
    onRouted,
    onError,
  } = options;

  if (!litellmBaseUrl) {
    throw new Error('litellmBaseUrl is required');
  }
  if (!litellmApiKey) {
    throw new Error('litellmApiKey is required');
  }

  const baseUrl = litellmBaseUrl.replace(/\/$/, '');
  const isHttps = baseUrl.startsWith('https://');
  const httpModule = isHttps ? https : http;

  const server = http.createServer(async (req, res) => {
    // Health check
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', version: '1.0.0' }));
      return;
    }

    // Only handle POST to chat/completions endpoints
    if (req.method !== 'POST' || !req.url.includes('/chat/completions')) {
      // Pass through other requests
      proxyRequest(req, res, baseUrl, litellmApiKey, httpModule);
      return;
    }

    // Collect request body
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        const originalModel = payload.model;

        // Check if auto-routing is requested
        const isAutoRoute = originalModel === 'auto' || 
                           originalModel === 'litellm/auto' ||
                           originalModel === 'litellm-clawrouter/auto';

        if (isAutoRoute && payload.messages?.length > 0) {
          // Extract prompt from messages
          const lastMessage = payload.messages[payload.messages.length - 1];
          const prompt = typeof lastMessage.content === 'string' 
            ? lastMessage.content 
            : JSON.stringify(lastMessage.content);

          // Route the request
          const decision = route(prompt, { tierModels });
          payload.model = decision.model;

          const savings = estimateSavings(decision.model);

          if (onRouted) {
            onRouted({
              originalModel,
              routedModel: decision.model,
              tier: decision.tier,
              confidence: decision.confidence,
              savings,
              promptPreview: prompt.slice(0, 100),
            });
          }

          // Log routing decision
          const savingsPercent = (savings * 100).toFixed(0);
          console.log(`[${decision.tier}] ${decision.model} (saved ${savingsPercent}%)`);
        }

        // Forward to LiteLLM
        const newBody = JSON.stringify(payload);
        proxyRequestWithBody(req, res, baseUrl, litellmApiKey, httpModule, newBody);
      } catch (err) {
        if (onError) onError(err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err.message }));
      }
    });
  });

  return new Promise((resolve, reject) => {
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`Port ${port} in use, checking if existing proxy is compatible...`);
        // Try to connect to existing proxy
        http.get(`http://localhost:${port}/health`, (healthRes) => {
          let data = '';
          healthRes.on('data', chunk => data += chunk);
          healthRes.on('end', () => {
            try {
              const health = JSON.parse(data);
              if (health.status === 'ok') {
                console.log('Reusing existing LiteLLM ClawRouter proxy');
                resolve({
                  port,
                  baseUrl: `http://localhost:${port}`,
                  reused: true,
                  close: () => Promise.resolve(),
                });
                return;
              }
            } catch {}
            reject(new Error(`Port ${port} is in use by another service`));
          });
        }).on('error', () => {
          reject(new Error(`Port ${port} is in use by another service`));
        });
      } else {
        reject(err);
      }
    });

    server.listen(port, () => {
      const proxyUrl = `http://localhost:${port}`;
      if (onReady) onReady(port);
      resolve({
        port,
        baseUrl: proxyUrl,
        reused: false,
        close: () => new Promise(r => server.close(r)),
      });
    });
  });
}

/**
 * Proxy a request with a modified body
 */
function proxyRequestWithBody(clientReq, clientRes, baseUrl, apiKey, httpModule, body) {
  const url = new URL(clientReq.url, baseUrl);
  
  const options = {
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname + url.search,
    method: clientReq.method,
    headers: {
      ...clientReq.headers,
      'host': url.host,
      'authorization': `Bearer ${apiKey}`,
      'content-length': Buffer.byteLength(body),
    },
  };

  const proxyReq = httpModule.request(options, (proxyRes) => {
    clientRes.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(clientRes);
  });

  proxyReq.on('error', (err) => {
    console.error('Proxy error:', err.message);
    clientRes.writeHead(502, { 'Content-Type': 'application/json' });
    clientRes.end(JSON.stringify({ error: 'Bad gateway', details: err.message }));
  });

  proxyReq.write(body);
  proxyReq.end();
}

/**
 * Pass-through proxy for non-chat requests
 */
function proxyRequest(clientReq, clientRes, baseUrl, apiKey, httpModule) {
  const url = new URL(clientReq.url, baseUrl);
  
  const options = {
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname + url.search,
    method: clientReq.method,
    headers: {
      ...clientReq.headers,
      'host': url.host,
      'authorization': `Bearer ${apiKey}`,
    },
  };

  const proxyReq = httpModule.request(options, (proxyRes) => {
    clientRes.writeHead(proxyRes.statusCode, proxyRes.headers);
    proxyRes.pipe(clientRes);
  });

  proxyReq.on('error', (err) => {
    console.error('Proxy error:', err.message);
    clientRes.writeHead(502, { 'Content-Type': 'application/json' });
    clientRes.end(JSON.stringify({ error: 'Bad gateway', details: err.message }));
  });

  clientReq.pipe(proxyReq);
}

module.exports = { startProxy, DEFAULT_PORT };
