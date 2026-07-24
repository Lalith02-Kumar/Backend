import { GoogleGenerativeAI } from '@google/generative-ai';
import { logger } from './logger';

export let DISCOVERED_MODELS: string[] = [
  'gemini-1.5-flash',
  'gemini-1.5-flash-latest',
  'gemini-2.0-flash-exp',
  'gemini-1.5-pro',
  'gemini-pro',
];

interface KeyClient {
  client: GoogleGenerativeAI;
  rawKey: string;
  maskedKey: string;
}

let keyClients: KeyClient[] = [];
let currentKeyIndex = 0;
let diagnosticCompleted = false;

async function runModelDiagnostic(keyClient: KeyClient) {
  if (diagnosticCompleted) return;
  diagnosticCompleted = true;

  logger.info({ sdk: '@google/generative-ai', version: '0.21.0', key: keyClient.maskedKey }, '🔍 Running Gemini SDK Model Diagnostic...');

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${keyClient.rawKey}`);
    if (res.ok) {
      const data = await res.json() as { models?: Array<{ name: string; supportedGenerationMethods?: string[] }> };
      if (data.models && Array.isArray(data.models)) {
        const available = data.models
          .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
          .map(m => m.name.replace(/^models\//, ''));

        if (available.length > 0) {
          DISCOVERED_MODELS = Array.from(new Set([...available, ...DISCOVERED_MODELS]));
          logger.info({ key: keyClient.maskedKey, totalModels: available.length, models: available }, '✅ Discovered Available Gemini Models for configured API key');
        }
      }
    } else {
      logger.warn({ status: res.status, statusText: res.statusText }, 'Could not list models via Google REST API endpoint');
    }
  } catch (err: any) {
    logger.warn({ err: err?.message || err }, 'Gemini model discovery fetch failed, using built-in model candidates list');
  }

  // Execute quick test generation using the top model candidate
  try {
    const topModel = DISCOVERED_MODELS[0];
    const model = keyClient.client.getGenerativeModel({
      model: topModel,
      generationConfig: { responseMimeType: 'application/json' },
    });
    const result = await Promise.race([
      model.generateContent('Respond with {"status": "ok"}'),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Test timeout')), 8000)),
    ]);
    logger.info({ model: topModel, response: result.response.text().trim() }, '🎉 Gemini Model Diagnostic Test Response Successful');
  } catch (e: any) {
    logger.warn({ err: e?.message || e }, 'Gemini test generation failed during diagnostic');
  }
}

function getKeyClients(): KeyClient[] {
  if (keyClients.length === 0) {
    const keysString = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '';
    const keys = keysString.split(',').map(k => k.trim()).filter(k => k.length > 0);
    
    if (keys.length === 0) {
      logger.warn('No GEMINI API keys found in environment variables. API calls will fail.');
      keys.push('INVALID_KEY');
    }

    keyClients = keys.map(key => ({
      client: new GoogleGenerativeAI(key),
      rawKey: key,
      maskedKey: key.length > 4 ? `****${key.slice(-4)}` : '****',
    }));
    
    logger.info(`Initialized Gemini AI with ${keyClients.length} load-balanced API key(s).`);
  }
  return keyClients;
}

export async function runGeminiDiagnostic() {
  const clients = getKeyClients();
  if (clients.length > 0 && clients[0].rawKey !== 'INVALID_KEY') {
    await runModelDiagnostic(clients[0]);
  }
}

export function getNextKeyClient(offset = 0): KeyClient {
  const clients = getKeyClients();
  const index = (currentKeyIndex + offset) % clients.length;
  currentKeyIndex = (currentKeyIndex + 1) % clients.length;
  return clients[index];
}

export async function generateJson<T>(
  prompt: string,
  maxRetries = 3,
  timeoutMs = 30000,
): Promise<T> {
  const startTime = Date.now();
  let lastError: any = null;

  // We iterate through combinations of candidate models and load-balanced API keys
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const keyClient = getNextKeyClient(attempt);
    // Cycle through discovered models on retries / 404 errors
    const modelName = DISCOVERED_MODELS[attempt % DISCOVERED_MODELS.length];
    
    const model = keyClient.client.getGenerativeModel({
      model: modelName,
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.1,
      },
    });

    try {
      const result = await Promise.race([
        model.generateContent(prompt),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Gemini API timeout after ${timeoutMs}ms`)), timeoutMs),
        ),
      ]);

      const text = result.response.text();
      const durationMs = Date.now() - startTime;

      logger.info({
        model: modelName,
        apiKey: keyClient.maskedKey,
        durationMs,
        attempt: attempt + 1,
        status: 200,
      }, '⚡ Gemini AI Request Successful');

      // Extract JSON from response (strip markdown fences if present)
      const jsonMatch = text.match(/```(?:json)?\n([\s\S]*?)\n```/) || text.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
      const jsonString = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : text;

      return JSON.parse(jsonString.trim()) as T;
    } catch (error: any) {
      lastError = error;
      const durationMs = Date.now() - startTime;
      const errorMessage = error?.message || String(error);
      const is404 = errorMessage.includes('404') || errorMessage.includes('not found');

      logger.warn({
        model: modelName,
        apiKey: keyClient.maskedKey,
        attempt: attempt + 1,
        maxRetries: maxRetries + 1,
        durationMs,
        is404,
        err: errorMessage,
      }, `Gemini AI Request Failed (${is404 ? 'Model 404 Not Found' : 'API Error'}). Fallback rotating model & API key...`);

      if (attempt < maxRetries) {
        // Backoff delay before next attempt
        await new Promise((resolve) => setTimeout(resolve, Math.min((attempt + 1) * 800, 2500)));
      }
    }
  }

  logger.error({ err: lastError?.message || lastError }, '❌ All Gemini AI candidate models and key retries failed.');
  throw lastError || new Error('Gemini AI request failed after all retries');
}
