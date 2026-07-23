import { GoogleGenerativeAI } from '@google/generative-ai';
import { logger } from './logger';

let genAI: GoogleGenerativeAI | null = null;

export function getGeminiModel() {
  if (!genAI) {
    if (!process.env.GEMINI_API_KEY) {
      logger.warn('GEMINI_API_KEY is not set. Gemini API calls will fail.');
    }
    genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');
  }
  return genAI.getGenerativeModel({
    model: 'gemini-1.5-pro',
    generationConfig: {
      responseMimeType: 'application/json',
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
