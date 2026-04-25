import { CommandHandler } from '../types/commandTypes.js';
import { CommandName } from '../enums/commandEnum.js';
import { createChildLogger } from '../logger/index.js';

const log = createChildLogger('registry');

export class CommandRegistry {
  private readonly handlers = new Map<CommandName, CommandHandler>();

  public register(handler: CommandHandler): void {
    log.debug('Registering command handler', { source: 'registry#register', commandName: handler.name });
    this.handlers.set(handler.name, handler);
  }

  public get(name: CommandName): CommandHandler | undefined {
    const hit = this.handlers.has(name);
    log.debug('Registry lookup', { source: 'registry#get', commandName: name, hit });
    return this.handlers.get(name);
  }

  public listAll(): CommandHandler[] {
    const list = Array.from(this.handlers.values());
    log.debug('Listing all commands', { source: 'registry#listAll', count: list.length });
    return list;
  }

  public hasCommand(name: CommandName): boolean {
    return this.handlers.has(name);
  }
}

// Singleton registry instance
export const commandRegistry = new CommandRegistry();
