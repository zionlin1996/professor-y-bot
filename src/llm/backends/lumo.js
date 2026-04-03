const OpenAI = require("openai");
const remindTool = require("../tools/remind");

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

  async complete(messages, { chatId } = {}) {
    const normalized = this.normalizeMessages(messages);

    const params = { model: this.model, messages: normalized };

    if (remindTool.enabled) {
      params.tools = [
        {
          type: "function",
          function: {
            name: remindTool.definition.name,
            description: remindTool.definition.description,
            parameters: remindTool.definition.parameters,
          },
        },
      ];
      params.tool_choice = "auto";
    }

    let response = await this.client.chat.completions.create(params);
    let message = response.choices[0].message;

    // Handle tool calls
    if (message.tool_calls?.length) {
      params.messages = [...params.messages, message];

      for (const call of message.tool_calls) {
        const args = JSON.parse(call.function.arguments);
        const result = await remindTool.execute(args, chatId);
        params.messages.push({
          role: "tool",
          tool_call_id: call.id,
          content: result,
        });
      }

      response = await this.client.chat.completions.create(params);
      message = response.choices[0].message;
    }

    return message.content;
  }
}

module.exports = LumoBackend;
