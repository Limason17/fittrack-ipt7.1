const test = require("node:test");
const assert = require("node:assert/strict");

const {
    estimateOneRepMax,
    normalizeTrainingRows,
    nullableNonNegativeNumber,
    positiveInteger
} = require("../../utils/trainingMetrics");

test("Epley 1RM has explicit invalid and high-repetition boundaries", () => {
    assert.equal(estimateOneRepMax(100, 10), 100 * (1 + 10 / 30));
    assert.equal(estimateOneRepMax(100, 0), null);
    assert.equal(estimateOneRepMax(100, 101), null);
    assert.equal(estimateOneRepMax(Number.POSITIVE_INFINITY, 10), null);
});

test("numeric validators reject booleans, arrays and whitespace", () => {
    assert.equal(positiveInteger(true), null);
    assert.equal(positiveInteger([1]), null);
    assert.equal(nullableNonNegativeNumber(false), null);
    assert.equal(nullableNonNegativeNumber([12]), null);
    assert.equal(nullableNonNegativeNumber("   "), null);
});

test("malformed training rows are rejected without throwing", () => {
    assert.equal(normalizeTrainingRows([null]), null);
    assert.equal(normalizeTrainingRows([true]), null);
    assert.equal(normalizeTrainingRows([[]]), null);
});
