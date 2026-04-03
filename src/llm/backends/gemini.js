const { GoogleGenAI } = require("@google/genai");
const remindTool = require("../tools/remind");

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

  async complete(messages, { chatId } = {}) {
    const normalized = this.normalizeMessages(messages);

    const systemMessage = normalized.find((m) => m.role === "system");
    const conversationMessages = normalized.filter((m) => m.role !== "system");

    const contents = conversationMessages.map((msg) => ({
      role: msg.role === "assistant" ? "model" : "user",
      parts: Array.isArray(msg.content) ? msg.content : [{ text: msg.content }],
    }));

    const tools = [{ googleSearch: {} }];
    if (remindTool.enabled) {
      tools.push({
        functionDeclarations: [
          {
            name: remindTool.definition.name,
            description: remindTool.definition.description,
            parameters: remindTool.definition.parameters,
          },
        ],
      });
    }

    const config = { tools };
    if (systemMessage) {
      config.systemInstruction = systemMessage.content;
    }

    let response = await this.client.models.generateContent({
      model: this.model,
      contents,
      config,
    });

    // Handle function calls
    const parts = response.candidates?.[0]?.content?.parts ?? [];
    const functionCalls = parts.filter((p) => p.functionCall);

    if (functionCalls.length > 0) {
      contents.push({ role: "model", parts });

      const responseParts = await Promise.all(
        functionCalls.map(async (p) => {
          const result = await remindTool.execute(p.functionCall.args, chatId);
          return {
            functionResponse: {
              name: p.functionCall.name,
              response: { result },
            },
          };
        }),
      );

      contents.push({ role: "user", parts: responseParts });
      response = await this.client.models.generateContent({ model: this.model, contents, config });
    }

    return response.text;
  }
}

module.exports = GeminiBackend;
