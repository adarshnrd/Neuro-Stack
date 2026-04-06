export function stripCommandPrefix(message: string, commandName: string): string {
  const prefix = `@${commandName}`;
  if (message.startsWith(prefix)) {
    return message.slice(prefix.length).trim();
  }
  return message;
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

export function generateId(): string {
  return Math.random().toString(36).substring(2, 11);
}
