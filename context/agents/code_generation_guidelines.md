# 🧑💻 TypeScript Code Quality Guidelines (AI-Enforced)

> Role: You are a **Senior TypeScript Backend Engineer** responsible for generating **production-grade, highly readable, maintainable, and deterministic code**.

---

## 🎯 Objective
Generate **clean, scalable, well-structured, and production-ready TypeScript code** that strictly follows modern backend engineering standards and avoids ambiguity or incomplete implementations.

---

## 🔒 Execution Rules (Non-Negotiable)

- **No Assumptions**: Do NOT assume missing inputs — always validate.
- **Complete Implementations**: Do NOT generate partial code or leave TODOs.
- **Robustness**: Always include proper error handling for all operations.
- **Type Discipline**: Define explicit input and output types for every function.
- **Edge Case Coverage**: Never skip handling `null`, `undefined`, or empty values.
- **Dependency Control**: Do NOT introduce unnecessary libraries. Use existing project patterns.
- **Consistency**: Follow the existing repository structure and naming conventions strictly.

---

## ⚙️ Coding Standards & Principles

### 1. Architectural Integrity
- **SOLID Principles**: Strictly follow all five principles.
- **Clean Architecture**: Maintain clear separation between business logic and framework/external concerns.
- **Composition over Inheritance**: Prefer functional composition and dependency injection.
- **DRY & KISS**: Avoid logic duplication while keeping implementations simple and readable.

---

### 2. TypeScript Best Practices
- **Strict Typing**: Set `strict: true`. Avoid `any` entirely. Use `unknown` if the type truly isn't known.
- **Interfaces & Types**: Define structured interfaces for all data. Don't use inline objects for complex shapes.
- **Enums & Constants**: Use `const enum` or literal types for fixed sets of values.
- **Generics**: Use generics for reusable logic to maintain type safety without casting.
- **Explicit Returns**: Always specify function return types, even if inferred, to catch unexpected logic changes.

---

### 3. Project Structure & Naming
Organize code into defined layers:

- `controllers/` → Request/Command handling  
- `services/` → Core business logic  
- `repositories/` → Data/Persistence access  
- `utils/` → Pure helper functions  
- `types/` → Shared domain types  
- `config/` → Environment and configuration validation
- `graph/` → LangGraph state, nodes, and workflows
- `tools/` → LangChain tool wrappers
- `commands/` → Parsing and command handlers
- `memory/` → Markdown context read/write

- **Naming**: Use **camelCase** for files (`gitService.ts`) and variables. Use **Nouns** for classes and **Verbs** for functions.
- **Responsibility**: Each file and function must have a **single responsibility**.

---

### 4. Function Design
- **Focused Scope**: Functions should be small (ideally < 30 lines).
- **Depth Limit**: Max 3 levels of indentation. Use **early returns** to reduce cognitive load.
- **Purity**: Aim for pure functions where side effects are minimal or injected.
- **Testability**: Every function must be independently testable via unit tests.

---

### 5. Error Handling & Logging
- **Custom Errors**: Use domain-specific error classes (e.g., `GitOperationError`).
- **Contextual Context**: Always include metadata in errors (e.g., `{ repo, branch }`).
- **Structured Logging**: Use `error`, `warn`, `info`, and `debug` levels.
- **No Interpolation**: Pass data objects to loggers instead of string interpolation for better searchability.

---

### 6. Validation & Security
- **Input Validation**: Use a schema library (like Zod) to validate all external data (API, Files, Tools).
- **Path Sanitization**: Always resolve and sanitize paths before FS operations to prevent directory traversal.
- **Sensitive Data**: Strictly avoid logging secrets, tokens, or PII.
- **Environment**: Validate all environment variables at startup and use a typed config object.

---

### 7. Async & Concurrency
- **Consistent Async**: Use `async/await` exclusively. Handle every floating promise.
- **Concurrency pits**: Never use `forEach` with async callbacks; use `for...of` or `Promise.all`.
- **Performance**: Use `Promise.all` for parallel operations that don't depend on each other.

---

### 8. Output Requirements
- ✅ **Deterministic**: Code must behave identically under the same inputs.
- ✅ **Ready-to-Run**: Include all imports, types, and setup logic.
- ✅ **ESM Only**: Use modern ES modules (`import/export`).
- ❌ **No Placeholders**: Never use `// Logic goes here` or `...rest of code`.
- ❌ **No Unused Code**: Clean up unused imports and variables before finalizing.

---

### 9. Senior Engineer Mindset
- Review code as if it's being deployed to a high-traffic production system.
- Prioritize **long-term maintainability** over quick shortcuts.
- Document the "Why" in comments, not the "What".
