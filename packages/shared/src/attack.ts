import { z } from "zod";

/**
 * Attacks (plan §21) — a mechanic, packaged.
 *
 * An **attack definition** is a set of objects and animations authored once and
 * dropped into any plan as one thing: a set of objects, one slide's worth of
 * animations, and the parameters its author chose to expose. It is deliberately
 * a *slice of a Plan* — the same `PlanObject` and `Slide` schemas the document
 * is built from — exactly as an encounter preset is, so the Attack Designer can
 * be the normal editor rather than a second one.
 *
 * `AttackDefSchema` itself lives in `plan.ts`, because a plan carries its
 * attacks and an attack carries plan objects: the two are mutually recursive,
 * and one file has to hold both ends. Everything here is plan-independent —
 * parameters, bindings, the placement transform and the instance recipe — so
 * the dependency runs one way, from the document to this.
 *
 * An **attack instance** is a placement of a definition into a plan. It is a
 * **recipe, not a result**: it holds the definition id, the placement transform,
 * the parameter values, the slot bindings and the id map, and the objects and
 * animations that appear in the document are a pure function of it
 * (`attackStamp.ts`). Every edit — move, rotate, scale, retime, re-parameterise —
 * changes the recipe and re-derives the whole stamp from the authored definition
 * with the same ids. Nothing is ever computed from the previous stamp, which is
 * what makes coordinate drift arithmetically impossible rather than merely
 * unlikely.
 *
 * Placing an attack writes ordinary objects, ordinary slide states and ordinary
 * animations. The player, the Gantt, collision, the scrubber and the exporters
 * never learn that attacks exist: everything an attack does is something the
 * plan model could already say.
 */

/* -------------------------------------------------------------------------- */
/* Parameters                                                                  */
/* -------------------------------------------------------------------------- */

/** The kinds of value an author can expose. */
export const ATTACK_PARAM_KINDS = [
  "number",
  "color",
  "text",
  "boolean",
  "choice",
  /** A set of plan object ids — what an `onCollision` animation listens for. */
  "objects",
] as const;
export const AttackParamKindSchema = z.enum(ATTACK_PARAM_KINDS);
export type AttackParamKind = z.infer<typeof AttackParamKindSchema>;

/**
 * Which side of the document a binding writes to.
 *
 * `object` covers both the object record (`tint`, `label`, …) and its state on
 * the attack's slide (`opacity`, `w`, `h`) — from the author's point of view
 * they are all properties of the thing on the board, and the stamp knows which
 * half each one lands in.
 */
export const ATTACK_BINDING_SIDES = ["object", "anim"] as const;
export const AttackBindingSideSchema = z.enum(ATTACK_BINDING_SIDES);
export type AttackBindingSide = z.infer<typeof AttackBindingSideSchema>;

/**
 * Every field a parameter may drive, and what drives it.
 *
 * A **closed** table rather than a free-form path string: a binding names a
 * field the schema already knows, so a definition can never ask for a write the
 * stamp has no code for, and the designer's pickers iterate the same source of
 * truth. Extending it is a one-line change plus a case in `applyBinding`.
 */
export const ATTACK_FIELDS = {
  // --- object side -------------------------------------------------------
  /** Colour tint (`object.base.tint`). */
  tint: { on: "object", kind: "color" },
  /** Text drawn on the canvas (`object.base.label`). */
  label: { on: "object", kind: "text" },
  /** Editor-side name shown in panels (`object.base.name`). */
  name: { on: "object", kind: "text" },
  /** Opacity on the attack's slide (`state.opacity`), 0..1. */
  opacity: { on: "object", kind: "number" },
  /** Width on the attack's slide (`state.w`), before the placement scale. */
  w: { on: "object", kind: "number" },
  /** Height on the attack's slide (`state.h`), before the placement scale. */
  h: { on: "object", kind: "number" },
  /** Mechanic fill style (`object.style.fill`). */
  fill: { on: "object", kind: "choice" },
  /** Whether the planner may move it once detached (`object.locked`). */
  locked: { on: "object", kind: "boolean" },
  // --- animation side ----------------------------------------------------
  /** Delay before this animation starts (`anim.delayMs`), before `timeScale`. */
  delayMs: { on: "anim", kind: "number" },
  /** How long it runs (`anim.durationMs`), before `timeScale`. */
  durationMs: { on: "anim", kind: "number" },
  /** GSAP ease name (`anim.easing`). */
  easing: { on: "anim", kind: "choice" },
  /** Which effect it plays (`anim.effect`). */
  effect: { on: "anim", kind: "choice" },
  /** A `scale` effect's multiplier (`anim.params.scale`). */
  scale: { on: "anim", kind: "number" },
  /** How much a drawn route rounds off (`anim.params.curve`), 0..1. */
  curve: { on: "anim", kind: "number" },
  /**
   * What an `onCollision` animation listens for (`anim.collideWith`).
   *
   * The value **replaces** whatever the author wrote, in plan object ids — the
   * point of exposing it is to let the planner say "and this one hurts *these*
   * people", which is a thing only the plan knows.
   */
  collideWith: { on: "anim", kind: "objects" },
} as const satisfies Record<
  string,
  { on: AttackBindingSide; kind: AttackParamKind }
