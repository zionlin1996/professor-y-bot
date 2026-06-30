const OpenAI = require('openai')
const remindTool = require('../tools/remind')
const fetchUrlTool = require('../tools/fetch-url')
const searchMapTool = require('../tools/search-map')

class LumoBackend {
  constructor () {
    if (!process.env.LUMO_API_KEY) {
      throw new Error('LUMO_API_KEY is required for the lumo backend')
    }

    this.client = new OpenAI({
      apiKey: process.env.LUMO_API_KEY,
      baseURL: 'https://lumo.proton.me/api/ai/v1/'
    })
    this.model = 'auto'
  }

  normalizeMessages (messages) {
    return messages.map((msg) => {
      if (!Array.isArray(msg.content)) return msg
      return {
        ...msg,
        content: msg.content.map((block) => {
          if (block.type === 'image') {
            return {
              type: 'image_url',
              image_url: { url: `data:${block.mediaType};base64,${block.data}` }
            }
          }
          if (block.type === 'text') return { type: 'text', text: block.text }
          return block
        })
      }
    })
  }

  // Lumo always streams — collect chunks into a single message object.
  async _streamToMessage (params) {
    const stream = await this.client.chat.completions.create({ ...params, stream: true })
    let content = ''
    const toolCallsMap = {}

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta
      if (!delta) continue
      if (delta.content) content += delta.content
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          if (!toolCallsMap[tc.index]) {
            toolCallsMap[tc.index] = {
              id: tc.id,
              type: tc.type || 'function',
              function: { name: tc.function?.name || '', arguments: '' }
            }
          }
          if (tc.function?.name) toolCallsMap[tc.index].function.name = tc.function.name
          if (tc.function?.arguments) toolCallsMap[tc.index].function.arguments += tc.function.arguments
        }
      }
    }

    const toolCalls = Object.values(toolCallsMap)
    return {
      role: 'assistant',
      content: content || null,
      tool_calls: toolCalls.length ? toolCalls : undefined
    }
  }

  async complete (messages, { chatId } = {}) {
    const normalized = this.normalizeMessages(messages)

    const params = { model: this.model, messages: normalized }

    params.tools = [
      {
        type: 'function',
        function: {
          name: fetchUrlTool.definition.name,
          description: fetchUrlTool.definition.description,
          parameters: fetchUrlTool.definition.parameters
        }
      },
      {
        type: 'function',
        function: {
          name: searchMapTool.definition.name,
          description: searchMapTool.definition.description,
          parameters: searchMapTool.definition.parameters
        }
      }
    ]
    if (remindTool.enabled) {
      params.tools.push({
        type: 'function',
        function: {
          name: remindTool.definition.name,
          description: remindTool.definition.description,
          parameters: remindTool.definition.parameters
        }
      })
    }
    params.tool_choice = 'auto'

    let message = await this._streamToMessage(params)

    // Handle tool calls
    if (message.tool_calls?.length) {
      params.messages = [...params.messages, message]

      for (const call of message.tool_calls) {
        const args = JSON.parse(call.function.arguments)
        let result
        if (call.function.name === fetchUrlTool.definition.name) {
          result = await fetchUrlTool.execute(args)
        } else if (call.function.name === remindTool.definition.name) {
          result = await remindTool.execute(args, { chatId })
        } else if (call.function.name === searchMapTool.definition.name) {
          result = await searchMapTool.execute(args)
        }
        params.messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: result
        })
      }

      message = await this._streamToMessage(params)
    }

    return message.content
  }

  async listModels () {
    return ['auto', 'lumo-fast', 'lumo-thinking']
  }
}

module.exports = LumoBackend
