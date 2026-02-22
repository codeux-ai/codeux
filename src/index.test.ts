import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JulesAgentServer } from './index.js';
import axios from 'axios';
import * as fs from 'fs/promises';

vi.mock('axios', () => {
  const mockAxios = {
    post: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
  };
  mockAxios.create.mockReturnValue(mockAxios);
  return { default: mockAxios };
});

vi.mock('fs/promises');

describe('JulesAgentServer', () => {
  let server: JulesAgentServer;
  const mockApiKey = 'test-api-key';
  const mockBaseUrl = 'https://api.test.com';

  beforeEach(() => {
    vi.clearAllMocks();
    server = new JulesAgentServer(mockApiKey, mockBaseUrl);
  });

  describe('normalizeName', () => {
    it('should prepend type if not present', () => {
      expect(server.normalizeName('sources', '123')).toBe('sources/123');
    });

    it('should not prepend type if already present', () => {
      expect(server.normalizeName('sources', 'sources/123')).toBe('sources/123');
    });
  });

  describe('handleTaskAgent', () => {
    it('should inject worker guide into prompt', async () => {
      const mockWorkerGuide = 'Engineering Standards';
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValue(mockWorkerGuide);
      
      const mockSessionResponse = { data: { id: 'session/123' } };
      
      // The axiosInstance in JulesAgentServer is what axios.create() returned
      const axiosInstance = server.getAxiosInstance();
      vi.mocked(axiosInstance.post).mockResolvedValue(mockSessionResponse);

      const result = await server.handleTaskAgent({
        prompt: 'Implement feature X',
        source_id: 'sources/1',
        repo_path: '/path/to/repo'
      });

      expect(axiosInstance.post).toHaveBeenCalledWith('/sessions', expect.objectContaining({
        prompt: expect.stringContaining(mockWorkerGuide),
        sourceContext: expect.objectContaining({ source: 'sources/1' })
      }));
      
      const response = JSON.parse((result.content[0] as any).text);
      expect(response.id).toBe('session/123');
    });
  });

  describe('handleListAllSources', () => {
    it('should paginate through all sources', async () => {
      const axiosInstance = server.getAxiosInstance();
      vi.spyOn(axiosInstance, 'get')
        .mockResolvedValueOnce({ data: { sources: [{ id: '1' }], nextPageToken: 'token' } })
        .mockResolvedValueOnce({ data: { sources: [{ id: '2' }] } });

      const result = await server.handleListAllSources({});
      const data = JSON.parse((result.content[0] as any).text);

      expect(data.sources).toHaveLength(2);
      expect(axiosInstance.get).toHaveBeenCalledTimes(2);
    });
  });

  describe('handleCreateSession', () => {
    it('should format request data correctly', async () => {
      const axiosInstance = server.getAxiosInstance();
      vi.spyOn(axiosInstance, 'post').mockResolvedValue({ data: { name: 'sessions/123' } });

      await server.handleCreateSession({
        prompt: 'test prompt',
        source: 'sources/repo1',
        starting_branch: 'main'
      });

      expect(axiosInstance.post).toHaveBeenCalledWith('/sessions', expect.objectContaining({
        prompt: 'test prompt',
        sourceContext: {
          source: 'sources/repo1',
          githubRepoContext: { startingBranch: 'main' }
        }
      }));
    });
  });

  describe('handleSprintAgent', () => {
    it('should handle "plan" action by creating directory and returning guide', async () => {
      const mockRepoPath = '/test/repo';
      const mockSprintNum = 1;
      const mockGuide = 'Planning instructions';
      
      vi.mocked(fs.access).mockResolvedValueOnce(undefined); // sprintFile exists
      vi.mocked(fs.access).mockRejectedValueOnce(new Error('subtasksDir not found')); // subtasksDir doesn't exist
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.readFile).mockResolvedValue(mockGuide); // getGuideContent mock

      const result = await server.handleSprintAgent({
        action: 'plan',
        repo_path: mockRepoPath,
        sprint_number: mockSprintNum,
        source_id: 'sources/1'
      });

      expect(fs.mkdir).toHaveBeenCalled();
      expect((result.content[0] as any).text).toContain('Planning Phase for Sprint 1');
      expect((result.content[0] as any).text).toContain(mockGuide);
    });

    it('should orchestrate tasks by creating sessions', async () => {
      const mockRepoPath = '/test/repo';
      const mockSprintNum = 1;
      const mockWorkerGuide = 'Technical Standard';
      
      vi.mocked(fs.access).mockResolvedValue(undefined);
      vi.mocked(fs.readdir).mockResolvedValue(['task1.md'] as any);
      vi.mocked(fs.readFile)
        .mockResolvedValueOnce('title: Task 1\nprompt: Task prompt\nis_independent: true') // loadSubtasks
        .mockResolvedValueOnce(mockWorkerGuide); // getGuideContent(worker.md)
      
      const axiosInstance = server.getAxiosInstance();
      vi.spyOn(axiosInstance, 'get')
        .mockResolvedValueOnce({ data: { sessions: [] } }); // sessions poll
      vi.spyOn(axiosInstance, 'post')
        .mockResolvedValueOnce({ data: { id: 'session/123' } }); // startJulesTask

      const result = await server.handleSprintAgent({
        action: 'orchestrate',
        repo_path: mockRepoPath,
        sprint_number: mockSprintNum,
        source_id: 'sources/1',
        feature_branch: 'feature/sprint1'
      });

      expect(axiosInstance.post).toHaveBeenCalledWith('/sessions', expect.objectContaining({
        prompt: expect.stringContaining(mockWorkerGuide),
        title: expect.stringContaining('task1')
      }));
      expect((result.content[0] as any).text).toContain('Started Jules Session');
    });
  });
});
