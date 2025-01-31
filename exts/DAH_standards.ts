import { DateTime, Duration } from "../deps.ts";
import {
  assert,
  combine,
  Context,
  Id,
  ifDefined,
  Impact,
  ImpactMeta,
  Matrix,
  newZeroVector,
  Relation,
  RelationMeta,
  ScalarMatrix,
  Vector,
} from "../mod.ts";
import { DiagonalMatrix } from "../src/math.ts";
import {
  Additional,
  AL,
  AM,
  AP,
  AU,
  AV,
  Boredom,
  CP,
  CU,
  Emotion,
  EmotionFactor,
  EmotionName,
  FactorScore,
  MP,
  MU,
} from "./DAH_factors.ts";
import { HasIRSourceMeta, IRSourceMeta } from "./DAH_ir_source.ts";

export type WeightedEmotions = [EmotionFactor, number][];
export type Contributors = Map<Id, Matrix>;
export enum Sign {
  Positive = 1,
  Negative = -1,
}

export function today(): DateTime {
  return DateTime.now();
}

export interface FromToPeriod {
  type: "fromto";
  from: DateTime;
  to: DateTime;
}

export interface DurationPeriod {
  type: "duration";
  length: Duration;
}

export type DatePeriod = FromToPeriod | DurationPeriod;

export type VisualTypeName =
  | "animated"
  | "rpg3dGame"
  | "animatedShort"
  | "animatedMV"
  | "visualNovel"
  | "manga"
  | "animatedGachaCardArt"
  | "gachaCardArt"
  | "lightNovel"
  | "semiAnimatedMV"
  | "staticMV"
  | "albumArt";
export class VisualType {
  static readonly Animated = new VisualType("animated", 1.0);
  static readonly RPG3DGame = new VisualType("rpg3dGame", 1.0);
  static readonly AnimatedShort = new VisualType("animatedShort", 0.8);
  static readonly AnimatedMV = new VisualType("animatedMV", 0.8);
  static readonly VisualNovel = new VisualType("visualNovel", 0.8);
  static readonly Manga = new VisualType("manga", 0.8);
  static readonly AnimatedGachaCardArt = new VisualType(
    "animatedGachaCardArt",
    0.7,
  );
  static readonly GachaCardArt = new VisualType("gachaCardArt", 0.6);
  static readonly LightNovel = new VisualType("lightNovel", 0.5);
  static readonly SemiAnimatedMV = new VisualType("semiAnimatedMV", 0.5);
  static readonly StaticMV = new VisualType("staticMV", 0.3);
  static readonly AlbumArt = new VisualType("albumArt", 0.25);

  private constructor(
    public readonly name: VisualTypeName,
    public readonly factor: number,
  ) {}
}

export class DAH_standards {
  config: Required<ExtConfig_DAH_standards>;
  constructor(config: ExtConfig_DAH_standards) {
    this.config = {
      averageAnimeEpisodeDuration: Duration.fromObject({ minutes: 20 }),
      ...config,
    };
  }

  dependencies(): string[] {
    return ["DAH_factors"];
  }

