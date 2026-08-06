import { describe, expect, it } from "vitest";

import {
  autoGeListingObservationSchema,
  parseAutoGeListingText,
} from "../src/autoge/listing-parser.js";

describe("parseAutoGeListingText", () => {
  it("extracts stable fields from an observed Delica listing", () => {
    const listing = parseAutoGeListingText({
      url: "https://www.auto.ge/en/auto/mitsubishi/delica/mitsubishi-delica-1564891.html",
      text: `
Mitsubishi, Delica
19,672.00 ₾
Reference Number
831082
Posted
Jul 28, 2026
Location
Tbilisi
Wheel
Right
Engine
3.0
Body Style
Offroad
Customs
Customs Passed
Built
2000
Transmission
Automatic
Drive Train
All Wheel Drive
Fuel
GASOLINE/PETROL
Mileage
292000 km
`,
    });

    expect(listing).toMatchObject({
      listingId: "1564891",
      make: "Mitsubishi",
      model: "Delica",
      priceAmount: 19672,
      priceCurrency: "GEL",
      year: 2000,
      mileage: 292000,
      mileageUnit: "km",
      drivetrain: "All Wheel Drive",
      customsStatus: "Customs Passed",
      location: "Tbilisi",
      phoneCollectionStatus: "not_checked",
      sellerPhoneNumbers: [],
    });
  });

  it("preserves, normalizes, and deduplicates displayed seller phone numbers", () => {
    const listing = parseAutoGeListingText({
      url: "https://www.auto.ge/en/auto/test/multi-phone-1000001.html",
      text: `
Test, Multi phone
Phone
555 000 001 / 555-000-001; 928
Reference Number
100001
`,
    });

    expect(listing.phoneCollectionStatus).toBe("observed");
    expect(listing.sellerPhoneNumbers).toEqual([
      {
        displayText: "555 000 001",
        digits: "555000001",
        e164: "+995555000001",
      },
      { displayText: "928", digits: "928" },
    ]);
  });

  it("extracts the M. Phone label used by live Auto.ge listing pages", () => {
    const listing = parseAutoGeListingText({
      url: "https://www.auto.ge/en/auto/test/live-label-1000005.html",
      text: `
Test, Live label
M. Phone:
(555) 000-005
Posted
Aug 06, 2026
`,
    });

    expect(listing).toMatchObject({
      phoneCollectionStatus: "observed",
      sellerPhoneNumbers: [
        {
          displayText: "(555) 000-005",
          digits: "555000005",
          e164: "+995555000005",
        },
      ],
    });
  });

  it("splits compact slash-separated phone numbers", () => {
    const listing = parseAutoGeListingText({
      url: "https://www.auto.ge/en/auto/test/compact-slash-1000006.html",
      text: `
Test, Compact slash
Phone
555000001/555000002
`,
    });

    expect(listing.sellerPhoneNumbers.map(({ digits }) => digits)).toEqual([
      "555000001",
      "555000002",
    ]);
  });

  it("recognizes a Georgian country code without guessing for other formats", () => {
    const listing = parseAutoGeListingText({
      url: "https://www.auto.ge/en/auto/test/country-code-1000002.html",
      text: `
Test, Country code
Phone Number: +995 (555) 000 002, 0555 000 003
`,
    });

    expect(listing.sellerPhoneNumbers).toEqual([
      {
        displayText: "+995 (555) 000 002",
        digits: "995555000002",
        e164: "+995555000002",
      },
      {
        displayText: "0555 000 003",
        digits: "0555000003",
      },
    ]);
  });

  it("distinguishes unavailable phone data from a listing that was not checked", () => {
    const unavailable = parseAutoGeListingText({
      url: "https://www.auto.ge/en/auto/test/unavailable-1000003.html",
      text: `
Test, Unavailable
Phone
Not available
`,
    });
    const notChecked = parseAutoGeListingText({
      url: "https://www.auto.ge/en/auto/test/not-checked-1000004.html",
      text: "Test, Not checked",
    });

    expect(unavailable).toMatchObject({
      phoneCollectionStatus: "not_available",
      sellerPhoneNumbers: [],
    });
    expect(notChecked).toMatchObject({
      phoneCollectionStatus: "not_checked",
      sellerPhoneNumbers: [],
    });
  });

  it("accepts 64 phone display characters and rejects 65", () => {
    const observation = {
      listingId: "1000007",
      url: "https://www.auto.ge/en/auto/test/display-boundary-1000007.html",
      make: "Test",
      model: "Display boundary",
      phoneCollectionStatus: "observed",
    } as const;
    const displayTextAtLimit = `${"(".repeat(61)}928`;

    expect(displayTextAtLimit).toHaveLength(64);
    expect(() =>
      autoGeListingObservationSchema.parse({
        ...observation,
        sellerPhoneNumbers: [
          { displayText: displayTextAtLimit, digits: "928" },
        ],
      }),
    ).not.toThrow();

    const displayTextOverLimit = `(${displayTextAtLimit}`;
    expect(displayTextOverLimit).toHaveLength(65);
    expect(() =>
      autoGeListingObservationSchema.parse({
        ...observation,
        sellerPhoneNumbers: [
          { displayText: displayTextOverLimit, digits: "928" },
        ],
      }),
    ).toThrow();
  });

  it.each([
    {
      name: "duplicate digits",
      phoneCollectionStatus: "observed",
      sellerPhoneNumbers: [
        { displayText: "555 000 001", digits: "555000001" },
        { displayText: "555-000-001", digits: "555000001" },
      ],
    },
    {
      name: "status without numbers",
      phoneCollectionStatus: "observed",
      sellerPhoneNumbers: [],
    },
    {
      name: "display and digits mismatch",
      phoneCollectionStatus: "observed",
      sellerPhoneNumbers: [{ displayText: "555 000 001", digits: "555000002" }],
    },
    {
      name: "unrelated E.164 value",
      phoneCollectionStatus: "observed",
      sellerPhoneNumbers: [
        {
          displayText: "555 000 001",
          digits: "555000001",
          e164: "+995555000002",
        },
      ],
    },
    {
      name: "E.164 for ambiguous digits",
      phoneCollectionStatus: "observed",
      sellerPhoneNumbers: [
        { displayText: "928", digits: "928", e164: "+99592800000" },
      ],
    },
    {
      name: "non-phone display content",
      phoneCollectionStatus: "observed",
      sellerPhoneNumbers: [{ displayText: "call 928", digits: "928" }],
    },
    {
      name: "unexpected phone metadata",
      phoneCollectionStatus: "observed",
      sellerPhoneNumbers: [
        { displayText: "928", digits: "928", accountNote: "private" },
      ],
    },
    {
      name: "excessive phone count",
      phoneCollectionStatus: "observed",
      sellerPhoneNumbers: Array.from({ length: 11 }, (_, index) => ({
        displayText: String(100 + index),
        digits: String(100 + index),
      })),
    },
  ])("rejects $name", ({ phoneCollectionStatus, sellerPhoneNumbers }) => {
    expect(() =>
      autoGeListingObservationSchema.parse({
        listingId: "1000007",
        url: "https://www.auto.ge/en/auto/test/invalid-1000007.html",
        make: "Test",
        model: "Invalid",
        phoneCollectionStatus,
        sellerPhoneNumbers,
      }),
    ).toThrow();
  });
});
