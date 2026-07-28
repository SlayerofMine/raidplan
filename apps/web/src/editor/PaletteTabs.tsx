import { Link } from "react-router-dom";
import { attackSlots, type AttackDef, type ShapeKind } from "@raidplan/shared";
import { useEditorStore } from "../store/editorStore";
import { AttackThumbnail } from "./AttackThumbnail";
import { api } from "../api/client";
import { useSession } from "../api/useSession";
import { useToast } from "../ui/toastContext";
import { ATTACK_DATA_TYPE, SHAPE_DATA_TYPE } from "./paletteDrag";
import { isLocalPlan } from "./planScope";

/**
 * The palette's non-icon tabs (plan §18.5).
 *
 * Everything you can *add* to a plan now lives in one place on the left, and
 * every tile behaves the same way: click to drop it in the middle of the view,
 * or drag it onto the canvas to place it at the cursor.
 */
const tile =
  "flex flex-col items-center gap-1 rounded border border-transparent bg-neutral-800/40 p-2 text-xs text-neutral-300 hover:border-accent";

/** The primitives, labelled as a planner thinks of them (plan §2.4). */
const SHAPES: { kind: ShapeKind | "text" | "arrow"; label: string }[] = [
  { kind: "cone", label: "Cone" },
  { kind: "line", label: "Beam" },
  { kind: "soak", label: "Soak" },
  { kind: "voidzone", label: "Void" },
  { kind: "pickup", label: "Pickup" },
  { kind: "rect", label: "Rect" },
  { kind: "circle", label: "Circle" },
  { kind: "arrow", label: "Arrow" },
  { kind: "text", label: "Text" },
];

/**
 * Adding a **slot** — a hole for one of the using plan's objects (§18.14). Only
 * meaningful while authoring an attack: a plan has no holes to fill.
 */
function SlotTile() {
  const addPrimitive = useEditorStore((s) => s.addPrimitive);
  const updateObject = useEditorStore((s) => s.updateObject);
  return (
    <button
      type="button"
      aria-label="Add Slot"
      title="A stand-in for one of the plan's own objects — tether to it, aim at it, collide with it"
      onClick={() => {
        const id = addPrimitive("placeholder");
        updateObject(id, { name: "Slot", label: "slot" });
      }}
      draggable
      onDragStart={(e) =>
        e.dataTransfer.setData(SHAPE_DATA_TYPE, "placeholder")
      }
      className={tile}
    >
      Slot
    </button>
  );
}

export function ShapesTab({ authoring = false }: { authoring?: boolean }) {
  const addPrimitive = useEditorStore((s) => s.addPrimitive);

  return (
    <div className="grid grid-cols-3 gap-2 p-3" data-testid="shapes-tab">
      {SHAPES.map(({ kind, label }) => (
        <button
          key={kind}
          type="button"
          aria-label={`Add ${label}`}
          onClick={() =>
            kind === "text" || kind === "arrow"
              ? addPrimitive(kind)
              : addPrimitive("shape", kind)
          }
          draggable
          onDragStart={(e) => e.dataTransfer.setData(SHAPE_DATA_TYPE, kind)}
          className={tile}
        >
          {label}
        </button>
      ))}
      {authoring && <SlotTile />}
    </div>
  );
}

/** One placeable definition: its thumbnail, its name, and what it still needs. */
function AttackTile({ def }: { def: AttackDef }) {
  const background = useEditorStore((s) => s.background);
  const addAttack = useEditorStore((s) => s.addAttack);
  const selectedIds = useEditorStore((s) => s.selectedIds);

  // A definition with holes in it needs objects to fill them, and takes them
  // from the selection: pick the boss and the tank, then place the frontal
  // (§18.14).
  const slots = attackSlots(def);
  const short = slots.length - selectedIds.length;
  const blocked = short > 0;

  return (
    <button
      type="button"
      title={
        blocked
          ? `Select ${slots.length} object${slots.length === 1 ? "" : "s"} first — this attack needs ${slots
              .map((slot) => slot.base.name ?? "a slot")
              .join(", ")}`
          : def.name
      }
      aria-label={`Place ${def.name}`}
      disabled={blocked}
      onClick={() =>
        addAttack(def.id, {
          x: background.width / 2,
          y: background.height / 2,
        })
      }
      draggable={!blocked}
      onDragStart={(e) => e.dataTransfer.setData(ATTACK_DATA_TYPE, def.id)}
      className={`${tile} disabled:cursor-not-allowed disabled:opacity-40`}
    >
      <span className="pointer-events-none aspect-square w-full">
        <AttackThumbnail def={def} />
      </span>
      <span className="w-full truncate text-center">{def.name}</span>
      {blocked && (
        <span
          data-testid={`needs-slots-${def.id}`}
          className="w-full truncate text-center text-[10px] text-amber-400/80"
        >
          select {short} more
        </span>
      )}
    </button>
  );
}

