
import { GoogleGenAI, Type } from "@google/genai";
import { DetectionResult } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

export async function detectPlatesFromImage(base64Image: string): Promise<string[]> {
  if (!base64Image || base64Image.length < 50) return [];
  
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: [
        {
          parts: [
            {
              inlineData: {
                mimeType: "image/jpeg",
                data: base64Image
              }
            },
            {
              text: "LAPI TURBO: Liste les plaques FR (AA-123-AA ou 1234 AB 75). Retourne JSON uniquement: {\"plates\": [\"NUMERO\"]}. Si rien: {\"plates\": []}."
            }
          ]
        }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            plates: {
              type: Type.ARRAY,
              items: { type: Type.STRING }
            }
          },
          required: ["plates"]
        },
        thinkingConfig: { thinkingBudget: 0 }
      }
    });

    const resultText = response.text;
    if (!resultText) return [];
    
    const result: DetectionResult = JSON.parse(resultText.trim());
    return Array.isArray(result.plates) ? result.plates : [];
  } catch (error: any) {
    if (error?.message?.includes('429')) {
      throw new Error("QUOTA_EXCEEDED");
    }
    console.error("LAPI Engine Error:", error);
    return [];
  }
}
