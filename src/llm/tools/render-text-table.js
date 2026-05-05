const { table } = require("table");

// @todo: make this configurable if tool should be conditionally disabled
const enabled = true;

const definition = {
  name: "render_text_table",
  description:
    "Format structured 2D array data into a highly readable text-based table. " +
    "Use this tool WHENEVER you need to present tabular data, or when you encounter/would normally output HTML <table> tags. " +
    "This ensures the data is perfectly aligned and readable in text-based chat interfaces.",
  parameters: {
    type: "object",
    properties: {
      data: {
        type: "object",
        description: "A 2D array representing the table rows and columns. The first row should typically contain the headers. Example: [['Name', 'Age'], ['Alice', '24'], ['Bob', '30']]",
        items: {
          type: "array",
          items: {
            type: "string",
          },
        },
      },
    },
    required: ["data"],
  },
};

/**
 * Execute the render_text_table tool call.
 * @param {{ data: string[][] }} args - The 2D array data provided by the LLM
 * @returns {Promise<string>} - The formatted ASCII/Unicode table wrapped in a markdown code block
 */
async function execute({ data }) {
  try {
    // Basic validation to ensure the LLM provided a 2D array
    if (!Array.isArray(data) || data.length === 0 || !Array.isArray(data[0])) {
      return"Invalid data format: Expected a non-empty 2D array.";
    }

    // Generate the text table using the gajus/table package
    const outputString = table(data);

    // Return the table wrapped in a Markdown code block
    // This is crucial for Telegram/chat interfaces to use a monospaced font,
    // otherwise the table alignment will be visually broken.
    return `<pre>${outputString}<pre>`;
    
  } catch (error) {
    return `Table generation failed: ${error.message}`;
  }
}

module.exports = { enabled, definition, execute };