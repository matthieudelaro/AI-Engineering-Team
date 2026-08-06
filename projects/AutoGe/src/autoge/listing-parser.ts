import { z } from "zod";

const listingInputSchema = z.object({
  url: z.url().refine((url) => new URL(url).hostname === "www.auto.ge"),
  text: z.string().min(1),
});

export interface AutoGeListingObservation {
  readonly listingId: string;
  readonly url: string;
  readonly make: string;
  readonly model: string;
  readonly priceAmount?: number;
  readonly priceCurrency?: "GEL" | "USD";
  readonly year?: number;
  readonly mileage?: number;
  readonly mileageUnit?: "km" | "miles";
  readonly drivetrain?: string;
  readonly customsStatus?: string;
  readonly location?: string;
  readonly referenceNumber?: string;
  readonly postedAtText?: string;
}

const LISTING_ID_PATTERN = /-(?<listingId>[0-9]+)\.html$/;

export function parseAutoGeListingText(
  input: z.input<typeof listingInputSchema>,
): AutoGeListingObservation {
  const { url, text } = listingInputSchema.parse(input);
  const listingId = LISTING_ID_PATTERN.exec(new URL(url).pathname)?.groups
    ?.listingId;
  if (listingId === undefined) {
    throw new Error(`Cannot extract listing ID from URL: ${url}`);
  }

  const title = firstMeaningfulLine(text);
  const [make, model] = title.split(",").map((part) => part.trim());
  if (
    make === undefined ||
    model === undefined ||
    make === "" ||
    model === ""
  ) {
    throw new Error(
      `Cannot extract make and model from listing title: ${title}`,
    );
  }

  const priceMatch = /([0-9][0-9,]*(?:\.[0-9]{2})?)\s*(₾|\$)/.exec(text);
  const mileageMatch = /^Mileage\s*\n\s*([0-9]+)\s*(km|miles)$/im.exec(text);

  const priceAmount =
    priceMatch?.[1] === undefined
      ? undefined
      : Number.parseFloat(priceMatch[1].replaceAll(",", ""));
  const priceCurrency =
    priceMatch?.[2] === undefined
      ? undefined
      : priceMatch[2] === "₾"
        ? "GEL"
        : "USD";
  const year = parseOptionalInteger(valueAfterLabel(text, "Built"));
  const mileage =
    mileageMatch?.[1] === undefined ? undefined : Number(mileageMatch[1]);
  const mileageUnit = mileageMatch?.[2] as "km" | "miles" | undefined;
  const drivetrain = valueAfterLabel(text, "Drive Train");
  const customsStatus = valueAfterLabel(text, "Customs");
  const location = valueAfterLabel(text, "Location");
  const referenceNumber = valueAfterLabel(text, "Reference Number");
  const postedAtText = valueAfterLabel(text, "Posted");

  return {
    listingId,
    url,
    make,
    model,
    ...(priceAmount === undefined ? {} : { priceAmount }),
    ...(priceCurrency === undefined ? {} : { priceCurrency }),
    ...(year === undefined ? {} : { year }),
    ...(mileage === undefined ? {} : { mileage }),
    ...(mileageUnit === undefined ? {} : { mileageUnit }),
    ...(drivetrain === undefined ? {} : { drivetrain }),
    ...(customsStatus === undefined ? {} : { customsStatus }),
    ...(location === undefined ? {} : { location }),
    ...(referenceNumber === undefined ? {} : { referenceNumber }),
    ...(postedAtText === undefined ? {} : { postedAtText }),
  };
}

function firstMeaningfulLine(text: string): string {
  const line = text
    .split("\n")
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate.includes(","));
  if (line === undefined) {
    throw new Error("Listing text has no recognizable title.");
  }
  return line;
}

function valueAfterLabel(text: string, label: string): string | undefined {
  const lines = text.split("\n").map((line) => line.trim());
  const index = lines.findIndex((line) => line === label);
  const value = index < 0 ? undefined : lines[index + 1];
  return value === undefined || value === "" ? undefined : value;
}

function parseOptionalInteger(value: string | undefined): number | undefined {
  if (value === undefined || !/^[0-9]+$/.test(value)) {
    return undefined;
  }
  return Number(value);
}
