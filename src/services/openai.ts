import OpenAI from "openai";
import { Langfuse, LangfuseTraceClient, observeOpenAI } from "langfuse";
import { MessageType, MessageRole } from "../types.js";
import { ChatCompletionMessageParam } from "openai/resources.mjs";
import logger from "./logger.js";
import config from "../config/index.js";

const openai = new OpenAI();

export interface AppMessage {
  role: MessageRole;
  type: MessageType;
  content: string;
  mediaUrl?: string | null;
}

export async function moderateContent(content: string) {
  try {
    const moderationResponse = await openai.moderations.create({
      input: content,
    });

    const results = moderationResponse.results[0];

    if (results.flagged) {
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
    logger.error(error, "Error during content moderation");

    return { flagged: false, error };
  }
}

export async function transcribeAudio(audioBuffer: Buffer) {
  try {
    const transcription = await openai.audio.transcriptions.create({
      file: new File([audioBuffer], "audio.ogg", { type: "audio/ogg" }),
      model: "whisper-1",
    });

    return transcription.text;
  } catch (error) {
    logger.error(error, "Error transcribing audio");

    throw new Error("Failed to transcribe audio message");
  }
}

async function formatMessagesForOpenAI(
  messages: AppMessage[],
): Promise<ChatCompletionMessageParam[]> {
  const { prompt: systemPrompt } = await new Langfuse().getPrompt(
    "whatsapp-agent-system-prompt",
  );

  const formattedMessages: ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: systemPrompt,
    },
  ];

  for (const message of messages) {
    if (message.role === "system" || message.type === "command") {
      continue; // Skip system messages and commands
    }

    // Format the message content based on its type
    if (message.type === "image" && message.mediaUrl) {
      formattedMessages.push({
        role: message.role === "user" ? "user" : ("assistant" as any), // TODO: fix typecast
        content: [
          {
            type: "image_url",
            image_url: {
              url: message.mediaUrl,
            },
          },
          {
            type: "text",
            text: message.content,
          },
        ],
      });
    } else {
      formattedMessages.push({
        role: message.role === "user" ? "user" : "assistant",
        content: message.content,
      });
    }
  }

  return formattedMessages;
}

export async function getChatCompletion(
  messages: AppMessage[],
  langfuseTrace: LangfuseTraceClient,
) {
  const wrappedOpenAI = observeOpenAI(openai, {
    clientInitParams: { environment: config.nodeEnv },
    parent: langfuseTrace,
  });

  const formattedMessages = await formatMessagesForOpenAI(messages);

  try {
    const completion = await wrappedOpenAI.chat.completions.create({
      model: "gpt-4o",
      messages: formattedMessages,
      max_tokens: 800,
    });

    const response = completion.choices[0]?.message?.content || "";

    return response;
  } catch (error) {
    logger.error(error, "Error getting chat completion");

    throw new Error("Failed to get response from AI");
  }
}
