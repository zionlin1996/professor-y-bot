const { createMemeLookup } = require("./meme-lookup");
const data = require("../extensions/mygo-memes.json");

module.exports = createMemeLookup(data, "MyGO anime meme panel");
