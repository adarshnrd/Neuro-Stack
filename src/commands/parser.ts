import { CommandName } from '../enums/commandEnum.js';
import { ParsedCommand } from '../types/commandTypes.js';
import { createChildLogger, withQueryId } from '../logger/index.js';

const log = createChildLogger('parser');

export function parseUserInput(input: string, queryId?: string): ParsedCommand {
  const traceLog = queryId ? withQueryId(log, queryId) : log;
  traceLog.debug('Parsing user input', { source: 'parser#parseUserInput', length: input.length });

  const trimmed = input.trim();
  const args: Record<string, unknown> = {};

  if (!trimmed.startsWith('@')) {
    traceLog.debug('Input is not a command', { source: 'parser#parseUserInput' });
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
    traceLog.debug('Input has @ mention but is not a registered command', { source: 'parser#parseUserInput', mention: commandString });
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

  // Always expose the raw body so handlers like AGENT can read the requirement
  args.requirement = messageBody;

  traceLog.debug('Parsed command successfully', { 
    source: 'parser#parseUserInput', 
    command, 
    argsKeys: Object.keys(args) 
  });

  return {
    isCommand: true,
    command,
    args,
    rawMessage: input,
    messageBody,
  };
}
