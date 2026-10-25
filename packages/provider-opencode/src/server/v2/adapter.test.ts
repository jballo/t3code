import { assert, it } from "@effect/vitest";
import { describe } from "vite-plus/test";

import { sessionRules } from "./adapter.ts";

type Rules = ReturnType<typeof sessionRules>;

// OpenCode applies the last rule whose action and resource match.
const effectFor = (rules: Rules, action: string, resource: string) =>
  rules.findLast(
    (entry) =>
      (entry.action === "*" || entry.action === action) &&
      (entry.resource === "*" || resource.startsWith(entry.resource.replace(/\*$/, ""))),
  )?.effect;

const docsAllowed = [{ action: "edit", resource: "/repo/docs/*", effect: "allow" }] as const;

describe("sessionRules", () => {
  it("keeps a side question's edits denied on paths the agent allows", () => {
    const rules = sessionRules(
      {
        runtimeMode: "approval-required",
        interactionMode: "default",
        sandboxPolicy: { type: "readOnly" },
      },
      docsAllowed,
      [],
      null,
    );
    assert.equal(effectFor(rules, "edit", "/repo/docs/a.md"), "deny");
    assert.equal(effectFor(rules, "edit", "/repo/src/a.ts"), "deny");
    assert.equal(effectFor(rules, "shell", "ls"), "ask");
  });

  it("lets the agent's paths allow edits again in plan mode", () => {
    const rules = sessionRules(
      { runtimeMode: "approval-required", interactionMode: "plan" },
      docsAllowed,
      [],
      null,
    );
    assert.equal(effectFor(rules, "edit", "/repo/docs/a.md"), "allow");
    assert.equal(effectFor(rules, "edit", "/repo/src/a.ts"), "deny");
  });
});
