# Command: @AGENT

## Description
Analyze a user's idea, create a structured plan, and generate production-ready code.

## Expected Input
- A description of the feature or change to implement
- Optional: target files, constraints, preferences

## Execution Steps
1. Parse and understand the requirement
2. If ambiguous → ask clarifying questions (max 3)
3. Generate a technical implementation plan
4. Present plan to user for approval
5. On approval → generate code
6. Report generated files and suggest next step (@CREATE_PR)