>;

export type AttackField = keyof typeof ATTACK_FIELDS;
export const ATTACK_FIELD_NAMES = Object.keys(ATTACK_FIELDS) as AttackField[];
export const AttackFieldSchema = z.enum(
  ATTACK_FIELD_NAMES as [AttackField, ...AttackField[]],
);

/** Which side a field is written on. */
export function attackFieldSide(field: AttackField): AttackBindingSide {
  return ATTACK_FIELDS[field].on;
}

/** The parameter kind a field must be driven by. */
export function attackFieldKind(field: AttackField): AttackParamKind {
  return ATTACK_FIELDS[field].kind;
}

/** One field of one definition-local object or animation, driven by a parameter. */
export const AttackBindingSchema = z
  .object({
    on: AttackBindingSideSchema,
    /** A **definition-local** object id or animation id — never a plan id. */
    targetId: z.string().min(1),
    field: AttackFieldSchema,
  })
  .refine((b) => attackFieldSide(b.field) === b.on, {
    message: "field does not belong to that side",
    path: ["field"],
  });
export type AttackBinding = z.infer<typeof AttackBindingSchema>;

/**
 * Any value a parameter can hold, across every kind.
 *
 * Spelled as a union rather than `unknown` for two reasons: consumers get a
 * type they can actually narrow, and `z.unknown()` infers as *optional* (it
 * admits `undefined`), which would quietly make a parameter with no default
 * representable — and one did slip through the tRPC boundary that way.
 * {@link attackParamValueSchema} is the per-kind narrowing.
 */
export const AttackParamValueSchema = z.union([
  z.number(),
  z.string(),
  z.boolean(),
  z.array(z.string()),
]);
export type AttackParamValue = z.infer<typeof AttackParamValueSchema>;

/** What a value of a given kind is allowed to be. */
export function attackParamValueSchema(kind: AttackParamKind): z.ZodType {
  switch (kind) {
    case "number":
      return z.number().finite();
    case "color":
    case "text":
    case "choice":
      return z.string();
    case "boolean":
      return z.boolean();
    case "objects":
      return z.array(z.string().min(1));
  }
}

/**
 * A named value the author exposed, and the fields it drives.
 *
 * `value` is the **default**: the designer mints a parameter from whatever the
 * document already holds at the bound field, so exposing one never changes what
 * the attack looks like. A placement that says nothing about a parameter gets
 * this.
 */
export const AttackParamSchema = z
  .object({
    /** Stable key, referenced by an instance's `values`. */
    name: z.string().min(1),
    /** What the planner sees. */
    label: z.string().min(1),
    kind: AttackParamKindSchema,
    value: AttackParamValueSchema,
    /** Bounds for `number`, for the designer's input. */
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    step: z.number().finite().positive().optional(),
    /** The options for `choice`. */
    choices: z.array(z.string()).optional(),
    targets: z.array(AttackBindingSchema).min(1),
  })
  .superRefine((param, ctx) => {
    if (!attackParamValueSchema(param.kind).safeParse(param.value).success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `default value is not a ${param.kind}`,
        path: ["value"],
      });
    }
    // A parameter and the fields it drives must agree about what a value *is*,
    // or the stamp would write a colour into a duration. Checked here, once, so
    // no consumer has to guess.
    param.targets.forEach((target, i) => {
      if (attackFieldKind(target.field) !== param.kind) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `${target.field} is driven by a ${attackFieldKind(target.field)}, not a ${param.kind}`,
          path: ["targets", i, "field"],
        });
      }
    });
  });
