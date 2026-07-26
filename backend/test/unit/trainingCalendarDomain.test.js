const test = require("node:test");
const assert = require("node:assert/strict");

const {
    CALENDAR_DISPLAY_STATUSES,
    CALENDAR_ENTRY_STATUSES,
    DEFAULT_PERSONAL_TIMEZONE,
    MAX_CALENDAR_RANGE_DAYS,
    addDays,
    canTransitionCalendarStatus,
    daysBetween,
    deriveAvailableActions,
    deriveDisplayStatus,
    isValidDateOnly,
    isValidTimezone,
    isValidWeekInterval,
    isValidWeekday,
    isoWeekdayOf,
    resolvePersonalCreationStatus,
    scheduleRuleDatesInRange,
    scheduleRuleOccursOn,
    todayInTimezone
} = require("../../domain/trainingCalendarDomain");

test("fixed vocabularies are exactly the five persisted and full display statuses", () => {
    assert.deepEqual(CALENDAR_ENTRY_STATUSES, ["PLANNED", "IN_PROGRESS", "COMPLETED", "SKIPPED", "CANCELLED"]);
    assert.deepEqual(
        CALENDAR_DISPLAY_STATUSES,
        ["PLANNED", "DUE_TODAY", "OVERDUE", "IN_PROGRESS", "COMPLETED", "SKIPPED", "CANCELLED"]
    );
    assert.equal(MAX_CALENDAR_RANGE_DAYS, 93);
    assert.equal(DEFAULT_PERSONAL_TIMEZONE, "Europe/Zurich");
});

// ---- Timezone / DST ----

test("isValidTimezone accepts real IANA zones and rejects garbage", () => {
    assert.equal(isValidTimezone("Europe/Zurich"), true);
    assert.equal(isValidTimezone("Pacific/Auckland"), true);
    assert.equal(isValidTimezone("Not/AZone"), false);
    assert.equal(isValidTimezone(""), false);
    assert.equal(isValidTimezone(null), false);
    assert.equal(isValidTimezone(123), false);
});

test("todayInTimezone never uses new Date().toISOString().slice(0, 10) semantics - it resolves the actual local calendar date per zone", () => {
    // Same UTC instant, late night in UTC - Zurich (UTC+2 in July) and
    // Auckland (UTC+12) have already rolled over to the next day while a
    // naive toISOString().slice(0, 10) on the UTC instant would still say
    // the previous day.
    const lateNightUtc = new Date("2026-01-01T23:30:00Z");
    assert.equal(todayInTimezone("Europe/Zurich", lateNightUtc), "2026-01-02");
    assert.equal(todayInTimezone("Pacific/Auckland", lateNightUtc), "2026-01-02");
    assert.equal(lateNightUtc.toISOString().slice(0, 10), "2026-01-01", "sanity check: the naive UTC slice really does disagree");
});

test("todayInTimezone resolves correctly across a real DST transition instant", () => {
    // 2026-03-29 01:30 UTC is during the night Europe/Zurich springs
    // forward from CET (UTC+1) to CEST (UTC+2); a zone-naive implementation
    // could plausibly get the date wrong right at the boundary.
    const dstInstant = new Date("2026-03-29T01:30:00Z");
    assert.equal(todayInTimezone("Europe/Zurich", dstInstant), "2026-03-29");
    // A zone far enough behind UTC is still on the previous day at this instant.
    assert.equal(todayInTimezone("Pacific/Midway", dstInstant), "2026-03-28");
});

test("todayInTimezone rejects an invalid timezone rather than silently falling back", () => {
    assert.throws(() => todayInTimezone("Not/AZone"), TypeError);
});

// ---- Display status derivation ----

test("deriveDisplayStatus only transforms PLANNED - every other persisted status passes through unchanged", () => {
    for (const status of ["IN_PROGRESS", "COMPLETED", "SKIPPED", "CANCELLED"]) {
        assert.equal(deriveDisplayStatus(status, "2026-01-01", "2026-06-15"), status);
    }
});

