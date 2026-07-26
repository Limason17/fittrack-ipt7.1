const test = require("node:test");
const assert = require("node:assert/strict");

const {
    validateCalendarRangeQuery,
    validateCreatePersonalEntryPayload,
    validateCreateScheduleRulePayload
} = require("../../validation/trainingCalendarValidation");

test("validateCalendarRangeQuery accepts a valid, bounded range and defaults the timezone", () => {
    const result = validateCalendarRangeQuery({ from: "2026-06-01", to: "2026-06-30" });
    assert.equal(result.from, "2026-06-01");
    assert.equal(result.to, "2026-06-30");
    assert.equal(result.timezone, "Europe/Zurich");
});

test("validateCalendarRangeQuery rejects an inverted range with CALENDAR_DATE_RANGE_INVALID", () => {
    assert.throws(
        () => validateCalendarRangeQuery({ from: "2026-06-30", to: "2026-06-01" }),
        (error) => error.code === "CALENDAR_DATE_RANGE_INVALID" && error.status === 400
    );
});

test("validateCalendarRangeQuery rejects a range wider than 93 days with CALENDAR_RANGE_TOO_LARGE", () => {
    assert.throws(
        () => validateCalendarRangeQuery({ from: "2026-01-01", to: "2026-12-31" }),
        (error) => error.code === "CALENDAR_RANGE_TOO_LARGE" && error.status === 400
    );
});

test("validateCalendarRangeQuery accepts an explicit valid timezone override", () => {
    const result = validateCalendarRangeQuery({ from: "2026-06-01", to: "2026-06-01", timezone: "Pacific/Auckland" });
    assert.equal(result.timezone, "Pacific/Auckland");
});

test("validateCalendarRangeQuery rejects an invalid timezone", () => {
    assert.throws(
        () => validateCalendarRangeQuery({ from: "2026-06-01", to: "2026-06-01", timezone: "Not/AZone" }),
        (error) => error.code === "VALIDATION_ERROR"
    );
});

test("validateCalendarRangeQuery rejects unknown query keys", () => {
    assert.throws(() => validateCalendarRangeQuery({ from: "2026-06-01", to: "2026-06-01", extra: "x" }));
});

test("validateCreatePersonalEntryPayload defaults planAsUpcoming to false and enforces title/notes limits", () => {
    const result = validateCreatePersonalEntryPayload({ scheduledDate: "2026-06-15", title: "Run" });
    assert.equal(result.planAsUpcoming, false);
    assert.equal(result.notes, null);

    assert.throws(() => validateCreatePersonalEntryPayload({
        scheduledDate: "2026-06-15", title: "x".repeat(161)
    }));
    assert.throws(() => validateCreatePersonalEntryPayload({
        scheduledDate: "2026-06-15", title: "Run", notes: "x".repeat(256)
    }), "notes must not exceed the underlying workouts.notes VARCHAR(255) column");
});

test("validateCreatePersonalEntryPayload rejects an invalid calendar date", () => {
    assert.throws(() => validateCreatePersonalEntryPayload({ scheduledDate: "2026-02-30", title: "Run" }));
});

test("validateCreateScheduleRulePayload defaults weekInterval to 1 and anchorDate to activeFrom", () => {
    const result = validateCreateScheduleRulePayload({
        programDayId: "11111111-1111-4111-8111-111111111111",
        weekday: 0,
        activeFrom: "2026-06-01"
    });
    assert.equal(result.weekInterval, 1);
    assert.equal(result.anchorDate, "2026-06-01");
    assert.equal(result.activeUntil, null);
});

test("validateCreateScheduleRulePayload rejects activeUntil before activeFrom", () => {
    assert.throws(() => validateCreateScheduleRulePayload({
        programDayId: "11111111-1111-4111-8111-111111111111",
        weekday: 0,
        activeFrom: "2026-06-15",
        activeUntil: "2026-06-01"
    }));
});

test("validateCreateScheduleRulePayload rejects an out-of-range weekday", () => {
    assert.throws(() => validateCreateScheduleRulePayload({
        programDayId: "11111111-1111-4111-8111-111111111111",
        weekday: 7,
        activeFrom: "2026-06-01"
    }));
});
