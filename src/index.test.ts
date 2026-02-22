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
});
