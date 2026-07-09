import { expect, test, type APIRequestContext, type Page, type TestInfo } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { AppearanceSettings, LocalDirectoryBrowserResponse } from '../../../src/contracts/app-types.js';
import type { InstructionFileContent } from '../../../src/contracts/instruction-file-types.js';
import type { SystemSettings } from '../../../src/contracts/settings-scope-types.js';
import {
  createTemporaryGitRepository,
  hideOnboardingAndTours,
  seedSelectedCodeUxProject,
  type SeededCodeUxProject,
} from '../helpers/e2e-fixtures';

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lz9rtwAAAABJRU5ErkJggg==',
  'base64',
);

const INSTRUCTION_CONTENT = {
  agents: '# Agents\n\nUse exact filesystem persistence for Code UX E2E.\n',
  claude: '# Claude\n\nPersist Claude instructions through the public API.\n',
  copilot: '# Copilot\n\nPersist nested GitHub Copilot instructions.\n',
} as const;

async function writeInstructionFile(
  request: APIRequestContext,
  projectId: string,
  fileId: keyof typeof INSTRUCTION_CONTENT | 'gemini',
  content: string,
): Promise<InstructionFileContent> {
  const response = await request.put(
    `/api/projects/${encodeURIComponent(projectId)}/instruction-files/${encodeURIComponent(fileId)}`,
    {
      headers: { 'Content-Type': 'application/json' },
      data: { content },
    },
  );

  expect(response.status(), await response.text()).toBe(200);
  return await response.json() as InstructionFileContent;
}

async function readInstructionFile(
  request: APIRequestContext,
  projectId: string,
  fileId: keyof typeof INSTRUCTION_CONTENT | 'gemini',
): Promise<InstructionFileContent> {
  const response = await request.get(
    `/api/projects/${encodeURIComponent(projectId)}/instruction-files/${encodeURIComponent(fileId)}`,
  );

  expect(response.status(), await response.text()).toBe(200);
  return await response.json() as InstructionFileContent;
}

async function createTinyPngFixture(testInfo: TestInfo): Promise<string> {
  const fixturePath = testInfo.outputPath('fixtures', 'background image with spaces.png');
  await fs.mkdir(path.dirname(fixturePath), { recursive: true });
  await fs.writeFile(fixturePath, TINY_PNG);
  return fixturePath;
}

async function fetchSystemSettings(request: APIRequestContext): Promise<SystemSettings> {
  const response = await request.get('/api/system-settings');
  expect(response.status(), await response.text()).toBe(200);
  return await response.json() as SystemSettings;
}

async function assertCleanClientError(
  responseBody: unknown,
  forbiddenFragments: string[],
): Promise<void> {
  const serialized = JSON.stringify(responseBody);
  expect(serialized).not.toContain(' at ');
  expect(serialized).not.toContain('node:');
  for (const fragment of forbiddenFragments) {
    expect(serialized).not.toContain(fragment);
  }
}

async function openAppearanceSettings(page: Page, request: APIRequestContext): Promise<void> {
  await hideOnboardingAndTours(page, request);
  await page.goto('/config');
  await expect(page.getByRole('heading', { name: 'Settings & Integration' })).toBeVisible();
  await page.getByRole('button', { name: /Appearance Dashboard layout and theme preferences/i }).click();
  await expect(page.getByText('Background Image', { exact: true })).toBeVisible();
}

