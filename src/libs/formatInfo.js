/**
 * Format the !info metadata block appended to bot replies.
 *
 * @param {LLMClient} llm
 * @param {Thread}    thread
 * @param {object}    [opts]
 * @param {"html"|"plain"} [opts.format="html"]
 * @returns {Promise<string>}
 */
const DIVIDER = "─────────────────────";

async function formatInfo(llm, thread, { format = "html" } = {}) {
  const archiveUrl = thread.toPublicUrl();
  const link = format === "html"
    ? `<a href="${archiveUrl}">${archiveUrl}</a>`
    : archiveUrl;

  return [
    "",
    "",
    DIVIDER,
    `Model: ${llm.providerInfo()}`,
    `Thread Id: ${thread.id}`,
    `Link: ${link}`,
    DIVIDER,
  ].join("\n");
}

module.exports = formatInfo;
