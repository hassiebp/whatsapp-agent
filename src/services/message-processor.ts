import { createHash } from "crypto";
import { MessageRole, MessageType } from "../types.js";
import * as dbService from "./db.js";
import * as twilioService from "./twilio.js";
import * as openaiService from "./openai.js";
import logger from "./logger.js";

/**
 * Processes an incoming WhatsApp message asynchronously
 */
export type ProcessMessageResult =
  | {
      success: true;
    }
  | { success: false; error: string };

export async function processMessage(
  webhookData: unknown,
): Promise<ProcessMessageResult> {
  const messageData = twilioService.extractMessageData(webhookData);
  const messageType = twilioService.determineMessageType(messageData);

  try {
    // Step 1: Find or create the user
    const user = await dbService.findOrCreateUser(messageData.from);

    // Step 2: Check if user is banned
    if (user.isBanned) {
      logger.info(`Ignored message from banned user ${user.id}`);
      return { success: false, error: "User is banned" };
    }

    // Step 3: Handle "clear" command
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

    // Step 4: Process media if present
    let content = messageData.body || "";
    let mediaUrl = messageData.mediaUrl;
    let mediaHash = null;

    if (messageData.hasMedia && mediaUrl) {
      const mediaBuffer = await twilioService.downloadMedia(mediaUrl);
      mediaHash = createHash("md5").update(mediaBuffer).digest("hex");
      if (messageType === "audio") {
        content = await openaiService.transcribeAudio(mediaBuffer);
      }
    }

    const moderation = await openaiService.moderateContent(content);

    if (moderation.flagged) {
      await dbService.createMessage({
        userId: user.id,
        role: MessageRole.USER,
        type: messageType as MessageType,
        content,
        mediaUrl,
        mediaHash,
        moderationReason: moderation.categories?.join(", "),
      });

      // Send rejection message to user
      await twilioService.sendWhatsAppMessage(
        user.phone,
        `I'm unable to respond to that message as it may contain inappropriate content. Please try a different question or message.`,
      );

      // Consider banning users who repeatedly send flagged content
      // This would be implemented based on your specific policy
      return { success: false, error: "Content moderation failed" };
    }

    // Step 6: Save the user message to the database
    const userMessage = await dbService.createMessage({
      userId: user.id,
      role: MessageRole.USER,
      type: messageType as MessageType,
      content,
      mediaUrl,
      mediaHash,
    });

    // Step 7: Get conversation history
    const conversationHistory = await dbService.getConversationHistory(user.id);

    // Step 8: Format messages for the LLM
    const appMessages = conversationHistory.map((msg) => ({
      role: msg.role as MessageRole,
      type: msg.type as MessageType,
      content: msg.content,
      mediaUrl: msg.mediaUrl,
    }));

    // Step 9: Get AI response
    const aiResponse = await openaiService.getChatCompletion(appMessages);

    // Step 10: Check for newer messages before responding
    const hasNewer = await dbService.hasNewerMessages(user.id, userMessage.id);

    if (hasNewer) {
      return { success: false, error: "Newer message detected" };
    }

    // Step 11: Save the assistant's response
    await dbService.createMessage({
      userId: user.id,
      role: MessageRole.ASSISTANT,
      type: MessageType.TEXT,
      content: aiResponse.content,
    });

    // Step 12: Send the response to the user
    await twilioService.sendWhatsAppMessage(user.phone, aiResponse.content);

    return { success: true };
  } catch (error) {
    logger.error("Error processing message:", error);

    // Log the error with context
    logger.error({
      event: "processing_error",
      phone: messageData.from,
      messageId: messageData.messageSid,
      error: error,
    });

    try {
      // Try to send an error message to the user if possible
      await twilioService.sendWhatsAppMessage(
        messageData.from,
        `I'm sorry, I encountered an error processing your message. Please try again later.`,
      );
    } catch (sendError) {
      logger.error("Error sending error message:", sendError);
    }

    return { success: false, error: `Error processing message: ${error}` };
  }
}
