import { diffLines, Change } from 'diff';
import { DiffLine } from '../types/reviewTypes.js';

/**
 * Computes a line-by-line diff between two strings.
 * Wraps the 'diff' npm package to return our structured DiffLine format.
 */
export function computeLineDiff(oldContent: string, newContent: string): DiffLine[] {
  const changes: Change[] = diffLines(oldContent || '', newContent || '');
  const diffLinesArray: DiffLine[] = [];

  let oldLineNumber = 1;
  let newLineNumber = 1;

  for (const change of changes) {
    const lines = change.value.split('\n');
    if (lines[lines.length - 1] === '') {
      lines.pop(); // Remove the trailing empty line created by split('\n')
    }

    for (const line of lines) {
      if (change.added) {
        diffLinesArray.push({
          type: 'add',
          newLineNumber: newLineNumber++,
          content: line,
        });
      } else if (change.removed) {
        diffLinesArray.push({
          type: 'remove',
          oldLineNumber: oldLineNumber++,
          content: line,
        });
      } else {
        diffLinesArray.push({
          type: 'context',
          oldLineNumber: oldLineNumber++,
          newLineNumber: newLineNumber++,
          content: line,
        });
      }
    }
  }

  return diffLinesArray;
}
