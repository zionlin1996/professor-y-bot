const OpenAI = require("openai");

class LumoBackend {
  constructor() {
    if (!process.env.LUMO_API_KEY) {
      throw new Error("LUMO_API_KEY is required for the lumo backend");
    }

    this.client = new OpenAI({
      apiKey: process.env.LUMO_API_KEY,
      baseURL: "https://lumo.proton.me/api/ai/v1/",
    });
    this.model = process.env.LUMO_MODEL || "auto";
  }

  normalizeMessages(messages) {
    return messages.map((msg) => {
      if (!Array.isArray(msg.content)) return msg;
      return {
        ...msg,
        content: msg.content.map((block) => {
          if (block.type === "image")
            return {
              type: "image_url",
              image_url: { url: `data:${block.mediaType};base64,${block.data}` },
            };
          if (block.type === "text") return { type: "text", text: block.text };
          return block;
        }),
      };
    });
  }

  async complete(messages) {
    const normalized = this.normalizeMessages(messages);
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: normalized,
    });
    return response.choices[0].message.content;
  }
}

module.exports = LumoBackend;
