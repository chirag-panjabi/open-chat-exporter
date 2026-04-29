# AI Agent Spec-Driven Workflow (SDD)

This repository is built using **Spec-Driven AI Development**. Because multiple AI agents (or models with varying context windows and intelligence levels) may work on this project simultaneously, all agents **MUST STRICTLY ADHERE** to this workflow to maintain state, prevent hallucinations, and ensure self-correction.

## Core Directives for ALL AI Agents:

1.  **NEVER Guess the Context:**
    *   Before writing any code, you MUST read the `docs/ai_memory/1_active_context.md` and the `01_unified_chat_exporter_spec.md`.
    *   If you are a task-execution agent, read `docs/ai_memory/2_progress_tracker.md` to see exactly what task you have been assigned.

2.  **The "Think Then Do" Loop:**
    *   **Phase 1: Plan:** Always explain the architecture and logic of your proposed solution before writing it.
    *   **Phase 2: Review Docs:** Cross-check your plan against `03_unified_schema_definition.md` and `02_architecture_decisions.md`. Are there any contradictions? (e.g., Does your plan use Python when we decided on TypeScript?) If you add a new output format or scrub stage, update the spec/docs first.
    *   **Phase 2.5: Phase Brainstorm (Required for new phases):** Before implementing a new roadmap phase, create/update a short brainstorm doc in `docs/ai_memory/phase_brainstorms/` capturing: scope, CLI contract, streaming constraints, test plan, and open questions.
    *   **Phase 3: Execute:** Write the code.
    *   **Phase 4: Verify:** Test the code. Write a test case or dry-run the logic. Did it fulfill the spec?
    *   **Phase 5: Update Memory:** Check off the task in `docs/ai_memory/2_progress_tracker.md` and update `docs/ai_memory/1_active_context.md`.

3.  **Role Delegation (Multi-Agent Collaboration):**
    *   **Architect Agent (High-Intelligence Model like o1, Opus, or Gemini Advanced):** Responsible for complex problem solving, refactoring the spec, debugging brutal OOM errors, and outlining the abstract logic in the `/docs` folder.
    *   **Execution Agent (Fast/Instruction-Following Model like Claude 3.5 Sonnet, GPT-4o):** Responsible for taking the exact steps written in `2_progress_tracker.md` by the Architect and rapidly executing the boilerplate code, file manipulation, and unit test writing.
    *   **Review Agent:** Reads the Execution Agent's output against the `03_unified_schema_definition.md` to verify compliance.

4.  **Handling Errors & Self-Correction:**
    *   If you encounter an error (e.g., TypeScript compilation target fails), DO NOT blindly attempt alternative syntaxes until it works.
    *   Stop. Read the terminal output. Update `docs/ai_memory/3_lessons_learned.md` with what failed. Propose a root-cause hypothesis, modify the architecture if needed, and try again.

5.  **Adherence to the Master Spec:**
    *   If a user asks you to implement a feature that contradicts the `01_unified_chat_exporter_spec.md` (e.g., "Add the actual image files to the WhatsApp JSON"), you MUST refuse and remind the user of the Red Team Mitigation strategy in the spec, unless explicitly instructed to _overwrite the spec_.

---

## The Workflow Loop for Every Session:
1. Agent starts up and reads `1_active_context.md`.
2. Agent checks `2_progress_tracker.md` for the current Unfinished Task.
3. Agent reads the relevant core spec files (01, 02, 03).
4. Agent completes the task, runs verification.
5. Agent updates `2_progress_tracker.md` and stops.