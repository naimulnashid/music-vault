import { Plus, X } from "lucide-react";
import {
  defaultConditionFor,
  isRuleGroup,
  RULE_FIELDS,
  RULE_OP_LABELS,
  RULE_OPS_FOR_TYPE,
  type RuleCondition,
  type RuleField,
  type RuleGroup,
  type RuleNode,
  type RuleOp,
  type RuleSortKey,
  type SmartRules,
} from "@musicvault/core";
import { OPTION_MODE, useFieldOptions, type OptionField } from "../lib/fieldOptions";
import { Combobox } from "./ui/Combobox";

interface SmartRulesEditorProps {
  rules: SmartRules;
  onChange: (rules: SmartRules) => void;
}

const FIELD_KEYS = Object.keys(RULE_FIELDS) as RuleField[];
const NO_VALUE_OPS: RuleOp[] = ["isSet", "notSet", "isTrue", "isFalse"];

const inputClass =
  "px-2 py-1 text-sm rounded bg-surface-2 border border-line outline-none focus:border-accent";

function replaceAt(nodes: RuleNode[], index: number, node: RuleNode): RuleNode[] {
  return nodes.map((n, i) => (i === index ? node : n));
}

function ConditionRow({
  cond,
  onChange,
  onRemove,
}: {
  cond: RuleCondition;
  onChange: (cond: RuleCondition) => void;
  onRemove: () => void;
}) {
  // A saved rule may name a retired field; show it as text until it's changed.
  const type = RULE_FIELDS[cond.field]?.type ?? "string";
  const ops = RULE_OPS_FOR_TYPE[type];
  const needsValue = !NO_VALUE_OPS.includes(cond.op);
  const optionField = cond.field in OPTION_MODE ? (cond.field as OptionField) : null;
  const options = useFieldOptions(optionField ?? "title");

  const valueInput = () => {
    if (!needsValue) return null;
    if (type === "string" && optionField) {
      return (
        <Combobox
          value={String(cond.value ?? "")}
          onChange={(value) => onChange({ ...cond, value })}
          options={options}
          show={OPTION_MODE[optionField].show}
          placeholder="value"
          className="flex-1 min-w-32"
          inputClassName={`${inputClass} w-full`}
        />
      );
    }
    if (type === "string") {
      return (
        <input
          value={String(cond.value ?? "")}
          onChange={(e) => onChange({ ...cond, value: e.target.value })}
          placeholder="value"
          className={`${inputClass} flex-1 min-w-24`}
        />
      );
    }
    if (type === "date" && cond.op !== "inLast") {
      const ms = typeof cond.value === "number" ? cond.value : Date.now();
      const iso = new Date(ms).toISOString().slice(0, 10);
      return (
        <input
          type="date"
          value={iso}
          onChange={(e) => {
            const parsed = Date.parse(e.target.value);
            if (!Number.isNaN(parsed)) onChange({ ...cond, value: parsed });
          }}
          className={inputClass}
        />
      );
    }
    // Plain numbers, and inLast's day count.
    return (
      <>
        <input
          type="number"
          value={cond.value === undefined || cond.value === "" ? "" : Number(cond.value)}
          onChange={(e) => onChange({ ...cond, value: e.target.value === "" ? undefined : Number(e.target.value) })}
          placeholder={cond.op === "inLast" ? "days" : "value"}
          className={`${inputClass} w-24`}
        />
        {cond.op === "between" && (
          <>
            <span className="text-xs text-muted">and</span>
            <input
              type="number"
              value={cond.value2 ?? ""}
              onChange={(e) => onChange({ ...cond, value2: e.target.value === "" ? undefined : Number(e.target.value) })}
              className={`${inputClass} w-24`}
            />
          </>
        )}
      </>
    );
  };

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <select
        value={cond.field}
        onChange={(e) => onChange(defaultConditionFor(e.target.value as RuleField))}
        className={inputClass}
      >
        {FIELD_KEYS.map((f) => (
          <option key={f} value={f}>
            {RULE_FIELDS[f].label}
          </option>
        ))}
      </select>
      <select
        value={cond.op}
        onChange={(e) => onChange({ ...cond, op: e.target.value as RuleOp })}
        className={inputClass}
      >
        {ops.map((op) => (
          <option key={op} value={op}>
            {RULE_OP_LABELS[op]}
          </option>
        ))}
      </select>
      {valueInput()}
      <button onClick={onRemove} title="Remove rule" className="text-muted hover:text-red-400 p-1">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

function GroupEditor({
  group,
  onChange,
  onRemove,
  depth,
}: {
  group: RuleGroup;
  onChange: (group: RuleGroup) => void;
  onRemove?: () => void;
  depth: number;
}) {
  return (
    <div
      className={`flex flex-col gap-2 ${
        depth > 0 ? "border-l-2 border-line pl-3 ml-1" : ""
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted">Match</span>
        <select
          value={group.combinator}
          onChange={(e) => onChange({ ...group, combinator: e.target.value as "and" | "or" })}
          className={inputClass}
        >
          <option value="and">all</option>
          <option value="or">any</option>
        </select>
        <span className="text-xs text-muted">of the following</span>
        {onRemove && (
          <button onClick={onRemove} title="Remove group" className="text-muted hover:text-red-400 p-1">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {group.rules.map((node, i) =>
        isRuleGroup(node) ? (
          <GroupEditor
            key={i}
            group={node}
            depth={depth + 1}
            onChange={(g) => onChange({ ...group, rules: replaceAt(group.rules, i, g) })}
            onRemove={() => onChange({ ...group, rules: group.rules.filter((_, j) => j !== i) })}
          />
        ) : (
          <ConditionRow
            key={i}
            cond={node}
            onChange={(c) => onChange({ ...group, rules: replaceAt(group.rules, i, c) })}
            onRemove={() => onChange({ ...group, rules: group.rules.filter((_, j) => j !== i) })}
          />
        ),
      )}

      <div className="flex items-center gap-3">
        <button
          onClick={() => onChange({ ...group, rules: [...group.rules, defaultConditionFor("genre")] })}
          className="flex items-center gap-1 text-xs text-accent hover:underline"
        >
          <Plus className="w-3 h-3" /> Rule
        </button>
        {depth < 3 && (
          <button
            onClick={() => onChange({ ...group, rules: [...group.rules, { combinator: "and", rules: [] }] })}
            className="flex items-center gap-1 text-xs text-accent hover:underline"
          >
            <Plus className="w-3 h-3" /> Group
          </button>
        )}
      </div>
    </div>
  );
}

const SORT_KEYS = FIELD_KEYS.filter((f) => f !== "favorite") as RuleSortKey[];

/** Rule builder for a smart playlist. Controlled: the caller keeps the draft and saves it. */
export function SmartRulesEditor({ rules, onChange }: SmartRulesEditorProps) {
  return (
    <div className="flex flex-col gap-3">
      <GroupEditor group={rules.root} depth={0} onChange={(root) => onChange({ ...rules, root })} />

      <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-line">
        <span className="text-xs text-muted">Sort by</span>
        <select
          value={rules.sortBy ?? ""}
          onChange={(e) =>
            onChange({
              ...rules,
              sortBy: e.target.value ? (e.target.value as RuleSortKey) : undefined,
            })
          }
          className={inputClass}
        >
          <option value="">Manual (library order)</option>
          {SORT_KEYS.map((f) => (
            <option key={f} value={f}>
              {RULE_FIELDS[f].label}
            </option>
          ))}
        </select>
        {rules.sortBy && (
          <select
            value={rules.sortDir ?? "asc"}
            onChange={(e) => onChange({ ...rules, sortDir: e.target.value as "asc" | "desc" })}
            className={inputClass}
          >
            <option value="asc">ascending</option>
            <option value="desc">descending</option>
          </select>
        )}
        <span className="text-xs text-muted ml-2">Limit</span>
        <input
          type="number"
          min={1}
          value={rules.limit ?? ""}
          onChange={(e) => onChange({ ...rules, limit: e.target.value === "" ? undefined : Math.max(1, Number(e.target.value)) })}
          placeholder="none"
          className={`${inputClass} w-20`}
        />
      </div>
    </div>
  );
}
