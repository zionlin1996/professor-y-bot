const { createMemeLookup } = require("./meme-lookup");
const data = require("../extensions/baki-memes.json");

module.exports = createMemeLookup(data, "Baki meme panel");
