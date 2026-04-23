const OpenAI = require("openai");
const remindTool = require("../tools/remind");
const fetchUrlTool = require("../tools/fetch-url");
const userProfileTool = require("../tools/user-profile");
const searchMapTool = require("../tools/search-map");
const recommendMealTool = require("../tools/recommend-meal");

class OpenAIBackend {
  constructor() {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error("OPENAI_API_KEY is required for the openai backend");
    }

    this.client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    this.model = "gpt-4o-mini";
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

  async complete(messages, { chatId, userId, username } = {}) {
    const normalized = this.normalizeMessages(messages);
    const systemMessage = normalized.find((m) => m.role === "system");
    const inputMessages = normalized.filter((m) => m.role !== "system");

    const tools = [
      { type: "web_search_preview" },
      {
        type: "function",
        name: fetchUrlTool.definition.name,
        description: fetchUrlTool.definition.description,
        parameters: fetchUrlTool.definition.parameters,
      },
      {
        type: "function",
        name: searchMapTool.definition.name,
        description: searchMapTool.definition.description,
        parameters: searchMapTool.definition.parameters,
      },
      {
        type: "function",
        name: recommendMealTool.definition.name,
        description: recommendMealTool.definition.description,
        parameters: recommendMealTool.definition.parameters,
      },
    ];
    if (remindTool.enabled) {
      tools.push({
        type: "function",
        name: remindTool.definition.name,
        description: remindTool.definition.description,
        parameters: remindTool.definition.parameters,
      });
    }
    if (userProfileTool.enabled) {
      tools.push(
        {
          type: "function",
          name: userProfileTool.getDefinition.name,
          description: userProfileTool.getDefinition.description,
          parameters: userProfileTool.getDefinition.parameters,
        },
        {
          type: "function",
          name: userProfileTool.updateDefinition.name,
          description: userProfileTool.updateDefinition.description,
          parameters: userProfileTool.updateDefinition.parameters,
        },
      );
    }

    tools.push({
      type: "mcp",
      server_label: "github",
      server_url: "https://api.githubcopilot.com/mcp/",
      headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` },
      allowed_tools: [
        "get_file_contents",
        "search_code",
        "create_branch",
        "create_or_update_file",
        "create_pull_request",
      ],
    });

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
    const functionCalls = response.output.filter(
      (item) => item.type === "function_call",
    );
    if (functionCalls.length > 0) {
      const newInput = [...params.input, ...response.output];

      for (const call of functionCalls) {
        const args = JSON.parse(call.arguments);
        let result;
        if (call.name === fetchUrlTool.definition.name) {
          result = await fetchUrlTool.execute(args);
        } else if (call.name === searchMapTool.definition.name) {
          result = await searchMapTool.execute(args);
        } else if (call.name === recommendMealTool.definition.name) {
          result = await recommendMealTool.execute(args);
        } else if (call.name === remindTool.definition.name) {
          result = await remindTool.execute(args, { chatId });
        } else if (call.name === userProfileTool.getDefinition.name) {
          result = await userProfileTool.getProfile(args, {
            chatId,
            userId,
            username,
          });
        } else if (call.name === userProfileTool.updateDefinition.name) {
          result = await userProfileTool.updateProfile(args, {
            chatId,
            userId,
            username,
          });
        }
        newInput.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: result,
        });
      }

      params.input = newInput;
      response = await this.client.responses.create(params);
    }

    return response.output_text;
  }

  async listModels() {
    const all = [];
    for await (const m of this.client.models.list()) all.push(m);
    return all
      .filter((m) => /^(gpt-|o1|o3|o4)/.test(m.id))
      .sort((a, b) => b.created - a.created)
      .slice(0, 6)
      .map((m) => m.id);
  }
}

module.exports = OpenAIBackend;
