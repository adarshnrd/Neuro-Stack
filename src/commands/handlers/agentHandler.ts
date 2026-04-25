import { BaseMessage } from '@langchain/core/messages';
import { CommandArgs, CommandHandler, CommandResult } from '../../types/commandTypes.js';
import { CommandName } from '../../enums/commandEnum.js';
import { AssembledContext, ContextService } from '../../services/contextService.js';
import { PromptInjector } from '../../memory/promptInjector.js';
import { createLLMProvider } from '../../llm/provider.js';
import { config } from '../../config/index.js';
import { createChildLogger } from '../../logger/index.js';
import { AGENT_USAGE_GUIDE, AGENT_COMMAND_DESCRIPTION } from '../../constants/commandConstants.js';
import { changeSetService } from '../../services/changeSetService.js';
import { changeSetContext } from '../../services/changeSetContext.js';
import { FileChangeStatus } from '../../enums/reviewEnum.js';

// ─── Module-scoped logger (not part of instance state) ───────────────────────
const log = createChildLogger('agentHandler');

// ─── Constants ────────────────────────────────────────────────────────────────
// Agent usage guide is now imported from commandConstants.ts

// ─── Handler ──────────────────────────────────────────────────────────────────

/**
 * Handles the `@AGENT` command.
 *
 * Workflow:
 * 1. Validates that the user supplied a requirement.
 * 2. Loads all context layers (rules, command template, session, learned patterns).
 * 3. Assembles the full prompt via {@link PromptInjector}.
 * 4. Invokes the configured LLM and returns its response as Markdown.
 */
export class AgentHandler implements CommandHandler {
  /** The command name this handler is bound to. */
  public readonly name: CommandName = CommandName.AGENT;

  /** Human-readable description shown in the `@` autocomplete popup. */
  public readonly description: string = AGENT_COMMAND_DESCRIPTION;

  /**
   * @param contextService - Loads all markdown context layers for the command.
   * @param promptInjector - Assembles the final LangChain message array from context + user input.
   */
  public constructor(
    private readonly contextService: ContextService = new ContextService(),
    private readonly promptInjector: PromptInjector = new PromptInjector(),
  ) {}

  // ── Public interface ────────────────────────────────────────────────────────