  #emotionVector(
    context: Context,
    baseScore: number,
    emotions: WeightedEmotions,
  ): Vector {
    assert(emotions.length > 0, "empty emotion list");

    const contribFactors = emotions.map(([_, factor]) => factor);
    const combinedFactor = combine(
      context,
      contribFactors,
      Emotion.subscoreWeight,
    );

    const vector = newZeroVector(context);
    for (const [emotion, factor] of emotions) {
      vector.data[emotion.factorIndex] = (baseScore * Math.pow(factor, 0.9)) /
        combinedFactor;
    }

    return vector;
  }

  #irMeta(
    meta: Omit<IRSourceMeta, "extension" | "version">,
  ): HasIRSourceMeta {
    return {
      DAH_ir_source: {
        extension: "DAH_standards",
        version: "1.1.1",
        ...meta,
      },
    };
  }

  #impactMeta(meta: Omit<IRSourceMeta, "extension" | "version">): ImpactMeta {
    return { ...this.#irMeta(meta) };
  }

  #relationMeta(
    meta: Omit<IRSourceMeta, "extension" | "version">,
  ): RelationMeta {
    return { ...this.#irMeta(meta) };
  }

  #emotionPairsToObject(emotions: WeightedEmotions): EmotionWeights {
    return Object.fromEntries(
      emotions.map(([emotion, weight]) => [emotion.name, weight]),
    );
  }

  #emotionMeta(base: number, emotions: WeightedEmotions): EmotionArgs {
    return {
      base,
      emotions: this.#emotionPairsToObject(emotions),
    };
  }

  emotion(
    context: Context,
    contributors: Contributors,
    base: number,
    emotions: WeightedEmotions,
    name = "emotion" as EIName,
    meta: Omit<IRSourceMeta, "extension" | "version" | "name"> = {},
  ): Impact {
    return {
      contributors,
      score: this.#emotionVector(context, base, emotions),
      DAH_meta: this.#impactMeta({
        name,
        emotionArgs: this.#emotionMeta(base, emotions),
        ...meta,
      }),
    };
  }

  cry(
    context: Context,
    contributors: Contributors,
    emotions: WeightedEmotions,
  ): Impact {
    return this.emotion(context, contributors, 4.0, emotions, "cry");
  }

  pads(
    context: Context,
    contributors: Contributors,
    periods: DatePeriod[],
    emotions: WeightedEmotions,
    singlePADS = true,
  ): Impact {
    // coefficients
    const a = 0.3,
      p = 1.3;
    const duration = this.#periodsLength(periods);
    const days = duration.as("days");
    const base = a * Math.pow(Math.min(10, days), p);

    const impact = this.emotion(
      context,
      contributors,
      base,
      emotions,
      "pads",
      {
        padsArgs: {
          duration,
          days,
          periods: periods.map((p) => this.#periodMeta(p)),
        },
      },
    );

    if (!singlePADS) {
      ifDefined(context.extensions.DAH_validator_suppress, (ext) => {
        ext.suppressRule(impact, "dah-lone-pads");
      });
    }

    return impact;
  }

  // common code for aei/nei
  xei(
    context: Context,
    contributors: Contributors,
    name = "xei" as XEIName,
    factor: number,
    sign: Sign,
    base: number,
    emotions: WeightedEmotions,
  ) {
    return this.emotion(context, contributors, base, emotions, name, {
      xeiArgs: {
        factor,
        sign: sign > 0 ? "positive" : "negative",
      },
    });
  }

  aei(
    context: Context,
    contributors: Contributors,
    factor: number,
    sign: Sign,
    emotions: WeightedEmotions,
  ): Impact {
    const base = mapClampThrow(Math.abs(factor), 0.0, 1.0, 2.0, 3.0) * sign;
    return this.xei(
      context,
      contributors,
      "aei",
      factor,
      sign,
      base,
      emotions,
    );
  }

  nei(
    context: Context,
    contributors: Contributors,
    factor: number,
    sign: Sign,
    emotions: WeightedEmotions,
  ) {
    const base = mapClampThrow(Math.abs(factor), 0.0, 1.0, 0.0, 2.0) * sign;
    return this.xei(
      context,
      contributors,
      "nei",
      factor,
      sign,
      base,
      emotions,
    );
  }

  maxAEIPADS(
    context: Context,
    contributors: Contributors,
    periods: DatePeriod[],
    emotions: WeightedEmotions,
  ): Impact[] {
    return [
      this.aei(context, contributors, 1.0, Sign.Positive, emotions),
      this.pads(context, contributors, periods, emotions, false),
    ];
  }

  cryPADS(
    context: Context,
    contributors: Contributors,
    periods: DatePeriod[],
    emotions: WeightedEmotions,
  ): Impact[] {
    return [
      this.cry(context, contributors, emotions),
      this.pads(context, contributors, periods, emotions, false),
    ];
  }

  waifu(
    context: Context,
    contributors: Contributors,
    waifu: string,
    periods: DatePeriod[],
  ) {
    const duration = this.#periodsLength(periods);
    const days = duration.as("days");
    const base = 1.2 * Math.pow(days / 90, MP.factorWeight);
    return this.emotion(context, contributors, base, [[MP, 1.0]], "waifu", {
      waifuArgs: {
        waifu,
        duration,
        days,
        periods: periods.map((p) => this.#periodMeta(p)),
      },
    });
  }

  ehi(context: Context, contributors: Contributors): Impact {
    return this.emotion(context, contributors, 3.5, [[AP, 1.0]], "ehi");
  }

  epi(context: Context, contributors: Contributors, factor: number): Impact {
    const base = mapClampThrow(factor, 0.0, 1.0, 3.5, 4.5);
    return this.emotion(context, contributors, base, [[AP, 1.0]], "epi", {
      epiArgs: {
        factor,
      },
    });
  }

  jumpscare(context: Context, contributors: Contributors): Impact {
    return this.emotion(
      context,
      contributors,
      1.0,
      [[MP, 1.0]],
      "jumpscare",
    );
  }

  sleeplessNight(context: Context, contributors: Contributors): Impact {
    return this.emotion(
      context,
      contributors,
      4.0,
      [[MP, 1.0]],
      "sleeplessNight",
    );
  }

  politics(context: Context, contributors: Contributors): Impact {
    return {
      contributors,
      score: vector(context, [[Additional, 0.75]]),
      DAH_meta: this.#impactMeta({
        name: "politics",
      }),
    };
  }

  interestField(
    context: Context,
    contributors: Contributors,
    newField: boolean,
  ): Impact {
    return {
      contributors,
      score: vector(context, [[Additional, newField ? 2.0 : 1.0]]),
      DAH_meta: this.#impactMeta({
        name: "interestField",
      }),
    };
  }

  consumed(
    context: Context,
    contributors: Contributors,
    boredom: number,
    duration: Duration,
    name = "consumed" as ConsumedImpactName,
    meta: Record<string, unknown> = {},
  ): Impact {
    const [baseType, baseScore, baseDuration] = (() => {
      if (duration < Duration.fromObject({ minutes: 10 })) {
        return [
          "tiny" as const,
          0.1,
          Duration.fromObject({ minutes: 5 }),
        ];
      } else if (duration < Duration.fromObject({ hours: 2 })) {
        return [
          "short" as const,
          0.3,
          Duration.fromObject({ hours: 2 }),
        ];
      } else {
        return [
          "long" as const,
          1.0,
          this.config.averageAnimeEpisodeDuration
            .mapUnits((x) => x * 12)
            .rescale(),
        ];
      }
    })();

    const ratio = duration.toMillis() / baseDuration.toMillis();
    const boredomScore = boredom * baseScore *
      Math.pow(ratio, Boredom.factorWeight);

    return {
      contributors,
      score: vector(context, [[Boredom, boredomScore]]),
      DAH_meta: this.#impactMeta({
        name,
        consumedArgs: {
          boredom,
          duration: duration.toISO()!,
          baseType,
          baseScore,
          baseDuration,
          ratio,
        },
        ...meta,
      }),
    };
  }

  animeConsumed(
    context: Context,
    contributors: Contributors,
    boredom: number,
    episodes: number,
    episodeDuration?: Duration,
  ) {
    episodeDuration = episodeDuration ??
      this.config.averageAnimeEpisodeDuration;
    return this.consumed(
      context,
      contributors,
      boredom,
      episodeDuration.mapUnits((x) => x * episodes).rescale(),
      "animeConsumed",
      {
        animeConsumedArgs: {
          episodes,
          episodeDuration,
        },
      },
    );
  }

  dropped(context: Context, contributors: Contributors): Impact {
    return {
      contributors,
      score: vector(context, [[Boredom, -0.5]]),
      DAH_meta: this.#impactMeta({
        name: "dropped",
      }),
    };
  }

  meme(
    context: Context,
    contributors: Contributors,
    strength: number,
    periods: DatePeriod[],
  ) {
    if (strength < 0.0 || strength >= 2.0) {
      throw new Error(`strength=${strength} not in [0, 2] range`);
    }

    const duration = this.#periodsLength(periods);
    const days = duration.as("days");
    const base = strength * Math.pow(days / 120, AP.factorWeight) * 4.0;

    return this.emotion(context, contributors, base, [[AP, 1.0]], "meme", {
      memeArgs: {
        strength,
        periods: periods.map((p) => this.#periodMeta(p)),
        duration: duration.toISO()!,
      },
    });
  }

  additional(
    context: Context,
    contributors: Contributors,
    value: number,
    description: string,
  ): Impact {
    return {
      contributors,
      score: vector(context, [[Additional, value]]),
      DAH_meta: this.#impactMeta({
        name: "additional",
        additionalArgs: {
          description,
        },
      }),
    };
  }

  music(
    context: Context,
    contributors: Contributors,
    // temp standard: 0.5 for Re:Rays (https://www.youtube.com/watch?v=ZJhsfUYThoA, https://projectrst.fandom.com/wiki/Re:Rays)
    musicBase: number,
  ): Impact {
    return {
      contributors,
      score: vector(context, [[AM, musicBase * 3.0]]),
      DAH_meta: this.#impactMeta({
        name: "music",
        musicArgs: {
          musicBase,
        },
      }),
    };
  }

  visual(
    context: Context,
    contributors: Contributors,
    visualType: VisualType,
    base: number,
    unique: number,
  ): Impact {
    const visualScore = ((base * (unique + 2.0)) / 3.0) * visualType.factor *
      2.0;

    return {
      contributors,
      score: vector(context, [[AV, visualScore]]),
      DAH_meta: this.#impactMeta({
        name: "visual",
        visualArgs: {
          visualType: visualType.name,
          base,
          unique,
        },
      }),
    };
  }

  osuSong(
    context: Context,
    contributors: Contributors,
    personal: number,
    community: number,
  ): Impact {
    const personalFactor = mapClampThrow(personal, 0.0, 1.0, 0.0, 0.5);
    const communityFactor = mapClampThrow(community, 0.0, 1.0, 0.0, 0.2);

    return {
      contributors,
      score: vector(context, [[AP, personalFactor + communityFactor]]),
      DAH_meta: this.#impactMeta({
        name: "osuSong",
        osuSongArgs: {
          personal,
          community,
        },
      }),
    };
  }

  writing(
    context: Context,
    contributors: Contributors,
    characterComplexity: number,
    storyQuality: number,
    pacing: number,
    originality: number,
  ): Impact {
    characterComplexity = mapClampThrow(
      characterComplexity,
      0.0,
      1.0,
      0.0,
      1.0,
    );
    storyQuality = mapClampThrow(storyQuality, 0.0, 1.0, 0.0, 1.0);
    pacing = mapClampThrow(pacing, 0.0, 1.0, 0.0, 1.0);
    originality = mapClampThrow(originality, 0.0, 1.0, 0.0, 1.0);

    const M = 4.0;
    const baseScore = M * (characterComplexity + storyQuality) / 2 *
      (1 + pacing) / 2 * (1 + originality) / 2;
    return {
      contributors,
      score: vector(context, [[AL, baseScore]]),
      DAH_meta: this.#impactMeta({
        name: "writing",
        writingArgs: {
          characterComplexity,
          storyQuality,
          pacing,
          originality,
        },
      }),
    };
  }

  featureMusic(
    context: Context,
    contributors: Contributors,
    reference: Id,
  ): Relation {
    return {
      contributors,
      references: new Map([
        [reference, DiagonalMatrix.fromFactors([[AM, 0.2]])],
      ]),
      DAH_meta: this.#relationMeta({
        name: "featureMusic",
      }),
    };
  }

  remix(
    context: Context,
    contributors: Contributors,
    reference: Id,
  ): Relation {
    return {
      contributors,
      references: new Map([[reference, new ScalarMatrix(0.2)]]),
      DAH_meta: this.#relationMeta({
        name: "remix",
      }),
    };
  }

  killedBy(
    context: Context,
    contributors: Contributors,
    reference: Id,
    potential: number,
    effect: number,
  ): Relation {
    return {
      contributors,
      references: new Map([
        [
          reference,
          DiagonalMatrix.fromFactors([
            [AP, 0.2 * potential * effect * 2.0],
            [AU, 0.1 * potential * effect * 2.0],
            [CP, 0.05 * potential * effect * 2.0],
            [CU, 0.05 * potential * effect * 2.0],
            [MP, 0.2 * potential * effect * 2.0],
            [MU, 0.1 * potential * effect * 2.0],
            [AV, 0.0 * potential * effect * 2.0],
            [AL, 0.1 * potential * effect * 2.0],
            [AM, 0.1 * potential * effect * 2.0],
            [Boredom, 0.1 * potential * effect * 2.0],
            [Additional, 0.0 * potential * effect * 2.0],
          ]),
        ],
      ]),
      DAH_meta: this.#relationMeta({
        name: "killedBy",
      }),
    };
  }

  gateOpen(
    context: Context,
    contributors: Contributors,
    reference: Id,
  ): Relation {
    return {
      contributors,
      references: new Map([[reference, new ScalarMatrix(0.0)]]),
      DAH_meta: this.#relationMeta({
        name: "gateOpen",
      }),
    };
  }

  #periodLength(period: DatePeriod): Duration {
    switch (period.type) {
      case "duration":
        return period.length;
      case "fromto":
        return period.to.diff(period.from).rescale();
    }
  }

  #periodsLength(periods: Iterable<DatePeriod>): Duration {
    let duration = Duration.fromMillis(0);
    for (const period of periods) {
      duration = duration.plus(this.#periodLength(period));
    }
    return duration;
  }

  #periodMeta(period: DatePeriod): PeriodMeta {
    switch (period.type) {
      case "duration":
        return {
          type: "duration",
          duration: period.length.toISO()!,
        };
      case "fromto":
        return {
          type: "fromto",
          from: period.from,
          to: period.to,
          duration: period.to.diff(period.from).rescale().toISO()!,
        };
    }
  }
}