test("deriveDisplayStatus: PLANNED today is DUE_TODAY, PLANNED in the past is OVERDUE, PLANNED in the future stays PLANNED", () => {
    assert.equal(deriveDisplayStatus("PLANNED", "2026-06-15", "2026-06-15"), "DUE_TODAY");
    assert.equal(deriveDisplayStatus("PLANNED", "2026-06-01", "2026-06-15"), "OVERDUE");
    assert.equal(deriveDisplayStatus("PLANNED", "2026-07-01", "2026-06-15"), "PLANNED");
});

// ---- Personal creation default status (Section 4) ----

test("resolvePersonalCreationStatus: future is always PLANNED regardless of any override", () => {
    assert.equal(resolvePersonalCreationStatus({ scheduledDate: "2026-07-01", today: "2026-06-15" }), "PLANNED");
    assert.equal(
        resolvePersonalCreationStatus({ scheduledDate: "2026-07-01", today: "2026-06-15", planAsUpcoming: false }),
        "PLANNED",
        "a future date can never be forced directly to COMPLETED - there is no path for that in this function's contract"
    );
});

test("resolvePersonalCreationStatus: past is always COMPLETED", () => {
    assert.equal(resolvePersonalCreationStatus({ scheduledDate: "2026-06-01", today: "2026-06-15" }), "COMPLETED");
    assert.equal(
        resolvePersonalCreationStatus({ scheduledDate: "2026-06-01", today: "2026-06-15", planAsUpcoming: true }),
        "COMPLETED",
        "planAsUpcoming is inert for a past date"
    );
});

test("resolvePersonalCreationStatus: today defaults to COMPLETED, but an explicit override keeps it PLANNED", () => {
    assert.equal(resolvePersonalCreationStatus({ scheduledDate: "2026-06-15", today: "2026-06-15" }), "COMPLETED");
    assert.equal(
        resolvePersonalCreationStatus({ scheduledDate: "2026-06-15", today: "2026-06-15", planAsUpcoming: true }),
        "PLANNED"
    );
});

// ---- Status transition matrix (Section 14) ----

test("status transition matrix allows exactly the documented transitions", () => {
    assert.equal(canTransitionCalendarStatus("PLANNED", "IN_PROGRESS"), true);
    assert.equal(canTransitionCalendarStatus("PLANNED", "COMPLETED"), true);
    assert.equal(canTransitionCalendarStatus("PLANNED", "SKIPPED"), true);
    assert.equal(canTransitionCalendarStatus("PLANNED", "CANCELLED"), true);
    assert.equal(canTransitionCalendarStatus("PLANNED", "PLANNED"), true, "reschedule keeps the entry PLANNED");
    assert.equal(canTransitionCalendarStatus("IN_PROGRESS", "COMPLETED"), true);
    assert.equal(canTransitionCalendarStatus("IN_PROGRESS", "PLANNED"), true, "an aborted session reverts its occurrence to PLANNED");
});

test("status transition matrix forbids every documented illegal transition", () => {
    assert.equal(canTransitionCalendarStatus("COMPLETED", "PLANNED"), false);
    assert.equal(canTransitionCalendarStatus("COMPLETED", "SKIPPED"), false);
    assert.equal(canTransitionCalendarStatus("COMPLETED", "CANCELLED"), false);
    assert.equal(canTransitionCalendarStatus("COMPLETED", "IN_PROGRESS"), false);
    assert.equal(canTransitionCalendarStatus("SKIPPED", "PLANNED"), false, "no reschedule-from-skipped support in this phase");
    assert.equal(canTransitionCalendarStatus("CANCELLED", "PLANNED"), false, "no reschedule-from-cancelled support in this phase");
    assert.equal(canTransitionCalendarStatus("IN_PROGRESS", "CANCELLED"), false);
    assert.equal(canTransitionCalendarStatus("IN_PROGRESS", "SKIPPED"), false);
});

