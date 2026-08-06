export type CriterionKind = "hard" | "preference" | "information";
export type CriterionOperator = "gte" | "lte" | "eq" | "known";

export interface Criterion {
  readonly key: string;
  readonly kind: CriterionKind;
  readonly operator: CriterionOperator;
  readonly value: boolean | number | string;
  readonly weight: number;
}

export interface VehicleStrategy {
  readonly key:
    | "standing_van"
    | "sleepable_awd_van"
    | "sleepable_minivan"
    | "small_reliable_car";
  readonly rank: number;
  readonly description: string;
}

export interface CriteriaVersion {
  readonly version: string;
  readonly createdAt: string;
  readonly source: "user_brief";
  readonly vehicleStrategies: readonly VehicleStrategy[];
  readonly constraints: readonly Criterion[];
}

export function initialCriteriaVersion(): CriteriaVersion {
  return {
    version: "criteria-v1",
    createdAt: "2026-08-06T00:00:00.000Z",
    source: "user_brief",
    vehicleStrategies: [
      {
        key: "standing_van",
        rank: 1,
        description: "Van with a two-metre bed and ideally standing room.",
      },
      {
        key: "sleepable_awd_van",
        rank: 2,
        description:
          "All-terrain van or minivan with a two-metre sleeping area.",
      },
      {
        key: "sleepable_minivan",
        rank: 3,
        description: "Road-oriented minivan with a two-metre sleeping area.",
      },
      {
        key: "small_reliable_car",
        rank: 4,
        description: "Reliable, liquid small car that can carry camping gear.",
      },
    ],
    constraints: [
      {
        key: "sleeping_length_mm",
        kind: "hard",
        operator: "gte",
        value: 2000,
        weight: 100,
      },
      {
        key: "interior_height_mm",
        kind: "preference",
        operator: "gte",
        value: 1900,
        weight: 30,
      },
      {
        key: "reliability",
        kind: "preference",
        operator: "known",
        value: true,
        weight: 25,
      },
      {
        key: "resale_liquidity_georgia",
        kind: "preference",
        operator: "known",
        value: true,
        weight: 20,
      },
      {
        key: "budget",
        kind: "information",
        operator: "known",
        value: true,
        weight: 0,
      },
    ],
  };
}
