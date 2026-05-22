#!/usr/bin/env node
/**
 * Scrapes all meme entries from mygo.miyago9267.com API and writes
 * src/llm/extensions/mygo-memes.json organised by character (author).
 *
 * Usage: node scripts/scrape-mygo-memes.js
 */

const https = require("https");
const fs = require("fs");
const path = require("path");

const BASE_URL = "https://mygo.miyago9267.com/api/v1/images";
const LIMIT = 100;
const OUT_PATH = path.join(
  __dirname,
  "../src/llm/extensions/mygo-memes.json"
);

function get(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          } else {
            resolve(JSON.parse(body));
          }
        });
      })
      .on("error", reject);
  });
}

async function fetchAll() {
  // First request to get total count
  const first = await get(`${BASE_URL}?page=1&limit=${LIMIT}&order=id`);
  const total = first.meta.total;
  const totalPages = first.meta.totalPages;
  console.log(`Total images: ${total}, pages: ${totalPages}`);

  const all = [...first.data];

  for (let page = 2; page <= totalPages; page++) {
    process.stdout.write(`  Fetching page ${page}/${totalPages}...\r`);
    const res = await get(`${BASE_URL}?page=${page}&limit=${LIMIT}&order=id`);
    all.push(...res.data);
    // Polite delay
    await new Promise((r) => setTimeout(r, 150));
  }

  console.log(`\nFetched ${all.length} entries`);
  return all;
}

function buildJson(entries) {
  const sections = {};

  for (const item of entries) {
    // Normalise section name: use author if present, else "無角色"
    const section = item.author && item.author.trim() ? item.author.trim() : "無角色";

    if (!sections[section]) sections[section] = [];
    sections[section].push({
      alt: item.alt,
      url: item.url,
      episode: item.episode,
      tags: item.tags,
      popularity: item.popularity,
    });
  }

  // Sort each section by popularity desc so the best panels come first
  for (const sec of Object.values(sections)) {
    sec.sort((a, b) => b.popularity - a.popularity);
  }

  return {
    source: "https://mygo.miyago9267.com/",
    title: "MyGO表情包搜尋器",
    total: entries.length,
    sections,
  };
}

async function main() {
  console.log("Scraping MyGO meme API...");
  const entries = await fetchAll();
  const json = buildJson(entries);

  const sectionSummary = Object.entries(json.sections)
    .map(([k, v]) => `  ${k}: ${v.length}`)
    .join("\n");
  console.log(`Sections:\n${sectionSummary}`);

  fs.writeFileSync(OUT_PATH, JSON.stringify(json, null, 2), "utf8");
  console.log(`\nWrote ${OUT_PATH}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