test.describe('filesystem persistence', () => {
  let seededProject: SeededCodeUxProject | null = null;

  test.afterEach(async () => {
    if (seededProject) {
      await seededProject.cleanup();
      seededProject = null;
    }
  });

  test('persists instruction files, local directory browsing, and appearance uploads', async ({ page, request }, testInfo) => {
    seededProject = await seedSelectedCodeUxProject(request, {
      testInfo,
      fixtureKey: 'filesystem-persistence',
    });
    await seededProject.repository.writeFile('folder with spaces/alpha child/file.txt', 'alpha\n');
    await seededProject.repository.writeFile('folder with spaces/Zeta Child/file.txt', 'zeta\n');
    await seededProject.repository.writeFile('Beta Folder/nested file.txt', 'beta\n');
    await seededProject.repository.writeFile('gemini.md', '# Gemini alias\n');

    const projectId = seededProject.project.id;
    const repoRoot = await fs.realpath(seededProject.repository.root);

    const agents = await writeInstructionFile(request, projectId, 'agents', INSTRUCTION_CONTENT.agents);
    const claude = await writeInstructionFile(request, projectId, 'claude', INSTRUCTION_CONTENT.claude);
    const copilot = await writeInstructionFile(request, projectId, 'copilot', INSTRUCTION_CONTENT.copilot);

    expect(agents).toMatchObject({ id: 'agents', relativePath: 'AGENTS.md', content: INSTRUCTION_CONTENT.agents });
    expect(claude).toMatchObject({ id: 'claude', relativePath: 'CLAUDE.md', content: INSTRUCTION_CONTENT.claude });
    expect(copilot).toMatchObject({
      id: 'copilot',
      relativePath: '.github/copilot-instructions.md',
      content: INSTRUCTION_CONTENT.copilot,
    });

    await expect.poll(async () => fs.readFile(path.join(repoRoot, 'AGENTS.md'), 'utf8')).toBe(INSTRUCTION_CONTENT.agents);
    await expect.poll(async () => fs.readFile(path.join(repoRoot, 'CLAUDE.md'), 'utf8')).toBe(INSTRUCTION_CONTENT.claude);
    await expect.poll(async () => fs.readFile(path.join(repoRoot, '.github', 'copilot-instructions.md'), 'utf8')).toBe(
      INSTRUCTION_CONTENT.copilot,
    );

    for (const [fileId, content] of Object.entries(INSTRUCTION_CONTENT)) {
      const read = await readInstructionFile(request, projectId, fileId as keyof typeof INSTRUCTION_CONTENT);
      expect(read.content).toBe(content);
    }

    const aliasContent = '# Gemini alias updated\n';
    const alias = await writeInstructionFile(request, projectId, 'gemini', aliasContent);
    expect(alias).toMatchObject({ id: 'gemini', relativePath: 'gemini.md', content: aliasContent });
    await expect.poll(async () => fs.readFile(path.join(repoRoot, 'gemini.md'), 'utf8')).toBe(aliasContent);
    const aliasReadBack = await readInstructionFile(request, projectId, 'gemini');
    expect(aliasReadBack).toMatchObject({ id: 'gemini', relativePath: 'gemini.md', content: aliasContent });
    const geminiInstructionEntries = (await fs.readdir(repoRoot))
      .filter((entry) => entry.toLowerCase() === 'gemini.md');
    expect(geminiInstructionEntries).toEqual(['gemini.md']);

    const oversizedResponse = await request.put(
      `/api/projects/${encodeURIComponent(projectId)}/instruction-files/agents`,
      {
        headers: { 'Content-Type': 'application/json' },
        data: { content: 'x'.repeat(1_000_001) },
      },
    );
    expect(oversizedResponse.status()).toBeGreaterThanOrEqual(400);
    expect(oversizedResponse.status()).toBeLessThan(500);
    const oversizedBody = await oversizedResponse.json() as unknown;
    expect(JSON.stringify(oversizedBody)).toContain('byte limit');
    await assertCleanClientError(oversizedBody, [repoRoot, seededProject.repository.root]);

    const directoryResponse = await request.get(`/api/local-directories?path=${encodeURIComponent(repoRoot)}`);
    expect(directoryResponse.status(), await directoryResponse.text()).toBe(200);
    const directoryListing = await directoryResponse.json() as LocalDirectoryBrowserResponse;
    expect(directoryListing.currentPath).toBe(repoRoot);
    expect(directoryListing.parentPath).toBe(path.dirname(repoRoot));
    expect(directoryListing.rootPath).toBe(path.parse(repoRoot).root);
    expect(directoryListing.homePath).toEqual(expect.any(String));

    const directoryNames = directoryListing.directories.map((entry) => entry.name);
    expect(directoryNames).toEqual([...directoryNames].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' })));
    expect(directoryNames).toEqual(expect.arrayContaining(['.git', '.github', 'Beta Folder', 'folder with spaces']));
    expect(directoryListing.directories.find((entry) => entry.name === 'folder with spaces')?.path).toBe(path.join(repoRoot, 'folder with spaces'));

    const traversalResponse = await request.get(
      `/api/local-directories?path=${encodeURIComponent(path.parse(repoRoot).root)}`,
    );
    expect(traversalResponse.status()).toBe(403);
    const traversalBody = await traversalResponse.json() as unknown;
    expect(traversalBody).toEqual({ error: 'Access denied' });
    await assertCleanClientError(traversalBody, [repoRoot, seededProject.repository.root]);

    const imagePath = await createTinyPngFixture(testInfo);
    const expectedDataUrl = `data:image/png;base64,${TINY_PNG.toString('base64')}`;
    await openAppearanceSettings(page, request);
    await page.locator('#bg-image-input').setInputFiles(imagePath);
    await expect(page.getByRole('img', { name: 'Background Thumbnail' })).toHaveAttribute('src', expectedDataUrl);
    await page.getByRole('button', { name: 'Save Changes' }).click();

    await expect.poll(async () => {
      const settings = await fetchSystemSettings(request);
      return settings.defaults.appearance.backgroundImage ?? null;
    }).toBe(expectedDataUrl);

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Settings & Integration' })).toBeVisible();
    await page.getByRole('button', { name: /Appearance Dashboard layout and theme preferences/i }).click();
    await expect(page.getByRole('img', { name: 'Background Thumbnail' })).toHaveAttribute('src', expectedDataUrl);

    const savedSettings = await fetchSystemSettings(request);
    const appearance: AppearanceSettings = savedSettings.defaults.appearance;
    expect(appearance.backgroundImage).toBe(expectedDataUrl);
  });

  test('lists temporary git repositories created directly under the e2e fixture helper', async ({ request }) => {
    const repository = await createTemporaryGitRepository({
      prefix: 'codeux-e2e-fs-direct',
      files: {
        'parent folder/Child B/file.txt': 'b\n',
        'parent folder/child a/file.txt': 'a\n',
        'space name.txt': 'root\n',
      },
    });

    try {
      const repoRoot = await fs.realpath(repository.root);
      const response = await request.get(`/api/local-directories?path=${encodeURIComponent(repoRoot)}`);
      expect(response.status(), await response.text()).toBe(200);
      const body = await response.json() as LocalDirectoryBrowserResponse;
      expect(body.currentPath).toBe(repoRoot);
      expect(body.directories.map((entry) => entry.name)).toEqual(expect.arrayContaining(['.git', 'parent folder']));
    } finally {
      await repository.cleanup();
    }
  });
});