test("status transition matrix has no self-transitions for terminal statuses", () => {
    for (const status of ["COMPLETED", "SKIPPED", "CANCELLED"]) {
        assert.equal(canTransitionCalendarStatus(status, status), false);
    }
});

// ---- availableActions derivation (Section 11) ----

test("availableActions for a plannable personal entry offers complete/skip/cancel/reschedule, never start", () => {
    for (const displayStatus of ["PLANNED", "DUE_TODAY", "OVERDUE"]) {
        const actions = deriveAvailableActions({ displayStatus, sourceType: "personal" });
        assert.deepEqual([...actions].sort(), ["CANCEL", "COMPLETE", "RESCHEDULE", "SKIP"]);
    }
});

test("availableActions for a plannable studio entry offers start/skip/cancel, never complete or reschedule directly", () => {
    for (const displayStatus of ["PLANNED", "DUE_TODAY", "OVERDUE"]) {
        const actions = deriveAvailableActions({ displayStatus, sourceType: "studio" });
        assert.deepEqual([...actions].sort(), ["CANCEL", "SKIP", "START"]);
    }
});

test("availableActions for IN_PROGRESS offers complete and view, for COMPLETED only view (if linked)", () => {
    assert.deepEqual(deriveAvailableActions({ displayStatus: "IN_PROGRESS", sourceType: "studio" }), ["COMPLETE", "VIEW_WORKOUT"]);
    assert.deepEqual(deriveAvailableActions({ displayStatus: "COMPLETED", sourceType: "personal", hasLinkedWorkout: true }), ["VIEW_WORKOUT"]);
    assert.deepEqual(deriveAvailableActions({ displayStatus: "COMPLETED", sourceType: "personal", hasLinkedWorkout: false }), []);
});

test("availableActions for SKIPPED/CANCELLED is always empty - no actions on a terminal, non-completed entry", () => {
    assert.deepEqual(deriveAvailableActions({ displayStatus: "SKIPPED", sourceType: "personal" }), []);
    assert.deepEqual(deriveAvailableActions({ displayStatus: "CANCELLED", sourceType: "studio" }), []);
});

// ---- Weekday / interval math ----

test("isoWeekdayOf uses a Monday=0..Sunday=6 convention matching the existing frontend calendar grid", () => {
    assert.equal(isoWeekdayOf("2026-06-15"), 0, "2026-06-15 is a Monday");
    assert.equal(isoWeekdayOf("2026-06-21"), 6, "2026-06-21 is a Sunday");
});

test("isValidWeekday/isValidWeekInterval enforce their documented bounds", () => {
    assert.equal(isValidWeekday(0), true);
    assert.equal(isValidWeekday(6), true);
    assert.equal(isValidWeekday(7), false);
    assert.equal(isValidWeekday(-1), false);
    assert.equal(isValidWeekday(1.5), false);
    assert.equal(isValidWeekInterval(1), true);
    assert.equal(isValidWeekInterval(52), true);
    assert.equal(isValidWeekInterval(0), false);
    assert.equal(isValidWeekInterval(53), false);
});

test("scheduleRuleOccursOn matches a weekly rule (weekInterval=1) on every matching weekday within the active window", () => {
    const rule = { weekday: 0, weekInterval: 1, anchorDate: "2026-06-01", activeFrom: "2026-06-01", activeUntil: null };
    assert.equal(scheduleRuleOccursOn(rule, "2026-06-15"), true, "a Monday");
    assert.equal(scheduleRuleOccursOn(rule, "2026-06-16"), false, "a Tuesday");
    assert.equal(scheduleRuleOccursOn(rule, "2026-05-25"), false, "before activeFrom, even though it's a Monday");
});

test("scheduleRuleOccursOn respects activeUntil", () => {
    const rule = { weekday: 0, weekInterval: 1, anchorDate: "2026-06-01", activeFrom: "2026-06-01", activeUntil: "2026-06-15" };
    assert.equal(scheduleRuleOccursOn(rule, "2026-06-15"), true, "on the boundary, still active");
    assert.equal(scheduleRuleOccursOn(rule, "2026-06-22"), false, "past activeUntil");
});

