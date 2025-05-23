import { MessageRole, MessageType } from "../types.js";
import * as dbService from "./db.js";
import * as twilioService from "./twilio.js";
import * as openaiService from "./openai.js";
import logger from "./logger.js";
import { langfuseClient } from "./langfuse.js";
import { LangfuseMedia } from "langfuse";

export type ProcessMessageResult =
  | {
      success: true;
    }
  | { success: false; error: string };

export async function processMessage(
  webhookData: unknown,
): Promise<ProcessMessageResult> {
  const trace = langfuseClient.trace({ name: "handleWhatsAppMessage" });
  const messageData = twilioService.extractMessageData(webhookData);
  const messageType = twilioService.determineMessageType(messageData);
  trace.update({ metadata: { messageType } });

  try {
    const user = await dbService.findOrCreateUser({
      phone: messageData.from,
      name: messageData.profileName,
    });
    trace.update({ userId: user.id });

    if (user.isBanned) {
      logger.info(`Ignored message from banned user ${user.id}`);

      return { success: false, error: "User is banned" };
    }

    if (
      messageType === "command" &&
      messageData.body.toLowerCase() === "clear"
    ) {
      await dbService.createMessage({
        userId: user.id,
        role: MessageRole.USER,
        type: MessageType.COMMAND,
        content: "clear",
      });

      await twilioService.sendWhatsAppMessage(
        user.phone,
        "Conversation history cleared. What would you like to talk about?",
      );

      return { success: true };
    }

    let content = messageData.body || "";
    let mediaTwilioUrl = messageData.mediaTwilioUrl;
    let mediaSha256Hash: string | null = null;

    if (messageData.hasMedia && mediaTwilioUrl) {
      const downloadMediaSpan = trace.span({ name: "downloadMedia" });
      const mediaBuffer = await twilioService.downloadMedia(mediaTwilioUrl);
      downloadMediaSpan.end();

      const langfuseMedia = new LangfuseMedia({
        contentBytes: mediaBuffer,
        contentType: messageData.mediaContentType,
      });
      mediaSha256Hash = langfuseMedia.contentSha256Hash ?? null;
      trace.update({ metadata: { media: langfuseMedia } });

      if (messageType === "audio") {
        const transcriptionSpan = trace.span({
          name: "transcribe-audio",
          input: langfuseMedia,
        });
        content = await openaiService.transcribeAudio(mediaBuffer);
        transcriptionSpan.end({ output: content });
      }
    }

    trace.update({ input: content });

    const moderationSpan = trace.span({
      name: "moderate-input",
      input: content,
    });
    const moderation = await openaiService.moderateContent(content);
    moderationSpan.end({
      output: moderation,
      metadata: { moderationFlagged: moderation.flagged },
    });

    trace.update({
      metadata: {
        moderationFlagged: moderation.flagged,
        moderationCategories: moderation.categories,
      },
    });

    if (moderation.flagged) {
      await dbService.createMessage({
        userId: user.id,
        role: MessageRole.USER,
        type: messageType as MessageType,
        content,
        mediaTwilioUrl,
        mediaSha256Hash,
        mediaContentType: messageData.mediaContentType,
        moderationReason: moderation.categories?.join(", "),
        isForwarded: messageData.isFordwarded,
      });

      await twilioService.sendWhatsAppMessage(
        user.phone,
        `I'm unable to respond to that message as it may contain inappropriate content. Please try a different question or message.`,
      );

      return { success: false, error: "Content moderation failed" };
    }

    const userMessage = await dbService.createMessage({
      userId: user.id,
      role: MessageRole.USER,
      type: messageType as MessageType,
      content,
      mediaTwilioUrl,
      mediaSha256Hash,
      isForwarded: messageData.isFordwarded,
    });

    const conversationHistory = await dbService.getConversationHistory(user.id);
    const appMessages = conversationHistory.map((msg) => ({
      role: msg.role as MessageRole,
      type: msg.type as MessageType,
      content: msg.content,
      mediaUrl: msg.mediaTwilioUrl,
      isForwarded: msg.isForwarded,
    }));

    const aiResponse = await openaiService.getChatCompletion(
      appMessages,
      trace,
      user.name ?? "",
    );

    const hasNewerMessages = await dbService.hasNewerMessages(
      user.id,
      userMessage.id,
    );
    if (hasNewerMessages) {
      return {
        success: false,
        error: "Newer messages found. Skipping response.",
      };
    }

    await dbService.createMessage({
      userId: user.id,
      role: MessageRole.ASSISTANT,
      type: MessageType.TEXT,
      content: aiResponse,
    });
    await twilioService.sendWhatsAppMessage(user.phone, aiResponse);

    trace.update({ output: aiResponse });

    return { success: true };
  } catch (error) {
    logger.error(error, "Error processing message");

    logger.error({
      event: "processing_error",
      phone: messageData.from,
      messageId: messageData.messageSid,
      error,
    });

    try {
      await twilioService.sendWhatsAppMessage(
        messageData.from,
        `I'm sorry, I encountered an error processing your message. Please try again later.`,
      );
    } catch (sendError) {
      logger.error(sendError, "Error sending error message");
    }

    return { success: false, error: `Error processing message: ${error}` };
  }
}
