import { CommandName } from '../enums/commandEnum.js';

export interface CommandArgs {
  [key: string]: unknown;
}

export interface ParsedCommand {
  isCommand: boolean;
  command: CommandName | null;
  args: CommandArgs;
  rawMessage: string;
  messageBody: string;
}

export interface CommandResult {
  success: boolean;
  message: string;
  data?: unknown;
}

export interface CommandHandler {
  name: CommandName;
  description: string;
  execute(args: CommandArgs, sessionId: string): Promise<CommandResult>;
}
