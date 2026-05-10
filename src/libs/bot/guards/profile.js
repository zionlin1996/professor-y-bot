function profile(incoming, services) {
  if (!incoming.userId) return "Unable to identify you.";
  if (!services.get("db")) return "Database not available.";
  return null;
}

module.exports = profile;
