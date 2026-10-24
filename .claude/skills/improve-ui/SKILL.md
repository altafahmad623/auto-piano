---
name: improve-ui
description: Audit an existing product surface against its own design evidence, identify verified UI problems, and write self-contained implementation plans for another agent without modifying product source.
---

# Improve UI

Examine one coherent product surface against the system that governs it. Maintain the product's identity, reuse existing owners, and favor verified findings over unsupported ones. Generate plans only for changes the user approves; execution happens separately.

## Boundaries

- Never alter product source code. Create or modify files only within `design-plans/`
- Do not install dependencies, run formatters, commit, push, or mutate the working tree
- Do not revise design documentation; record accepted changes in the executor's plan
- Use rendered evidence only when the user provides or requests visual inspection
- Make each plan self-contained; its executor has no audit context

## Process Steps (1-6)

**1. Select the surface:** Honor user scope; if broad, choose one deployable application and one coherent surface family. Start from routes and layouts. Trace through compositions, shared components, variants, tokens, and styles. Connections must be proven through rendering, imports, props, configuration, or generated artifacts—not shared names or conceptual relationships.

**2. Reconstruct the local system:** Check for `DESIGN.md` and surface-local documentation. Prove sources are current and govern the surface. Document tokens, variables, themes, primitives, and variants relevant to the traced path. Record design language, audited surface, design sources, documented decisions, governing owners, and explicit exceptions.

**3. Prove findings:** Inspect user-facing labels, active states, responsive branches, and sibling variants for contradictions. Require three proofs per finding: Contract (binding design decision or direct contradiction), Runtime (proof the value reaches the surface), and Correction (one required change).

**4. Vet findings:** Reopen sources and attempt to falsify each candidate. Delete findings where the problem doesn't match implementation, the rule doesn't govern that property, counterevidence shows the difference is valid, or the correction invents intent.

**5. Report:** Order findings by confidence, impact, reach, and cost. Stop at three. Use a structured table with: Problem, Evidence, Proposed change, Scope, and Confidence. Include "Improve first" recommendation or "No supported recommendation."

**6. Specify selected changes:** Read the plan template. Write one plan per selected change. Reopen sources, record commits, identify reusable primitives, and trace affected surfaces. Do not invent values; use repository tokens and components.