export type AttackParam = z.infer<typeof AttackParamSchema>;

/* -------------------------------------------------------------------------- */
/* Definition                                                                  */
/* -------------------------------------------------------------------------- */

/** Where a definition came from, for the palette's badge. */
export const ATTACK_SOURCES = ["preset", "plan"] as const;
export const AttackSourceSchema = z.enum(ATTACK_SOURCES);
export type AttackSource = z.infer<typeof AttackSourceSchema>;

/**
 * The definition's slot objects, in authoring order — the order placement binds.
 *
 * Generic over the object rather than typed to `PlanObject`, only so this can
 * live on the plan-independent side of the import; it is always called with a
 * definition's objects.
 */
export function attackSlots<T extends { slotName?: string | undefined }>(
  objects: readonly T[],
): T[] {
  return objects.filter((object) => object.slotName !== undefined);
}

/* -------------------------------------------------------------------------- */
/* Instance                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * How a placement moves the authored geometry, applied about the definition's
 * anchor as **translate ∘ rotate ∘ scale**.
 *
 * Rigid where the schema is rigid: centres are exact under any of it, and a
 * non-uniform scale is exact for a member whose own rotation is a multiple of
 * 90°. A rotated member under a non-uniform scale would be a sheared box, which
 * `SlideState` cannot hold, so that member alone falls back to a uniform
 * `√(sx·sy)` — it degrades to the wrong *size*, never to the wrong *shape*. See
 * `attackTransform.ts`.
 */
export const AttackTransformSchema = z.object({
  tx: z.number().finite(),
  ty: z.number().finite(),
  rotationDeg: z.number().finite(),
  sx: z.number().finite().positive(),
  sy: z.number().finite().positive(),
});
export type AttackTransform = z.infer<typeof AttackTransformSchema>;

/** No movement, no rotation, no scaling — what a fresh placement starts from. */
export const IDENTITY_ATTACK_TRANSFORM: AttackTransform = {
  tx: 0,
  ty: 0,
  rotationDeg: 0,
  sx: 1,
  sy: 1,
};

/**
 * One placement of a definition on one slide — the recipe the stamp is derived
 * from.
 *
 * The id maps are what make the derivation *stable*: re-stamping reuses the ids
 * it minted last time, so a tether the planner drew into the attack, or a
 * `collideWith` naming one of its objects, survives every re-derivation. Ids
 * that name nothing are pruned on load, the same repair `normalizeSlides` does
 * for slide entries.
 */
export const AttackInstanceSchema = z.object({
  id: z.string().min(1),
  /** Which definition in `plan.attacks` this is a placement of. */
  defId: z.string().min(1),
  /** The definition's name at placement, so a deleted definition still reads. */
  name: z.string().min(1),
  transform: AttackTransformSchema,
  /**
   * How much the whole attack is stretched in time. Applied to the authored
   * durations and internal delays, always **from the definition** — so dragging
   * the timeline bar ten times lands exactly where dragging it once would.
   */
  timeScale: z.number().finite().positive().default(1),
  /** When the attack starts on its slide — the `delayMs` of its first animation. */
  anchorDelayMs: z.number().finite().nonnegative().default(0),
  /** paramName → the value this placement uses. Absent means the default. */
  values: z.record(z.string().min(1), AttackParamValueSchema).default({}),
  /** Definition-local slot object id → the plan object bound to it. */
  slots: z.record(z.string().min(1), z.string().min(1)).default({}),
  /** Definition-local object id → the plan object stamped for it. */
  objectMap: z.record(z.string().min(1), z.string().min(1)).default({}),
  /** Definition-local animation id → the plan animation stamped for it. */
  animMap: z.record(z.string().min(1), z.string().min(1)).default({}),
});
export type AttackInstance = z.infer<typeof AttackInstanceSchema>;

/**
 * The value a placement uses for a parameter: its own, or the author's default.
 *
 * Falls back to the default whenever the stored value is the wrong shape, so a
 * hand-edited or half-migrated document renders the attack as authored rather
 * than not at all.
 */
export function attackParamValue(
  param: AttackParam,
  values: Record<string, AttackParamValue>,
): AttackParamValue {
  if (!(param.name in values)) return param.value;
  const parsed = attackParamValueSchema(param.kind).safeParse(
    values[param.name],
  );
  return parsed.success ? (parsed.data as AttackParamValue) : param.value;
}
