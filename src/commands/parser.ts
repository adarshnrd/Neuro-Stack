import { CommandName } from '../enums/commandEnum.js';
import { ParsedCommand } from '../types/commandTypes.js';

export function parseUserInput(input: string): ParsedCommand {
  const trimmed = input.trim();
  const args: Record<string, unknown> = {};

  if (!trimmed.startsWith('@')) {
    return {
      isCommand: false,
      command: null,
      args,
      rawMessage: input,
      messageBody: input,
    };
  }

  const spaceIndex = trimmed.indexOf(' ');
  const commandPart = spaceIndex === -1 ? trimmed : trimmed.slice(0, spaceIndex);
  const commandString = commandPart.substring(1).toUpperCase();

  const isCommand = Object.values(CommandName).includes(commandString as CommandName);
  
  if (!isCommand) {
    // Looks like a mention, not a recognized command
    return {
      isCommand: false,
      command: null,
      args,
      rawMessage: input,
      messageBody: input,
    };
  }

  const command = commandString as CommandName;
  const messageBody = spaceIndex === -1 ? '' : trimmed.slice(spaceIndex + 1).trim();

  // Basic argument parsing (extracting #PR_NUMBER)
  const prMatch = messageBody.match(/#(\d+)/);
  if (prMatch) {
    args.prNumber = parseInt(prMatch[1], 10);
  }

  // Basic flag parsing (e.g., --method squash)
  const methodMatch = messageBody.match(/--method\s+(\w+)/);
  if (methodMatch) {
    args.method = methodMatch[1].toLowerCase();
  }

  return {
    isCommand: true,
    command,
    args,
    rawMessage: input,
    messageBody,
  };
}
