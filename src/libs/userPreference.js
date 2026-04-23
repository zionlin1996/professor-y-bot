const { getDb } = require("./db");

async function getStealthMode(userId) {
  if (!userId) return false;
  const db = getDb();
  if (!db) return false;
  const pref = await db.userProfile.findUnique({ where: { id: String(userId) } });
  return pref?.stealthMode ?? false;
}

async function setStealthMode(userId, enabled) {
  const db = getDb();
  if (!db) return false;
  const { count } = await db.userProfile.updateMany({
    where: { id: String(userId) },
    data: { stealthMode: enabled },
  });
  return count > 0;
}

async function getPreferredModel(userId) {
  if (!userId) return null;
  const db = getDb();
  if (!db) return null;
  const pref = await db.userProfile.findUnique({ where: { id: String(userId) } });
  return pref?.preferredModel ?? null;
}

async function setPreferredModel(userId, model) {
  const db = getDb();
  if (!db) return false;
  const { count } = await db.userProfile.updateMany({
    where: { id: String(userId) },
    data: { preferredModel: model },
  });
  return count > 0;
}

async function getPermissionLevel(userId) {
  if (!userId) return null;
  const db = getDb();
  if (!db) return null;
  const pref = await db.userProfile.findUnique({ where: { id: String(userId) } });
  return pref?.permissionLevel ?? null;
}

module.exports = { getStealthMode, setStealthMode, getPreferredModel, setPreferredModel, getPermissionLevel };
