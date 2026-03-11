const { GoogleGenAI } = require("@google/genai");

class GeminiBackend {
  constructor() {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY is required for the gemini backend");
    }

    this.client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    this.model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  }

  normalizeMessages(messages) {
    return messages.map((msg) => {
      if (!Array.isArray(msg.content)) return msg;
      return {
        ...msg,
        content: msg.content.map((block) => {
          if (block.type === "image")
            return {
              inlineData: { mimeType: block.mediaType, data: block.data },
            };
          if (block.type === "text") return { text: block.text };
          return block;
        }),
      };
    });
  }

  async complete(messages) {
    const normalized = this.normalizeMessages(messages);

    const systemMessage = normalized.find((m) => m.role === "system");
    const conversationMessages = normalized.filter((m) => m.role !== "system");

    // Gemini uses "model" instead of "assistant" and wraps content in "parts"
    const contents = conversationMessages.map((msg) => ({
      role: msg.role === "assistant" ? "model" : "user",
      parts: Array.isArray(msg.content) ? msg.content : [{ text: msg.content }],
    }));

    const config = {
      tools: [{ googleSearch: {} }],
    };

    if (systemMessage) {
      config.systemInstruction = systemMessage.content;
    }

    const response = await this.client.models.generateContent({
      model: this.model,
      contents,
      config,
    });

    return response.text;
  }
}

module.exports = GeminiBackend;
