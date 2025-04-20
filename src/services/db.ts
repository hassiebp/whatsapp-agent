import { PrismaClient } from "@prisma/client";
import { MessageRole, MessageType } from "../types.js";
import logger from "./logger.js";

const prisma = new PrismaClient({
  log: [
    { level: "query", emit: "event" },
    { level: "error", emit: "stdout" },
    { level: "info", emit: "stdout" },
    { level: "warn", emit: "stdout" },
  ],
});

// Set up Prisma query logging to be handled by our logger
prisma.$on("query", (e) => {
  logger.debug(
    {
      query: e.query,
      params: e.params,
      duration: e.duration,
      timestamp: e.timestamp,
    },
    "Prisma Query",
  );
});

export async function findOrCreateUser(params: {
  phone: string;
  name?: string;
}) {
  const { phone, name } = params;

  try {
    let user = await prisma.user.findUnique({
      where: { phone, name },
    });

    if (!user) {
      user = await prisma.user.upsert({
        where: {
          phone,
        },
        create: {
          phone,
          name,
        },
        update: {
          name,
        },
      });

      logger.info({ phone, name }, "User upserted");
    }

    return user;
  } catch (error) {
    logger.error(error, "Error finding or creating user");

    throw new Error("Database error: Could not find or create user");
  }
}

export async function isUserBanned(userId: string) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { isBanned: true },
    });

    return user?.isBanned || false;
  } catch (error) {
    logger.error(error, "Error checking if user is banned");

    return false; // Default to not banned in case of error
  }
}

export async function banUser(userId: string) {
  try {
    await prisma.user.update({
      where: { id: userId },
      data: { isBanned: true },
    });

    return true;
  } catch (error) {
    logger.error(error, "Error banning user");

    return false;
  }
}

export async function createMessage({
  userId,
  role,
  type,
  content,
  isForwarded,
  mediaTwilioUrl = null,
  mediaSha256Hash = null,
  moderationReason = null,
  mediaContentType = null,
}: {
  userId: string;
  role: MessageRole;
  type: MessageType;
  content: string;
  mediaTwilioUrl?: string | null;
  mediaSha256Hash?: string | null;
  mediaContentType?: string | null;
  moderationFlagged?: boolean | null;
  moderationReason?: string | null;
  isForwarded?: boolean;
}) {
  try {
    const message = await prisma.message.create({
      data: {
        userId,
        role,
        type,
        content,
        mediaTwilioUrl,
        mediaSha256Hash,
        moderationReason,
        mediaContentType,
        isForwarded,
      },
    });

    return message;
  } catch (error) {
    logger.error(error, "Error creating message");

    throw new Error("Database error: Could not create message");
  }
}

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
    logger.error(error, "Error retrieving conversation history");

    throw new Error("Database error: Could not retrieve conversation history");
  }
}

export async function hasNewerMessages(userId: string, messageId: string) {
  try {
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      select: { createdAt: true },
    });

    if (!message) return false;

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
    logger.error(error, "Error checking for newer messages");

    return false; // Default to false in case of error
  }
}