  /**
   * Entry point called by {@link CommandRegistry} when the user sends `@AGENT <requirement>`.
   *
   * @param args      - Parsed command arguments; expects `args.requirement` as a non-empty string.
   * @param sessionId - Active session identifier used for context and logging.
   * @returns A {@link CommandResult} whose `message` field contains the LLM's Markdown response.
   */
  public async execute(args: CommandArgs, sessionId: string): Promise<CommandResult> {
    const requirement = this.extractRequirement(args);

    log.info('Executing AGENT handler', {
      source: 'agentHandler#execute',
      sessionId,
      requirementLength: requirement.length,
    });

    if (!requirement) {
      return this.buildUsageResult(sessionId);
    }

    return this.runAgentPipeline(requirement, sessionId);
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  /**
   * Safely extracts and trims the requirement string from raw command args.
   *
   * @param args - Raw parsed command arguments from the parser.
   * @returns Trimmed requirement string, or an empty string if absent.
   */
  private extractRequirement(args: CommandArgs): string {
    return ((args.requirement as string | undefined) ?? '').trim();
  }

  /**
   * Returns a usage-guide result when `@AGENT` is invoked with no requirement text.
   *
   * @param sessionId - Used for structured logging only.
   * @returns A failed {@link CommandResult} containing the Markdown usage guide.
   */
  private buildUsageResult(sessionId: string): CommandResult {
    log.warn('AGENT invoked without a requirement', {
      source: 'agentHandler#buildUsageResult',
      sessionId,
    });

    return { success: false, message: AGENT_USAGE_GUIDE };
  }

  /**
   * Core pipeline: loads context → builds prompt → invokes LLM → returns result.
   *
   * @param requirement - Validated, non-empty requirement string from the user.
   * @param sessionId   - Active session identifier.
   * @returns A successful {@link CommandResult} with the LLM's Markdown response,
   *          or a failed result if the LLM invocation throws.
   */
  private async runAgentPipeline(
    requirement: string,
    sessionId: string,
  ): Promise<CommandResult> {
    try {
      const context = await this.loadContext(sessionId);
      const messages = this.buildMessages(context, requirement);

      // Create a pending changeset for this agent session
      const changeSet = await changeSetService.createChangeSet(sessionId);

      // Invoke LLM within the async context so file tools can associate writes
      const content = await changeSetContext.run(changeSet.changeSetId, async () => {
        return await this.invokeLLM(messages, sessionId);
      });

      // Finalize the changeset since execution is over
      await changeSetService.finalizeChangeSet(changeSet.changeSetId);

      // Get updated changeset to count file modifications
      const updatedCs = changeSetService.getChangeSet(changeSet.changeSetId);
      const filesAdded = updatedCs?.files.filter(f => f.status === FileChangeStatus.ADDED).length || 0;
      const filesModified = updatedCs?.files.filter(f => f.status === FileChangeStatus.MODIFIED).length || 0;
      const filesDeleted = updatedCs?.files.filter(f => f.status === FileChangeStatus.DELETED).length || 0;

      const hasChanges = (filesAdded + filesModified + filesDeleted) > 0;

      return {
        success: true,
        message: content,
        data: { 
          requirement, 
          sessionId,
          changeSetId: hasChanges ? changeSet.changeSetId : undefined,
          changesSummary: hasChanges ? { filesAdded, filesModified, filesDeleted } : undefined
        },
      };
    } catch (error: unknown) {
      return this.buildErrorResult(error, sessionId);
    }
  }

  /**
   * Fetches all context layers for the AGENT command via {@link ContextService}.
   *
   * @param sessionId - Used to load session-specific markdown context.
   * @returns A fully populated {@link AssembledContext} object.
   */
  private async loadContext(sessionId: string): Promise<AssembledContext> {
    log.debug('Loading context for AGENT command', {
      source: 'agentHandler#loadContext',
      sessionId,
    });

    return this.contextService.loadForCommand(CommandName.AGENT, sessionId);
  }

  /**
   * Assembles the LangChain message array from all context layers and the user requirement.
   *
   * @param context     - All markdown context layers (rules, template, session, patterns).
   * @param requirement - The user's raw requirement description.
   * @returns Ordered array of {@link BaseMessage} objects ready for LLM invocation.
   */
  private buildMessages(context: AssembledContext, requirement: string): BaseMessage[] {
    return this.promptInjector.buildPrompt(
      context.systemRules,
      context.commandTemplate,
      context.sessionContext,
      context.learnedPatterns,
      requirement,
    );
  }

  /**
   * Invokes the configured LLM with the assembled message array and returns raw text content.
   *
   * @param messages  - Fully assembled LangChain message array.
   * @param sessionId - Used for structured logging of provider/model/duration.
   * @returns The LLM's response as a plain string.
   * @throws Re-throws any error from the LLM provider so the caller can handle it uniformly.
   */
  private async invokeLLM(messages: BaseMessage[], sessionId: string): Promise<string> {
    log.info('Invoking LLM for AGENT command', {
      source: 'agentHandler#invokeLLM',
      sessionId,
      provider: config.llm.provider,
      model: config.llm.model,
      messageCount: messages.length,
    });

    const llmStartTime = Date.now();
    const llm = createLLMProvider(config.llm);
    const response = await llm.invoke(messages);

    log.info('LLM response received for AGENT command', {
      source: 'agentHandler#invokeLLM',
      sessionId,
      llmDurationMs: Date.now() - llmStartTime,
    });

    return typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);
  }

  /**
   * Builds a structured error result from any thrown value.
   * Uses type-narrowing instead of `any` casts to satisfy strict TypeScript settings.
   *
   * @param error     - The caught value (may be `Error`, string, or unknown).
   * @param sessionId - Used for structured error logging.
   * @returns A failed {@link CommandResult} with a user-friendly Markdown error message.
   */
  private buildErrorResult(error: unknown, sessionId: string): CommandResult {
    const message = error instanceof Error ? error.message : String(error);
    const stack   = error instanceof Error ? error.stack   : undefined;

    log.error('AGENT handler encountered an LLM error', {
      source: 'agentHandler#buildErrorResult',
      sessionId,
      error: message,
      stack,
    });

    return {
      success: false,
      message: [
        '## ❌ Agent Error',
        '',
        'Failed to process your request:',
        '',
        `> ${message}`,
        '',
        'Please try again or rephrase your requirement.',
      ].join('\n'),
    };
  }
}
