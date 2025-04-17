import OpenAI from 'openai';
import config from '../config/index.js';
import { type MessageRole, type MessageType } from '@prisma/client';
import { createTrace } from './langfuse.service.js';

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: config.openai.apiKey,
});

// System prompt that defines the agent's behavior
const SYSTEM_PROMPT = `You are a helpful AI assistant available via WhatsApp. You provide concise, accurate answers to user queries.

For voice notes:
- If the transcript is long (more than 100 words) or seems like a monologue, provide a concise summary of the key points.
- If the transcript is short and conversational, treat it as a normal user query.

For images:
- Describe what you see in the image and answer any questions about it.

Guidelines:
- Be helpful, accurate, and concise.
- Be friendly and conversational, but professional.
- If you don't know something, admit it rather than making up information.
- Always respect the user's privacy and don't ask for personal information.
- Refuse to generate, discuss, or engage with harmful, illegal, unethical, or inappropriate content.

The user can reset the conversation context by sending "clear" (case-insensitive).`;

// Interface for the message format OpenAI expects
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<{
    type: 'text' | 'image_url';
    text?: string;
    image_url?: {
      url: string;
    };
  }>;
}

// Interface for our application's message format
export interface AppMessage {
  role: MessageRole;
  type: MessageType;
  content: string;
  mediaUrl?: string | null;
}

/**
 * Performs content moderation on text using OpenAI's moderation API
 */
export async function moderateContent(content: string) {
  try {
    const moderationResponse = await openai.moderations.create({
      input: content,
    });
    
    const results = moderationResponse.results[0];
    
    if (results.flagged) {
      // Find which categories were flagged
      const flaggedCategories = Object.entries(results.categories)
        .filter(([_, value]) => value)
        .map(([key, _]) => key);
      
      return {
        flagged: true,
        categories: flaggedCategories,
        categoryScores: results.category_scores,
      };
    }
    
    return { flagged: false };
  } catch (error) {
    console.error('Error during content moderation:', error);
    // In case of error, we return unflagged to prevent false positives
    return { flagged: false, error };
  }
}

/**
 * Transcribes audio using OpenAI's Whisper API
 */
export async function transcribeAudio(audioBuffer: Buffer) {
  try {
    const transcription = await openai.audio.transcriptions.create({
      file: new File([audioBuffer], 'audio.ogg', { type: 'audio/ogg' }),
      model: 'whisper-1',
    });
    
    return transcription.text;
  } catch (error) {
    console.error('Error transcribing audio:', error);
    throw new Error('Failed to transcribe audio message');
  }
}

/**
 * Formats app messages into the format expected by OpenAI's API
 */
function formatMessagesForOpenAI(messages: AppMessage[]): ChatMessage[] {
  const formattedMessages: ChatMessage[] = [
    {
      role: 'system',
      content: SYSTEM_PROMPT,
    },
  ];

  // Format and add the message history
  for (const message of messages) {
    if (message.role === 'system' || message.type === 'command') {
      continue; // Skip system messages and commands
    }

    // Format the message content based on its type
    if (message.type === 'image' && message.mediaUrl) {
      formattedMessages.push({
        role: message.role === 'user' ? 'user' : 'assistant',
        content: [
          {
            type: 'image_url',
            image_url: {
              url: message.mediaUrl,
            },
          },
          {
            type: 'text',
            text: message.content,
          },
        ],
      });
    } else {
      formattedMessages.push({
        role: message.role === 'user' ? 'user' : 'assistant',
        content: message.content,
      });
    }
  }

  return formattedMessages;
}

/**
 * Gets a response from OpenAI's API based on the conversation history
 */
export async function getChatCompletion(messages: AppMessage[]) {
  const formattedMessages = formatMessagesForOpenAI(messages);
  
  // Create a trace in Langfuse
  const trace = createTrace('chat_completion', { 
    userId: messages.find(m => m.role === 'user')?.content.substring(0, 36) || 'unknown',
  });
  
  try {
    // Log the input to Langfuse
    trace?.generation({
      name: 'chat_input',
      input: formattedMessages,
    });
    
    // Call the OpenAI API
    const completion = await openai.chat.completions.create({
      model: 'gpt-4-turbo',
      messages: formattedMessages,
      temperature: 0.7,
      max_tokens: 800,
    });
    
    const response = completion.choices[0]?.message?.content || '';
    
    // Log the output to Langfuse
    trace?.generation({
      name: 'chat_output',
      output: response,
      usage: {
        prompt_tokens: completion.usage?.prompt_tokens,
        completion_tokens: completion.usage?.completion_tokens,
        total_tokens: completion.usage?.total_tokens,
      },
    });
    
    // Moderate the response for safety
    const moderation = await moderateContent(response);
    if (moderation.flagged) {
      trace?.generation({
        name: 'moderation_flagged',
        output: `Response flagged for: ${moderation.categories?.join(', ')}`,
      });
      
      return {
        content: 'I apologize, but I cannot provide that response. Please try a different question.',
        flagged: true,
      };
    }
    
    trace?.end();
    return {
      content: response,
      flagged: false,
    };
  } catch (error) {
    console.error('Error getting chat completion:', error);
    
    trace?.generation({
      name: 'chat_error',
      output: `Error: ${error}`,
    });
    
    trace?.end();
    
    throw new Error('Failed to get response from AI');
  }
}