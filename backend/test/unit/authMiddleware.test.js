const test = require("node:test");
const assert = require("node:assert/strict");

const authenticateToken = require("../../middleware/authMiddleware");

test("only an exact Bearer authorization scheme is accepted", () => {
    assert.equal(authenticateToken.extractBearerToken("Bearer abc.def.ghi"), "abc.def.ghi");
    assert.equal(authenticateToken.extractBearerToken("bearer abc.def.ghi"), "abc.def.ghi");
    assert.equal(authenticateToken.extractBearerToken("Basic abc.def.ghi"), null);
    assert.equal(authenticateToken.extractBearerToken("Bearer"), null);
    assert.equal(authenticateToken.extractBearerToken("Bearer one two"), null);
});