export interface ExtConfig_DAH_standards {
  averageAnimeEpisodeDuration?: Duration;
}

function mapClampThrow(
  inp: number,
  iMin: number,
  iMax: number,
  oMin: number,
  oMax: number,
): number {
  const factor = (inp - iMin) / (iMax - iMin);
  if (factor < 0.0 || factor > 1.0) {
    throw new Error(
      `value out of bounds: ${factor} not in [${iMin}, ${iMax}] range`,
    );
  }

  return oMin + (oMax - oMin) * factor;
}

function vector(context: Context, values: [FactorScore, number][]) {
  const vec = newZeroVector(context);
  for (const [factor, value] of values) {
    vec.data[factor.factorIndex] = value;
  }
  return vec;
}

type XEIName = "xei" | "aei" | "nei";
type EIName =
  | "emotion"
  | "cry"
  | "pads"
  | "waifu"
  | "ehi"
  | "epi"
  | "jumpscare"
  | "sleeplessNight"
  | "politics"
  | "interestField"
  | "meme"
  | XEIName;
type ConsumedImpactName = "consumed" | "animeConsumed";
type ImpactName =
  | EIName
  | "politics"
  | "interestField"
  | ConsumedImpactName
  | "dropped"
  | "additional"
  | "writing";

export type EmotionWeights = Partial<Record<EmotionName, number>>;

