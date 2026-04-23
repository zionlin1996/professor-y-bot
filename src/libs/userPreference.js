const { getDb } = require("./db");

async function getStealthMode(userId) {
  if (!userId) return false;
  const db = getDb();
  if (!db) return false;
  const pref = await db.userProfile.findUnique({ where: { id: String(userId) } });
  return pref?.stealthMode ?? false;
}

async function setStealthMode(userId, enabled, username) {
  const db = getDb();
  if (!db) return;
  const id = String(userId);
  await db.userProfile.upsert({
    where: { id },
    create: { id, username: username || null, stealthMode: enabled },
    update: { stealthMode: enabled, ...(username ? { username } : {}) },
  });
}

async function getPreferredModel(userId) {
  if (!userId) return null;
  const db = getDb();
  if (!db) return null;
  const pref = await db.userProfile.findUnique({ where: { id: String(userId) } });
  return pref?.preferredModel ?? null;
}

async function setPreferredModel(userId, model, username) {
  const db = getDb();
  if (!db) return;
  const id = String(userId);
  await db.userProfile.upsert({
    where: { id },
    create: { id, username: username || null, preferredModel: model },
    update: { preferredModel: model, ...(username ? { username } : {}) },
  });
}

module.exports = { getStealthMode, setStealthMode, getPreferredModel, setPreferredModel };
