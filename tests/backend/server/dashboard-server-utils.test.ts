
import { expect, test } from "vitest";
import { parseNullableTrimmedString, parsePreviewSessionIdFromHost, parseProjectStatsQuery } from "../../../src/server/dashboard-server.js";

test("parseNullableTrimmedString", () => {




});

test("parsePreviewSessionIdFromHost", () => {


});

test("parseProjectStatsQuery values", () => {
    const result = parseProjectStatsQuery({ since: "2024-01-01T00:00:00Z", resolution: "day", intervalCount: "2" });




    const result2 = parseProjectStatsQuery({});


});
