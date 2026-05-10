function pmOnly(incoming) {
  return incoming.isGroup ? "" : null;
}

module.exports = pmOnly;
