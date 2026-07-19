import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { buildProjectMap, renderProjectMap } from '../src/services/projectIndexer.js';

describe('buildProjectMap', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ns-index-test-'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('detects a Node + TypeScript stack and the test command', async () => {
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'vitest' } }));
    await fs.writeFile(path.join(dir, 'tsconfig.json'), '{}');
    await fs.mkdir(path.join(dir, 'src'));
    await fs.writeFile(path.join(dir, 'src', 'index.ts'), 'export {};');

    const map = await buildProjectMap(dir);
    expect(map.detectedStack).toEqual(expect.arrayContaining(['Node.js', 'TypeScript']));
    expect(map.tree).toContain('src/');
    expect(map.tree).toContain('index.ts');
    expect(map.tree).toContain('npm test');
    expect(map.fileCount).toBeGreaterThanOrEqual(3);
  });

  it('excludes node_modules and .git from the tree', async () => {
    await fs.mkdir(path.join(dir, 'node_modules', 'left-pad'), { recursive: true });
    await fs.writeFile(path.join(dir, 'node_modules', 'left-pad', 'index.js'), '');
    await fs.mkdir(path.join(dir, '.git'));
    await fs.writeFile(path.join(dir, '.git', 'HEAD'), 'ref: x');
    await fs.writeFile(path.join(dir, 'app.js'), '');

    const map = await buildProjectMap(dir);
    expect(map.tree).toContain('app.js');
    expect(map.tree).not.toContain('left-pad');
    expect(map.tree).not.toContain('HEAD');
  });

  it('detects Python and Go stacks', async () => {
    await fs.writeFile(path.join(dir, 'pyproject.toml'), '[tool.poetry]');
    const py = await buildProjectMap(dir);
    expect(py.detectedStack).toContain('Python');
    expect(py.tree).toContain('pytest');
  });

  it('reports unknown stack for a bare folder', async () => {
    await fs.writeFile(path.join(dir, 'notes.txt'), 'hi');
    const map = await buildProjectMap(dir);
    expect(map.detectedStack).toEqual(['unknown']);
  });

  it('renders a prompt-ready map', async () => {
    await fs.writeFile(path.join(dir, 'go.mod'), 'module x');
    const map = await buildProjectMap(dir);
    const rendered = renderProjectMap(map);
    expect(rendered).toContain('## Project Map');
    expect(rendered).toContain('Detected stack: Go');
  });
});
