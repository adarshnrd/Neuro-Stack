import { CommandHandler } from '../types/commandTypes.js';
import { CommandName } from '../enums/commandEnum.js';

export class CommandRegistry {
  private handlers = new Map<CommandName, CommandHandler>();

  register(handler: CommandHandler): void {
    this.handlers.set(handler.name, handler);
  }

  get(name: CommandName): CommandHandler | undefined {
    return this.handlers.get(name);
  }

  listAll(): CommandHandler[] {
    return Array.from(this.handlers.values());
  }

  hasCommand(name: CommandName): boolean {
    return this.handlers.has(name);
  }
}

// Singleton registry instance
export const commandRegistry = new CommandRegistry();