/**
 * Publishing one of this plan's attacks into the encounter's library (§19.3).
 *
 * Shown only to a site admin, and only where a plan attack and an encounter
 * both exist — this is the one act the §19.1 gate is actually for, and it is an
 * `UPDATE` of the scope, so the id survives and instances already placed carry
 * on working. They simply become everyone's.
 */
function PromoteButton({
  def,
  encounterId,
  onDone,
}: {
  def: AttackDef;
  encounterId: string;
  onDone: () => void;
}) {
  const { toast } = useToast();
  return (
    <button
      type="button"
      aria-label={`Publish ${def.name} to this encounter`}
      title="Publish to the encounter's library — everyone working this fight gets it"
      onClick={() => {
        void api.attack.promote
          .mutate({ id: def.id, encounterId })
          .then(() => {
            toast(`Published “${def.name}” to this encounter.`, "success");
            onDone();
          })
          .catch(() => toast("Could not publish that attack.", "error"));
      }}
      className="w-full truncate rounded text-center text-[10px] text-accent hover:underline"
    >
      publish
    </button>
  );
}

function Section({
  title,
  hint,
  testId,
  defs,
  promoteTo,
}: {
  title: string;
  hint: string;
  testId: string;
  defs: AttackDef[];
  /** The encounter these may be published into, for an admin. */
  promoteTo?: string;
}) {
  const session = useSession();
  const isAdmin =
    session.status === "signedIn" && session.session.isAdmin === true;
  const setAttackDefs = useEditorStore((s) => s.setAttackDefs);
  const defsById = useEditorStore((s) => s.attackDefs);

  return (
    <section className="p-3" data-testid={testId}>
      <h3 className="mb-2 text-[10px] uppercase tracking-wide text-neutral-500">
        {title}
      </h3>
      {defs.length === 0 ? (
        <p className="text-xs text-neutral-500">{hint}</p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {defs.map((def) => (
            <div key={def.id} className="flex flex-col gap-1">
              <AttackTile def={def} />
              {promoteTo && isAdmin && (
                <PromoteButton
                  def={def}
                  encounterId={promoteTo}
                  onDone={() =>
                    // Reflect the move without a round trip: it has left this
                    // section and joined the encounter's.
                    setAttackDefs({
                      ...defsById,
                      [def.id]: {
                        ...def,
                        scope: { kind: "encounter", encounterId: promoteTo },
                      },
                    })
                  }
                />
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * The attack library, in **two sections** (plan §19.4): the encounter's curated
 * attacks, and this plan's own.
 *
 * Split because "who else sees this" is a fact the author needs continuously and
 * cannot infer from a thumbnail — editing a curated attack changes it for
 * everyone working that fight, and editing your own changes it for you. A plan
 * with no encounter used to have no attacks and no way to get any; it now has
 * the second section and the whole feature.
 */
export function AttacksTab() {
  const planId = useEditorStore((s) => s.id);
  const encounterId = useEditorStore((s) => s.encounterId);
  const defs = Object.values(useEditorStore((s) => s.attackDefs));

  const mine = defs.filter((d) => d.scope.kind === "plan");
  const curated = defs.filter((d) => d.scope.kind === "encounter");
  // The offline scratch plan has no server to author against; everything else
  // does, whether or not it was seeded from an encounter.
  const canAuthor = !isLocalPlan(planId);

  return (
    <div data-testid="attacks-tab" className="divide-y divide-panelborder">
      {encounterId && (
        <Section
          title="Encounter"
          testId="encounter-attacks"
          hint="This encounter has no attacks yet."
          defs={curated}
        />
      )}
      {canAuthor && (
        <Section
          title="This plan"
          testId="plan-attacks"
          hint="Attacks you draw here stay in this plan."
          defs={mine}
          promoteTo={encounterId}
        />
      )}
      {canAuthor ? (
        <div className="p-3">
          <Link
            to={`/plan/${planId}/attacks/new`}
            data-testid="new-plan-attack"
            className={`${tile} block text-center hover:border-accent`}
          >
            + New attack
          </Link>
        </div>
      ) : (
        <p
          data-testid="attacks-local-plan"
          className="p-3 text-xs text-neutral-500"
        >
          Save this plan to the server to draw attacks of your own.
        </p>
      )}
    </div>
  );
}
