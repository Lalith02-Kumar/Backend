import { GoogleGenerativeAI } from '@google/generative-ai';
import { logger } from './logger';

let currentKeyIndex = 0;
const genAIClients: GoogleGenerativeAI[] = [];

function getClients(): GoogleGenerativeAI[] {
  if (genAIClients.length === 0) {
    const keysString = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '';
    const keys = keysString.split(',').map(k => k.trim()).filter(k => k.length > 0);
    
    if (keys.length === 0) {
      logger.warn('No GEMINI API keys found in environment variables. API calls will fail.');
      keys.push('');
    }

    keys.forEach(key => {
      genAIClients.push(new GoogleGenerativeAI(key));
    });
    
    logger.info(`Initialized Gemini AI with ${keys.length} API keys for load balancing.`);
  }
  return genAIClients;
}

export function getGeminiModel(keyOffset = 0) {
  const clients = getClients();
  const index = (currentKeyIndex + keyOffset) % clients.length;
  const client = clients[index];
  currentKeyIndex = (currentKeyIndex + 1) % clients.length;

  return client.getGenerativeModel({
    model: 'gemini-1.5-flash',
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.1,
    },
  });
}

export async function generateJson<T>(prompt: string, maxRetries = 2, timeoutMs = 25000): Promise<T> {
  const startTime = Date.now();
  let attempt = 0;
  
  while (attempt <= maxRetries) {
    const model = getGeminiModel(attempt);
    try {
      const result = await Promise.race([
        model.generateContent(prompt),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Gemini API timeout')), timeoutMs),
        ),
      ]);

      const text = result.response.text();
      const durationMs = Date.now() - startTime;
      logger.info({ durationMs, attempt: attempt + 1 }, '⚡ Gemini API request completed successfully');

      // Extract JSON from response. Even with responseMimeType, it might include markdown blocks
      const jsonMatch = text.match(/```(?:json)?\n([\s\S]*?)\n```/) || text.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
      const jsonString = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : text;

      return JSON.parse(jsonString.trim()) as T;
    } catch (error: any) {
      attempt++;
      const durationMs = Date.now() - startTime;
      logger.warn({ attempt, maxRetries: maxRetries + 1, durationMs, err: error?.message || error }, 'Gemini AI request failed, retrying with next API key/client...');
      if (attempt > maxRetries) throw error;
      // Exponential backoff
      await new Promise((resolve) => setTimeout(resolve, Math.min(attempt * 1000, 3000)));
    }
  }
  throw new Error('Gemini AI request failed after all retries');
}
