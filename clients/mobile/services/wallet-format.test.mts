import assert from "node:assert/strict";
import { countryFlag, currencyDisplay, formatAmount, formatMinor, formatMoney } from "./wallet-format";

// Exact for any size, grouping per locale, decimals per currency
assert.equal(formatMinor("84250", "USD", "en-US"), "842.50");
assert.equal(formatMinor("123456789", "USD", "en-US"), "1,234,567.89");
assert.equal(formatMinor("-5", "USD", "en-US"), "-0.05");
assert.equal(formatMinor("9007199254740993", "USD", "en-US"), "90,071,992,547,409.93"); // beyond double precision, still exact
assert.equal(formatMinor("1500", "JPY", "en-US"), "1,500");                              // zero-decimal currency
assert.equal(formatMinor("123456789", "USD", "de-DE"), "1.234.567,89");
assert.equal(formatMinor("123456789", "USD", "fr-FR").replace(/\s/g, " "), "1 234 567,89");

// Symbols: distinctive symbols stand alone; shared or missing ones carry the ISO code
assert.equal(formatMoney("84250", "USD", "en-US"), "$842.50 USD");
assert.equal(formatMoney("2500", "CAD", "en-US"), "$25.00 CAD");
assert.equal(formatMoney("2500", "GBP", "en-US"), "£25.00 GBP");
assert.equal(formatMoney("2500", "EUR", "en-US"), "€25.00");
assert.equal(formatMoney("2500", "INR", "en-US"), "₹25.00");
const ghs = formatMoney("2500", "GHS", "en-US");
assert.ok(ghs.includes("25.00") && /₵/.test(ghs), `GHS shows the cedi sign: ${ghs}`);
assert.equal(formatMoney("-2500", "EUR", "en-US"), "-€25.00");

// formatAmount: symbol and number only; the caller shows the ISO code separately
assert.equal(formatAmount("5000", "USD", "en-US"), "$50.00");
assert.equal(formatAmount("-5000", "USD", "en-US"), "-$50.00");
assert.equal(formatAmount("2500", "XOF", "en-US").replace(/[^0-9.,]/g, ""), "2,500");

// The code is always available alongside the symbol for the wallet card
assert.deepEqual(currencyDisplay("USD", "en-US"), { code: "USD", symbol: "$", ambiguous: true });
assert.equal(currencyDisplay("EUR", "en-US").ambiguous, false);
assert.equal(currencyDisplay("XOF", "en-US").code, "XOF");

// Flags
assert.equal(countryFlag("GH"), "🇬🇭");
assert.equal(countryFlag("us"), "🇺🇸");
assert.equal(countryFlag("USA"), "");
assert.equal(countryFlag(null), "");
console.log("wallet-format: ok");
