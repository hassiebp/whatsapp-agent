import { PrismaClient } from "@prisma/client";
import { MessageRole, MessageType } from "../types.js";
import logger from "./logger.js";

// Initialize Prisma client
const prisma = new PrismaClient();

/**
 * Finds or creates a user by phone number
 */
export async function findOrCreateUser(phone: string) {
  try {
    // Try to find the user first
    let user = await prisma.user.findUnique({
      where: { phone },
    });

    // If the user doesn't exist, create them
    if (!user) {
      user = await prisma.user.create({
        data: {
          phone,
        },
      });
      logger.info(`Created new user with phone ${phone}`);
    }

    return user;
  } catch (error) {
    logger.error("Error finding or creating user:", error);
    throw new Error("Database error: Could not find or create user");
  }
}

/**
 * Checks if a user is banned
 */
export async function isUserBanned(userId: string) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { isBanned: true },
    });

    return user?.isBanned || false;
  } catch (error) {
    logger.error("Error checking if user is banned:", error);
    return false; // Default to not banned in case of error
  }
}

/**
 * Bans a user
 */
export async function banUser(userId: string) {
  try {
    await prisma.user.update({
      where: { id: userId },
      data: { isBanned: true },
    });

    return true;
  } catch (error) {
    logger.error("Error banning user:", error);
    return false;
  }
}

/**
 * Creates a new message record
 */
export async function createMessage({
  userId,
  role,
  type,
  content,
  mediaUrl = null,
  mediaHash = null,
  moderationReason = null,
}: {
  userId: string;
  role: MessageRole;
  type: MessageType;
  content: string;
  mediaUrl?: string | null;
  mediaHash?: string | null;
  moderationFlagged?: boolean | null;
  moderationReason?: string | null;
}) {
  try {
    const message = await prisma.message.create({
      data: {
        userId,
        role,
        type,
        content,
        mediaUrl,
        mediaHash,
        moderationReason,
      },
    });

    return message;
  } catch (error) {
    logger.error("Error creating message:", error);
    throw new Error("Database error: Could not create message");
  }
}

/**
 * Retrieves conversation history for a user since the last "clear" command
 */
export async function getConversationHistory(userId: string) {
  try {
    // First, find the most recent 'clear' command message, if any
    const lastClearCommand = await prisma.message.findFirst({
      where: {
        userId,
        type: "command",
        content: "clear",
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    // Get all messages after the last clear command, or all messages if no clear command
    const messages = await prisma.message.findMany({
      where: {
        userId,
        createdAt: lastClearCommand
          ? { gt: lastClearCommand.createdAt }
          : undefined,
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    return messages;
  } catch (error) {
    logger.error("Error retrieving conversation history:", error);
    throw new Error("Database error: Could not retrieve conversation history");
  }
}

/**
 * Checks if there are newer messages from the same user
 */
export async function hasNewerMessages(userId: string, messageId: string) {
  try {
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      select: { createdAt: true },
    });

    if (!message) {
      return false;
    }

    // Check if there are any newer messages from the same user
    const newerMessageCount = await prisma.message.count({
      where: {
        userId,
        role: "user",
        createdAt: { gt: message.createdAt },
      },
    });

    return newerMessageCount > 0;
  } catch (error) {
    logger.error("Error checking for newer messages:", error);
    return false; // Default to false in case of error
  }
}