test("scheduleRuleOccursOn correctly computes every-Nth-week for weekInterval > 1", () => {
    // Anchor is a Monday; rule fires every 2nd week from that Monday.
    const rule = { weekday: 0, weekInterval: 2, anchorDate: "2026-06-01", activeFrom: "2026-06-01", activeUntil: null };
    assert.equal(scheduleRuleOccursOn(rule, "2026-06-01"), true, "anchor week itself");
    assert.equal(scheduleRuleOccursOn(rule, "2026-06-08"), false, "one week later - skipped");
    assert.equal(scheduleRuleOccursOn(rule, "2026-06-15"), true, "two weeks later - fires again");
    assert.equal(scheduleRuleOccursOn(rule, "2026-06-22"), false, "three weeks later - skipped");
    assert.equal(scheduleRuleOccursOn(rule, "2026-06-29"), true, "four weeks later - fires again");
});

test("scheduleRuleDatesInRange returns every matching date within [from, to], intersected with the rule's own window", () => {
    const rule = { weekday: 0, weekInterval: 1, anchorDate: "2026-06-01", activeFrom: "2026-06-01", activeUntil: null };
    const dates = scheduleRuleDatesInRange(rule, "2026-06-01", "2026-06-30");
    assert.deepEqual(dates, ["2026-06-01", "2026-06-08", "2026-06-15", "2026-06-22", "2026-06-29"]);
});

test("scheduleRuleDatesInRange never generates dates outside the requested range, even for an open-ended rule (no infinite generation)", () => {
    const rule = { weekday: 0, weekInterval: 1, anchorDate: "2020-01-01", activeFrom: "2020-01-01", activeUntil: null };
    // A rule active since 2020 with no end date, queried for a bounded
    // 93-day-or-less window far in the future, must produce only dates
    // inside that window - proving materialization is always bounded by the
    // caller's own range, never by how long the rule has existed.
    const dates = scheduleRuleDatesInRange(rule, "2030-01-01", "2030-01-31");
    assert.ok(dates.length <= 5);
    for (const date of dates) {
        assert.ok(date >= "2030-01-01" && date <= "2030-01-31");
    }
});

test("scheduleRuleDatesInRange returns an empty array when the rule's window and the query range never overlap", () => {
    const rule = { weekday: 0, weekInterval: 1, anchorDate: "2026-01-01", activeFrom: "2026-01-01", activeUntil: "2026-02-01" };
    assert.deepEqual(scheduleRuleDatesInRange(rule, "2026-06-01", "2026-06-30"), []);
});

// ---- Date helpers / range validation support ----

test("isValidDateOnly accepts only YYYY-MM-DD strings", () => {
    assert.equal(isValidDateOnly("2026-06-15"), true);
    assert.equal(isValidDateOnly("2026-6-15"), false);
    assert.equal(isValidDateOnly("15-06-2026"), false);
    assert.equal(isValidDateOnly(""), false);
    assert.equal(isValidDateOnly(null), false);
});

test("addDays/daysBetween are consistent inverses and handle month/year boundaries", () => {
    assert.equal(addDays("2026-06-30", 1), "2026-07-01");
    assert.equal(addDays("2026-12-31", 1), "2027-01-01");
    assert.equal(daysBetween("2026-06-01", "2026-06-30"), 29);
    assert.equal(daysBetween("2026-01-01", "2026-01-01"), 0);
});

test("a 93-day range (MAX_CALENDAR_RANGE_DAYS) computed via daysBetween matches the documented inclusive-range formula", () => {
    const from = "2026-01-01";
    const to = addDays(from, MAX_CALENDAR_RANGE_DAYS - 1);
    assert.equal(daysBetween(from, to) + 1, MAX_CALENDAR_RANGE_DAYS);
});
