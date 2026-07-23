import { GoogleGenerativeAI } from '@google/generative-ai';
import { logger } from './logger';

let currentKeyIndex = 0;
const genAIClients: GoogleGenerativeAI[] = [];

export function getGeminiModel() {
  // Initialize clients array on first call
  if (genAIClients.length === 0) {
    const keysString = process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '';
    const keys = keysString.split(',').map(k => k.trim()).filter(k => k.length > 0);
    
    if (keys.length === 0) {
      logger.warn('No GEMINI API keys found in environment variables. API calls will fail.');
      keys.push(''); // Push an empty string so it doesn't crash immediately, but will fail auth
    }

    keys.forEach(key => {
      genAIClients.push(new GoogleGenerativeAI(key));
    });
    
    logger.info(`Initialized Gemini AI with ${keys.length} API keys for load balancing.`);
  }

  // Round-robin selection
  const client = genAIClients[currentKeyIndex];
  currentKeyIndex = (currentKeyIndex + 1) % genAIClients.length;

  return client.getGenerativeModel({
    model: 'gemini-1.5-flash',
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0,
    },
  });
}

export async function generateJson<T>(prompt: string, maxRetries = 2, timeoutMs = 30000): Promise<T> {
  const model = getGeminiModel();

  let attempt = 0;
  while (attempt <= maxRetries) {
    try {
      const result = await Promise.race([
        model.generateContent(prompt),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Gemini API timeout')), timeoutMs),
        ),
      ]);

      const text = result.response.text();

      // Extract JSON from response. Even with responseMimeType, it might include markdown blocks
      const jsonMatch = text.match(/```(?:json)?\n([\s\S]*?)\n```/) || text.match(/\[[\s\S]*\]|\{[\s\S]*\}/);
      const jsonString = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : text;

      return JSON.parse(jsonString.trim()) as T;
    } catch (error) {
      attempt++;
      logger.error(`Gemini AI request failed (attempt ${attempt}/${maxRetries + 1})`, error);
      if (attempt > maxRetries) throw error;
      // Exponential backoff
      await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
    }
  }
  throw new Error('Gemini AI request failed after all retries');
}