export type PeriodMeta =
  | {
    type: "duration";
    duration: string;
  }
  | {
    type: "fromto";
    from: DateTime;
    to: DateTime;
    duration: string;
  };

export interface EmotionArgs {
  base: number;
  emotions: EmotionWeights;
}

export interface PADSArgs {
  duration: Duration;
  days: number;
  periods: PeriodMeta[];
}

export interface ConsumedArgs {
  boredom: number;
  duration: string;
  baseType: "tiny" | "short" | "long";
  baseScore: number;
  baseDuration: Duration;
  ratio: number;
}

export interface XEIArgs {
  factor: number;
  sign: "positive" | "negative";
}

export interface WaifuArgs {
  waifu: string;
  duration: Duration;
  days: number;
  periods: PeriodMeta[];
}

export interface EPIArgs {
  factor: number;
}

export interface MemeArgs {
  strength: number;
  periods: PeriodMeta[];
  duration: string;
}

export interface AdditionalArgs {
  description: string;
}

type RelationName =
  | "music"
  | "visual"
  | "osuSong"
  | "featureMusic"
  | "remix"
  | "killedBy"
  | "gateOpen";

export interface MusicArgs {
  musicBase: number;
}

export interface VisualArgs {
  visualType: VisualTypeName;
  base: number;
  unique: number;
}

export interface OsuSongArgs {
  personal: number;
  community: number;
}

export interface WritingArgs {
  characterComplexity: number;
  storyQuality: number;
  pacing: number;
  originality: number;
}

type IRName = ImpactName | RelationName;

declare module "./DAH_ir_source.ts" {
  interface IRSourceMeta {
    name: IRName;
    emotionArgs?: EmotionArgs;
    padsArgs?: PADSArgs;
    consumedArgs?: ConsumedArgs;
    xeiArgs?: XEIArgs;
    waifuArgs?: WaifuArgs;
    epiArgs?: EPIArgs;
    memeArgs?: MemeArgs;
    additionalArgs?: AdditionalArgs;
    musicArgs?: MusicArgs;
    visualArgs?: VisualArgs;
    osuSongArgs?: OsuSongArgs;
    writingArgs?: WritingArgs;
  }
}
