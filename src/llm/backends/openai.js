const OpenAI = require("openai");
const remindTool = require("../tools/remind");

class OpenAIBackend {
  constructor() {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is required for the openai backend");
    }

    this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    this.model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  }

  normalizeMessages(messages) {
    return messages.map((msg) => {
      if (!Array.isArray(msg.content)) return msg;
      return {
        ...msg,
        content: msg.content.map((block) => {
          if (block.type === "image")
            return {
              type: "input_image",
              image_url: `data:${block.mediaType};base64,${block.data}`,
            };
          if (block.type === "text")
            return { type: "input_text", text: block.text };
          return block;
        }),
      };
    });
  }

  async complete(messages, { chatId } = {}) {
    const normalized = this.normalizeMessages(messages);
    const systemMessage = normalized.find((m) => m.role === "system");
    const inputMessages = normalized.filter((m) => m.role !== "system");

    const tools = [{ type: "web_search_preview" }];
    if (remindTool.enabled) {
      tools.push({
        type: "function",
        name: remindTool.definition.name,
        description: remindTool.definition.description,
        parameters: remindTool.definition.parameters,
      });
    }

    const params = {
      model: this.model,
      input: inputMessages,
      tools,
    };

    if (systemMessage) {
      params.instructions = systemMessage.content;
    }

    let response = await this.client.responses.create(params);

    // Handle client-side function calls (web_search is server-side and resolves automatically)
    const functionCalls = response.output.filter((item) => item.type === "function_call");
    if (functionCalls.length > 0) {
      const newInput = [...params.input, ...response.output];

      for (const call of functionCalls) {
        const args = JSON.parse(call.arguments);
        const result = await remindTool.execute(args, chatId);
        newInput.push({ type: "function_call_output", call_id: call.call_id, output: result });
      }

      params.input = newInput;
      response = await this.client.responses.create(params);
    }

    return response.output_text;
  }
}

module.exports = OpenAIBackend;
