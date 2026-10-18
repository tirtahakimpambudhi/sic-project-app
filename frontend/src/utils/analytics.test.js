import assert from "node:assert/strict";
import test from "node:test";
import {
  formatLocationSubtitle,
  formatMinutes,
  formatNumber,
  formatPercent,
  getDatePreset,
  toDateString,
} from "./analytics.js";

test("formatNumber formats indonesian numbers correctly", () => {
  assert.equal(formatNumber(1250), "1.250");
  assert.equal(formatNumber(0), "0");
  assert.equal(formatNumber(null), "0");
});

test("formatPercent formats percentages with one decimal", () => {
  assert.equal(formatPercent(85.5), "85,5%");
  assert.equal(formatPercent(100), "100%");
  assert.equal(formatPercent(null), "0%");
});

test("formatMinutes formats various durations in indonesian", () => {
  assert.equal(formatMinutes(0.5), "30 dtk");
  assert.equal(formatMinutes(15.2), "15,2 mnt");
  assert.equal(formatMinutes(60), "1 jam");
  assert.equal(formatMinutes(75), "1 jam 15 mnt");
  assert.equal(formatMinutes(null), "-");
});

test("formatLocationSubtitle builds subtitle correctly with max 3 locations", () => {
  const locs = [
    { lokasi: "Titik A", koordinat: "-6.20000, 106.80000" },
    { lokasi: "Titik B", koordinat: "-6.21000, 106.81000" },
    { lokasi: "Titik C", koordinat: "-6.22000, 106.82000" },
    { lokasi: "Titik D", koordinat: "-6.23000, 106.83000" },
  ];
  const subtitle = formatLocationSubtitle(locs);
  assert.ok(subtitle.includes("Titik A (-6.20000, 106.80000)"));
  assert.ok(subtitle.includes("Titik B (-6.21000, 106.81000)"));
  assert.ok(subtitle.includes("Titik C (-6.22000, 106.82000)"));
  assert.ok(subtitle.includes("(+1 lokasi lain)"));
  assert.ok(!subtitle.includes("Titik D"));
});

test("getDatePreset returns 14 days interval by default", () => {
  const preset = getDatePreset(14);
  assert.ok(preset.start);
  assert.ok(preset.end);
  const diffDays = Math.round((new Date(preset.end) - new Date(preset.start)) / (1000 * 3600 * 24));
  assert.equal(diffDays, 13);
});
