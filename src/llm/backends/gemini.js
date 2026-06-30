const { GoogleGenAI } = require('@google/genai')
const remindTool = require('../tools/remind')
const fetchUrlTool = require('../tools/fetch-url')
const searchMapTool = require('../tools/search-map')
const recommendMealTool = require('../tools/recommend-meal')
const userProfileTool = require('../tools/user-profile')

class GeminiBackend {
  constructor () {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY is required for the gemini backend')
    }

    this.client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
    this.model = 'gemini-2.5-flash'
  }

  normalizeMessages (messages) {
    return messages.map((msg) => {
      if (!Array.isArray(msg.content)) return msg
      return {
        ...msg,
        content: msg.content.map((block) => {
          if (block.type === 'image') {
            return {
              inlineData: { mimeType: block.mediaType, data: block.data }
            }
          }
          if (block.type === 'text') return { text: block.text }
          return block
        })
      }
    })
  }

  async complete (messages, { chatId, userId, username } = {}) {
    const normalized = this.normalizeMessages(messages)

    const systemMessage = normalized.find((m) => m.role === 'system')
    const conversationMessages = normalized.filter((m) => m.role !== 'system')

    const contents = conversationMessages.map((msg) => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: Array.isArray(msg.content) ? msg.content : [{ text: msg.content }]
    }))

    // Gemini does not allow mixing built-in tools (googleSearch) with
    // functionDeclarations in the same request — use functionDeclarations only.
    const functionDeclarations = [
      {
        name: fetchUrlTool.definition.name,
        description: fetchUrlTool.definition.description,
        parameters: fetchUrlTool.definition.parameters
      },
      {
        name: searchMapTool.definition.name,
        description: searchMapTool.definition.description,
        parameters: searchMapTool.definition.parameters
      },
      {
        name: recommendMealTool.definition.name,
        description: recommendMealTool.definition.description,
        parameters: recommendMealTool.definition.parameters
      }
    ]
    if (remindTool.enabled) {
      functionDeclarations.push({
        name: remindTool.definition.name,
        description: remindTool.definition.description,
        parameters: remindTool.definition.parameters
      })
    }
    if (userProfileTool.enabled) {
      functionDeclarations.push(
        {
          name: userProfileTool.getDefinition.name,
          description: userProfileTool.getDefinition.description,
          parameters: userProfileTool.getDefinition.parameters
        },
        {
          name: userProfileTool.updateDefinition.name,
          description: userProfileTool.updateDefinition.description,
          parameters: userProfileTool.updateDefinition.parameters
        }
      )
    }
    const tools = [{ functionDeclarations }]

    const config = { tools }
    if (systemMessage) {
      config.systemInstruction = systemMessage.content
    }

    let response = await this.client.models.generateContent({
      model: this.model,
      contents,
      config
    })

    // Handle function calls
    const parts = response.candidates?.[0]?.content?.parts ?? []
    const functionCalls = parts.filter((p) => p.functionCall)

    if (functionCalls.length > 0) {
      contents.push({ role: 'model', parts })

      const responseParts = await Promise.all(
        functionCalls.map(async (p) => {
          let result
          if (p.functionCall.name === fetchUrlTool.definition.name) {
            result = await fetchUrlTool.execute(p.functionCall.args)
          } else if (p.functionCall.name === searchMapTool.definition.name) {
            result = await searchMapTool.execute(p.functionCall.args)
          } else if (p.functionCall.name === recommendMealTool.definition.name) {
            result = await recommendMealTool.execute(p.functionCall.args)
          } else if (p.functionCall.name === remindTool.definition.name) {
            result = await remindTool.execute(p.functionCall.args, { chatId })
          } else if (p.functionCall.name === userProfileTool.getDefinition.name) {
            result = await userProfileTool.getProfile(p.functionCall.args, { chatId, userId, username })
          } else if (p.functionCall.name === userProfileTool.updateDefinition.name) {
            result = await userProfileTool.updateProfile(p.functionCall.args, { chatId, userId, username })
          }
          return {
            functionResponse: {
              name: p.functionCall.name,
              response: { result }
            }
          }
        })
      )

      contents.push({ role: 'user', parts: responseParts })
      response = await this.client.models.generateContent({ model: this.model, contents, config })
    }

    return response.text
  }

  async listModels () {
    const models = []
    const pager = await this.client.models.list()
    for await (const m of pager) models.push(m)
    return models
      .filter((m) => m.name?.includes('gemini') && !m.name?.includes('embedding'))
      .map((m) => m.name.replace('models/', ''))
  }
}

module.exports = GeminiBackend
