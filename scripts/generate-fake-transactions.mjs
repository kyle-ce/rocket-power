// Deterministic fake bank data: 2024-01-01 .. 2025-12-31.
// Writes test/fixtures/fake-transactions.csv and fake-subscriptions.json (ground truth).
import { writeFileSync } from "node:fs";

let seed = 20240101;
function random() {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (min, max) => min + random() * (max - min);
const int = (min, max) => Math.floor(between(min, max + 1));
const pick = (items) => items[int(0, items.length - 1)];
const cents = (value) => Math.round(value * 100) / 100;

const pad = (value) => String(value).padStart(2, "0");
const iso = (date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const addDays = (date, days) => {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
  return next;
};
const START = new Date(2024, 0, 1);
const END = new Date(2025, 11, 31);

const rows = [];
const add = (date, description, amount, category, type = "expense") => {
  if (date < START || date > END) return;
  rows.push({ date: iso(date), description, amount: cents(amount), category, type });
};

// Billing lands on the same day each month, but weekends push it to Monday
// and some merchants drift by a day or two.
function monthlyCharges({ day, jitter = 0, weekendShift = false, priceFor }) {
  for (let index = 0; index < 24; index += 1) {
    const year = 2024 + Math.floor(index / 12);
    const month = index % 12;
    const lastDay = new Date(year, month + 1, 0).getDate();
    let date = new Date(year, month, Math.min(day, lastDay));
    if (jitter) date = addDays(date, int(-jitter, jitter));
    if (weekendShift) {
      if (date.getDay() === 6) date = addDays(date, 2);
      if (date.getDay() === 0) date = addDays(date, 1);
    }
    priceFor(index, year, month, date);
  }
}

const truth = [];
const subscription = (entry) => truth.push(entry);

// ---- Subscriptions ------------------------------------------------------
subscription({
  name: "Netflix", pattern: "NETFLIX", frequency: "Monthly", kind: "subscription",
  notes: "Price hike in 2025-03 ($15.49 -> $17.99).",
});
monthlyCharges({ day: 14, priceFor: (i, y, m, d) =>
  add(d, "NETFLIX.COM 866-579-7172 CA", i < 14 ? 15.49 : 17.99, "Entertainment") });

subscription({ name: "Hulu", pattern: "HULU", frequency: "Monthly", kind: "subscription", notes: "Bank adds phone/state noise." });
monthlyCharges({ day: 3, priceFor: (i, y, m, d) => add(d, "HULU 877-8244858 CA", 17.99, "Entertainment") });

subscription({ name: "GitHub", pattern: "GITHUB", frequency: "Monthly", kind: "subscription", notes: "Description contains a comma; weekend shifts." });
monthlyCharges({ day: 22, weekendShift: true, priceFor: (i, y, m, d) =>
  add(d, "GITHUB, INC. SAN FRANCISCO CA", 4, "Other") });

subscription({ name: "Discord Nitro", pattern: "DISCORD", frequency: "Monthly", kind: "subscription", notes: "Date drifts +-2 days." });
monthlyCharges({ day: 8, jitter: 2, priceFor: (i, y, m, d) =>
  add(d, "DISCORD* NITRO", 9.99, "Entertainment") });

subscription({ name: "AT&T", pattern: "AT&T|ATT\\*", frequency: "Monthly", kind: "bill", notes: "Amount varies ~$84-$93 from taxes/fees." });
monthlyCharges({ day: 25, priceFor: (i, y, m, d) =>
  add(d, "ATT*BILL PAYMENT", between(84, 93), "Bills & utilities") });

subscription({ name: "Navy Federal car insurance", pattern: "NAVY FEDERAL", frequency: "Monthly", kind: "bill", notes: "Premium rises at the 6-month renewal." });
monthlyCharges({ day: 1, weekendShift: true, priceFor: (i, y, m, d) =>
  add(d, "NAVY FEDERAL INS AUTO", i % 12 < 6 ? 142.37 : 151.9, "Bills & utilities") });

subscription({ name: "Spotify", pattern: "SPOTIFY", frequency: "Monthly", kind: "subscription", notes: "Price hike in 2025-01." });
monthlyCharges({ day: 17, priceFor: (i, y, m, d) =>
  add(d, "SPOTIFY USA", i < 12 ? 11.99 : 12.99, "Entertainment") });

subscription({ name: "iCloud", pattern: "APPLE\\.COM/BILL ICLOUD", frequency: "Monthly", kind: "subscription", notes: "Shares a merchant with one-off Apple purchases (decoys)." });
monthlyCharges({ day: 11, priceFor: (i, y, m, d) =>
  add(d, "APPLE.COM/BILL ICLOUD", 2.99, "Other") });

subscription({ name: "Planet Fitness", pattern: "PLANET FIT", frequency: "Monthly", kind: "subscription", notes: "Extra $49 annual fee each January with the same description." });
monthlyCharges({ day: 5, priceFor: (i, y, m, d) => {
  add(d, "PLANET FITNESS CLUB FEE", 24.99, "Health");
  if (m === 0) add(addDays(d, 3), "PLANET FITNESS CLUB FEE", 49, "Health");
} });

subscription({
  name: "Amazon Prime (annual)", pattern: "PRIME", frequency: "Yearly", kind: "subscription",
  detectableWithinYear: false,
  notes: "One charge per year ($139 -> $149). Needs cross-year history.",
});
add(new Date(2024, 3, 12), "AMAZON PRIME*MEMBERSHIP", 139, "Shopping");
add(new Date(2025, 3, 12), "AMAZON PRIME*MEMBERSHIP", 149, "Shopping");

// ---- Filler / decoys (must NOT be reported) -------------------------------
const days = [];
for (let date = new Date(START); date <= END; date = addDays(date, 1)) days.push(new Date(date));

for (const date of days) {
  // Near-daily coffee at a fixed price: frequent but not a subscription.
  if (random() < 0.38) add(date, "DUNKIN #348291", pick([5.49, 5.49, 5.49, 6.19, 4.89]), "Food & dining");
  if (random() < 0.12) add(date, "STARBUCKS STORE 1182", cents(between(4.2, 9.8)), "Food & dining");
  if (random() < 0.1) add(date, pick(["CHIPOTLE 2210", "MCDONALD'S F1873", "OLIVE GARDEN 0412", "TACO BELL 031", "PANERA BREAD #2201", "DOORDASH*ORDER"]), cents(between(9, 48)), "Food & dining");
  if (random() < 0.15) add(date, pick(["KROGER #512", "WAL-MART SUPERCENTER", "ALDI 77031", "PUBLIX #1204"]), cents(between(24, 165)), "Food & dining");
  if (random() < 0.12) add(date, pick(["SHELL OIL 574412", "EXXONMOBIL 4410", "SPEEDWAY 8827"]), cents(between(32, 62)), "Transport");
  if (random() < 0.05) add(date, "UBER *TRIP", cents(between(8, 34)), "Transport");
  if (random() < 0.09) add(date, pick(["AMAZON.COM*2K4LP", "TARGET 00019283", "HOME DEPOT #4107", "BEST BUY 00381"]), cents(between(8, 140)), "Shopping");
  if (random() < 0.015) add(date, "APPLE.COM/BILL APP STORE", pick([0.99, 1.99, 4.99, 9.99, 14.99, 2.99]), "Other");
  if (random() < 0.012) add(date, "CVS/PHARMACY #08821", cents(between(6, 45)), "Health");
}
// A fixed-price, same-weekday-ish habit that is NOT a subscription: car wash roughly every 3-6 weeks.
for (let date = new Date(2024, 0, 9); date <= END; date = addDays(date, int(21, 45))) {
  add(date, "MISTER CAR WASH #112", 18, "Transport");
}
// Variable utility, roughly monthly but swinging widely.
monthlyCharges({ day: 19, jitter: 3, priceFor: (i, y, m, d) =>
  add(d, "DUKE ENERGY BILL PAY", between(58, 190), "Bills & utilities") });
truth.push({
  name: "Duke Energy (variable utility)", pattern: "DUKE ENERGY", frequency: "Monthly", kind: "ambiguous",
  notes: "Monthly bill with a large amount swing. Reporting it is acceptable but not required.",
});

// Income
for (let date = new Date(2024, 0, 5); date <= END; date = addDays(date, 14)) {
  add(date, "ACME CORP PAYROLL", 2350, "Salary", "income");
}
add(new Date(2024, 11, 20), "BONUS ACME CORP", 1800, "Salary", "income");

rows.sort((a, b) => a.date.localeCompare(b.date) || a.description.localeCompare(b.description));

const quote = (value) => (/[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value);
const csv = [
  "Date,Description,Amount,Category,Type",
  ...rows.map((r) => [r.date, quote(r.description), r.amount.toFixed(2), r.category, r.type].join(",")),
].join("\n") + "\n";

writeFileSync(new URL("../test/fixtures/fake-transactions.csv", import.meta.url), csv);
writeFileSync(new URL("../test/fixtures/fake-subscriptions.json", import.meta.url), JSON.stringify(truth, null, 2) + "\n");
console.log(`${rows.length} transactions, ${truth.length} ground-truth entries`);
