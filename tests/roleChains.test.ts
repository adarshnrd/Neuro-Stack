import { describe, it, expect } from 'vitest';
import { buildRoleChain, ROLE_CHAINS, ROLE_OPTIONS } from '../src/llm/roleChains.js';
import { LLMProvider, ModelRole } from '../src/enums/llmEnum.js';

describe('buildRoleChain', () => {
  it('returns the full chain when every provider is configured', () => {
    const all = new Set([
      LLMProvider.GEMINI,
      LLMProvider.GROQ,
      LLMProvider.NVIDIA,
      LLMProvider.NVIDIA_ULTRA,
    ]);
    expect(buildRoleChain(ModelRole.PLANNER, all)).toEqual([
      LLMProvider.NVIDIA_ULTRA,
      LLMProvider.NVIDIA,
      LLMProvider.GEMINI,
      LLMProvider.GROQ,
    ]);
  });

  it('skips providers without credentials but preserves order', () => {
    const geminiOnly = new Set([LLMProvider.GEMINI]);
    expect(buildRoleChain(ModelRole.SUMMARIZER, geminiOnly)).toEqual([LLMProvider.GEMINI]);

    // No NVIDIA of any kind → reviewer falls through to Gemini then Groq
    const noNvidia = new Set([LLMProvider.GEMINI, LLMProvider.GROQ]);
    expect(buildRoleChain(ModelRole.REVIEWER, noNvidia)).toEqual([
      LLMProvider.GEMINI,
      LLMProvider.GROQ,
    ]);

    // Ultra absent but nano present → nano leads
    const nanoOnly = new Set([LLMProvider.NVIDIA, LLMProvider.GEMINI]);
    expect(buildRoleChain(ModelRole.PLANNER, nanoOnly)).toEqual([
      LLMProvider.NVIDIA,
      LLMProvider.GEMINI,
    ]);
  });

  it('returns an empty chain when nothing is configured', () => {
    expect(buildRoleChain(ModelRole.CHAT, new Set())).toEqual([]);
  });

  it('prefers Groq for high-frequency roles and NVIDIA Ultra for reasoning roles', () => {
    expect(ROLE_CHAINS[ModelRole.SUMMARIZER][0]).toBe(LLMProvider.GROQ);
    expect(ROLE_CHAINS[ModelRole.VALIDATOR][0]).toBe(LLMProvider.GROQ);
    expect(ROLE_CHAINS[ModelRole.PLANNER][0]).toBe(LLMProvider.NVIDIA_ULTRA);
    expect(ROLE_CHAINS[ModelRole.REVIEWER][0]).toBe(LLMProvider.NVIDIA_ULTRA);
  });

  it('keeps NVIDIA models off the high-frequency hot-path roles', () => {
    for (const role of [ModelRole.SUMMARIZER, ModelRole.VALIDATOR]) {
      expect(ROLE_CHAINS[role]).not.toContain(LLMProvider.NVIDIA);
      expect(ROLE_CHAINS[role]).not.toContain(LLMProvider.NVIDIA_ULTRA);
    }
  });

  it('uses the NVIDIA nano (not the slow 550B Ultra) as the last-resort tool-loop fallback', () => {
    for (const role of [ModelRole.CHAT, ModelRole.CODER]) {
      // nano is tool-capable and fast enough to keep a tool loop going when Gemini+Groq are spent
      expect(ROLE_CHAINS[role]).toContain(LLMProvider.NVIDIA);
      expect(ROLE_CHAINS[role].at(-1)).toBe(LLMProvider.NVIDIA);
      // the 550B Ultra is far too slow for a per-round tool loop
      expect(ROLE_CHAINS[role]).not.toContain(LLMProvider.NVIDIA_ULTRA);
    }
    // Gemini stays the primary coder (proven tool calling)
    expect(ROLE_CHAINS[ModelRole.CODER][0]).toBe(LLMProvider.GEMINI);
  });

  it('uses deterministic settings for the validator and thinking for reasoning roles', () => {
    expect(ROLE_OPTIONS[ModelRole.VALIDATOR].temperature).toBe(0);
    expect(ROLE_OPTIONS[ModelRole.PLANNER].enableThinking).toBe(true);
    expect(ROLE_OPTIONS[ModelRole.REVIEWER].enableThinking).toBe(true);
    expect(ROLE_OPTIONS[ModelRole.CODER].enableThinking).toBe(false);
  });
});
