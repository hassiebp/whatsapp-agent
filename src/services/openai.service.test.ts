import { describe, it, expect, vi, beforeEach } from 'vitest';
import { moderateContent, getChatCompletion } from './openai.service';
import OpenAI from 'openai';

// Mock OpenAI
vi.mock('openai', () => {
  return {
    default: vi.fn(() => ({
      moderations: {
        create: vi.fn(),
      },
      chat: {
        completions: {
          create: vi.fn(),
        },
      },
    })),
  };
});

// Mock Langfuse service
vi.mock('./langfuse.service.js', () => ({
  createTrace: vi.fn(() => ({
    generation: vi.fn(),
    end: vi.fn(),
  })),
}));

describe('OpenAI Service', () => {
  let mockOpenAI: any;

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks();
    mockOpenAI = new OpenAI({} as any);
  });

  describe('moderateContent', () => {
    it('should return unflagged when content is safe', async () => {
      // Mock the moderation API response
      mockOpenAI.moderations.create.mockResolvedValueOnce({
        results: [
          {
            flagged: false,
            categories: {},
            category_scores: {},
          },
        ],
      });

      const result = await moderateContent('Safe content');
      
      expect(result.flagged).toBe(false);
      expect(mockOpenAI.moderations.create).toHaveBeenCalledWith({
        input: 'Safe content',
      });
    });

    it('should return flagged with categories when content is unsafe', async () => {
      // Mock the moderation API response
      mockOpenAI.moderations.create.mockResolvedValueOnce({
        results: [
          {
            flagged: true,
            categories: {
              hate: true,
              'hate/threatening': false,
              'self-harm': false,
              sexual: false,
              'sexual/minors': false,
              violence: false,
              'violence/graphic': false,
            },
            category_scores: {
              hate: 0.9,
              'hate/threatening': 0.1,
              'self-harm': 0.0,
              sexual: 0.0,
              'sexual/minors': 0.0,
              violence: 0.0,
              'violence/graphic': 0.0,
            },
          },
        ],
      });

      const result = await moderateContent('Unsafe content');
      
      expect(result.flagged).toBe(true);
      expect(result.categories).toContain('hate');
      expect(mockOpenAI.moderations.create).toHaveBeenCalledWith({
        input: 'Unsafe content',
      });
    });

    it('should return unflagged on error to prevent false positives', async () => {
      // Mock the moderation API throwing an error
      mockOpenAI.moderations.create.mockRejectedValueOnce(new Error('API error'));

      const result = await moderateContent('Some content');
      
      expect(result.flagged).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  describe('getChatCompletion', () => {
    it('should return AI response for valid messages', async () => {
      // Mock the chat completions API response
      mockOpenAI.chat.completions.create.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: 'This is the AI response',
            },
          },
        ],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
        },
      });

      // Mock moderation to return unflagged
      vi.mock('./openai.service', async (importOriginal) => {
        const originalModule = await importOriginal();
        return {
          ...originalModule,
          moderateContent: vi.fn().mockResolvedValueOnce({ flagged: false }),
        };
      });

      const messages = [
        {
          role: 'user' as const,
          type: 'text' as const,
          content: 'Hello, AI!',
        },
      ];

      const result = await getChatCompletion(messages);
      
      expect(result.content).toBe('This is the AI response');
      expect(result.flagged).toBe(false);
      expect(mockOpenAI.chat.completions.create).toHaveBeenCalled();
    });
  });
});