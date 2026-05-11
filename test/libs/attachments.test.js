const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { getLastImage } = require("../../src/libs/attachments");

describe("getLastImage — null / undefined input", () => {
  it("returns null for null", () => {
    assert.equal(getLastImage(null), null);
  });

  it("returns null for undefined", () => {
    assert.equal(getLastImage(undefined), null);
  });

  it("returns null for empty object", () => {
    assert.equal(getLastImage({}), null);
  });

  it("returns null for plain text message", () => {
    assert.equal(getLastImage({ text: "hello" }), null);
  });
});

describe("getLastImage — photo array", () => {
  it("returns the last (largest) photo size", () => {
    const msg = {
      photo: [
        { file_id: "small", width: 90 },
        { file_id: "medium", width: 320 },
        { file_id: "large", width: 800 },
      ],
    };
    assert.deepEqual(getLastImage(msg), { file_id: "large", width: 800 });
  });

  it("returns the only element when photo has one entry", () => {
    const msg = { photo: [{ file_id: "only" }] };
    assert.deepEqual(getLastImage(msg), { file_id: "only" });
  });
});

describe("getLastImage — document", () => {
  it("returns the document when mime_type starts with image/", () => {
    const doc = { file_id: "doc1", mime_type: "image/jpeg" };
    assert.deepEqual(getLastImage({ document: doc }), doc);
  });

  it("returns the document for image/png", () => {
    const doc = { file_id: "doc2", mime_type: "image/png" };
    assert.deepEqual(getLastImage({ document: doc }), doc);
  });

  it("returns null for non-image document mime_type", () => {
    const msg = { document: { file_id: "doc3", mime_type: "application/pdf" } };
    assert.equal(getLastImage(msg), null);
  });

  it("returns null when document has no mime_type", () => {
    const msg = { document: { file_id: "doc4" } };
    assert.equal(getLastImage(msg), null);
  });
});

describe("getLastImage — sticker", () => {
  it("returns the thumbnail when sticker has one", () => {
    const thumbnail = { file_id: "thumb1" };
    const msg = { sticker: { file_id: "sticker1", thumbnail } };
    assert.deepEqual(getLastImage(msg), thumbnail);
  });

  it("returns null when sticker has no thumbnail", () => {
    const msg = { sticker: { file_id: "sticker2" } };
    assert.equal(getLastImage(msg), null);
  });
});

describe("getLastImage — priority order", () => {
  it("photo takes priority over document", () => {
    const msg = {
      photo: [{ file_id: "photo" }],
      document: { file_id: "doc", mime_type: "image/png" },
    };
    assert.deepEqual(getLastImage(msg), { file_id: "photo" });
  });
});
