import { describe, expect, it } from "vitest";

import { parseAutoGeListingText } from "../src/autoge/listing-parser.js";

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
    });
  });
});
