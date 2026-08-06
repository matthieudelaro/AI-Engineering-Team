import { z } from "zod";

const listingInputSchema = z.object({
  url: z.url().refine((url) => new URL(url).hostname === "www.auto.ge"),
  text: z.string().min(1),
});

const MAX_SELLER_PHONE_NUMBERS = 10;
const MAX_PHONE_DISPLAY_TEXT_LENGTH = 64;
const PHONE_DISPLAY_PATTERN = /^[-+0-9 \t\u00a0().,/;|]+$/;

export const phoneCollectionStatusSchema = z.enum([
  "observed",
  "not_available",
  "not_checked",
]);

export const sellerPhoneNumberSchema = z
  .object({
    displayText: z
      .string()
      .min(1)
      .max(MAX_PHONE_DISPLAY_TEXT_LENGTH)
      .regex(PHONE_DISPLAY_PATTERN),
    digits: z.string().regex(/^[0-9]{3,15}$/),
    e164: z
      .string()
      .regex(/^\+[1-9][0-9]{7,14}$/)
      .optional(),
  })
  .strict()
  .superRefine(({ displayText, digits, e164 }, context) => {
    if (digitsOnly(displayText) !== digits) {
      context.addIssue({
        code: "custom",
        message: "Phone digits must match the displayed value.",
        path: ["digits"],
      });
    }

    if (e164 !== undefined && e164 !== toGeorgianMobileE164(digits)) {
      context.addIssue({
        code: "custom",
        message:
          "E.164 must be the exact normalization of an unambiguous Georgian mobile number.",
        path: ["e164"],
      });
    }
  });

export const sellerPhoneNumbersSchema = z
  .array(sellerPhoneNumberSchema)
  .max(MAX_SELLER_PHONE_NUMBERS);

export const autoGeListingObservationSchema = z
  .object({
    listingId: z.string().regex(/^[0-9]+$/),
    url: z.url(),
    make: z.string().min(1),
    model: z.string().min(1),
    priceAmount: z.number().nonnegative().optional(),
    priceCurrency: z.enum(["GEL", "USD"]).optional(),
    year: z.int().positive().optional(),
    mileage: z.number().nonnegative().optional(),
    mileageUnit: z.enum(["km", "miles"]).optional(),
    drivetrain: z.string().min(1).optional(),
    customsStatus: z.string().min(1).optional(),
    location: z.string().min(1).optional(),
    referenceNumber: z.string().min(1).optional(),
    postedAtText: z.string().min(1).optional(),
    phoneCollectionStatus: phoneCollectionStatusSchema,
    sellerPhoneNumbers: sellerPhoneNumbersSchema,
  })
  .strict()
  .superRefine(({ phoneCollectionStatus, sellerPhoneNumbers }, context) => {
    const hasNumbers = sellerPhoneNumbers.length > 0;
    if ((phoneCollectionStatus === "observed") !== hasNumbers) {
      context.addIssue({
        code: "custom",
        message: "Phone collection status and phone numbers are inconsistent.",
        path: ["phoneCollectionStatus"],
      });
    }

    const uniqueDigits = new Set(
      sellerPhoneNumbers.map((phoneNumber) => phoneNumber.digits),
    );
    if (uniqueDigits.size !== sellerPhoneNumbers.length) {
      context.addIssue({
        code: "custom",
        message: "Seller phone numbers must be unique by digits.",
        path: ["sellerPhoneNumbers"],
      });
    }
  });

export type PhoneCollectionStatus = z.infer<typeof phoneCollectionStatusSchema>;
export type SellerPhoneNumber = z.infer<typeof sellerPhoneNumberSchema>;
export type AutoGeListingObservation = z.infer<
  typeof autoGeListingObservationSchema
>;

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
  const phoneObservation = parseSellerPhoneNumbers(text);

  return autoGeListingObservationSchema.parse({
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
    ...phoneObservation,
  });
}

const PHONE_LABEL_PATTERN =
  /^(?:m\.?\s*phone|phone(?: number)?|telephone)(?:\s*:\s*(.*))?$/i;
const PHONE_SEPARATOR_PATTERN = /\s*(?:,|;|\||\/)\s*/;

function parseSellerPhoneNumbers(text: string): {
  readonly phoneCollectionStatus: PhoneCollectionStatus;
  readonly sellerPhoneNumbers: SellerPhoneNumber[];
} {
  const lines = text.split(/\r?\n/);
  const displayValues: string[] = [];
  let foundPhoneLabel = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? "";
    const labelMatch = PHONE_LABEL_PATTERN.exec(line);
    if (labelMatch === null) {
      continue;
    }

    foundPhoneLabel = true;
    const inlineValue = labelMatch[1]?.trim();
    if (inlineValue !== undefined && inlineValue !== "") {
      displayValues.push(...splitPhoneDisplayValues(inlineValue));
      continue;
    }

    for (
      let valueIndex = index + 1;
      valueIndex < lines.length;
      valueIndex += 1
    ) {
      const candidate = lines[valueIndex]?.trim() ?? "";
      if (candidate === "") {
        continue;
      }
      const candidateValues = splitPhoneDisplayValues(candidate);
      if (candidateValues.length === 0) {
        break;
      }
      displayValues.push(...candidateValues);
    }
  }

  const sellerPhoneNumbers = normalizePhoneDisplayValues(displayValues);
  return {
    phoneCollectionStatus:
      sellerPhoneNumbers.length > 0
        ? "observed"
        : foundPhoneLabel
          ? "not_available"
          : "not_checked",
    sellerPhoneNumbers,
  };
}

function splitPhoneDisplayValues(value: string): string[] {
  return value
    .split(PHONE_SEPARATOR_PATTERN)
    .map((part) => part.trim())
    .filter(isPhoneDisplayValue);
}

function isPhoneDisplayValue(value: string): boolean {
  const digits = digitsOnly(value);
  return (
    PHONE_DISPLAY_PATTERN.test(value) &&
    digits.length >= 3 &&
    digits.length <= 15
  );
}

function normalizePhoneDisplayValues(
  displayValues: readonly string[],
): SellerPhoneNumber[] {
  const uniqueByDigits = new Map<string, SellerPhoneNumber>();
  for (const displayText of displayValues) {
    const digits = digitsOnly(displayText);
    if (uniqueByDigits.has(digits)) {
      continue;
    }

    const e164 = toGeorgianMobileE164(digits);
    uniqueByDigits.set(digits, {
      displayText,
      digits,
      ...(e164 === undefined ? {} : { e164 }),
    });
  }
  return [...uniqueByDigits.values()];
}

function digitsOnly(value: string): string {
  return value.replaceAll(/[^0-9]/g, "");
}

function toGeorgianMobileE164(digits: string): string | undefined {
  if (/^5[0-9]{8}$/.test(digits)) {
    return `+995${digits}`;
  }
  if (/^9955[0-9]{8}$/.test(digits)) {
    return `+${digits}`;
  }
  return undefined;
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
