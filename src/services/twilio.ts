import twilio from "twilio";
import axios from "axios";
import config from "../config/index.js";
import { MessageType } from "../types.js";
import logger from "./logger.js";

const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

/**
 * Send a text message via WhatsApp using Twilio API
 */
export async function sendWhatsAppMessage(to: string, body: string) {
  try {
    const result = await twilioClient.messages.create({
      body,
      from: `whatsapp:${config.twilio.phoneNumber}`,
      to: `whatsapp:${to}`,
    });

    return { success: true, messageSid: result.sid };
  } catch (error) {
    console.error(error);
    logger.error("Error sending WhatsApp message:", error);

    return { success: false, error };
  }
}

/**
 * Downloads media from Twilio's API
 */
export async function downloadMedia(mediaUrl: string) {
  try {
    // Twilio requires authentication to download media
    const auth = {
      username: config.twilio.accountSid,
      password: config.twilio.authToken,
    };

    const response = await axios.get(mediaUrl, {
      auth,
      responseType: "arraybuffer",
    });

    return Buffer.from(response.data);
  } catch (error) {
    logger.error("Error downloading media:", error);
    throw new Error("Failed to download media from Twilio");
  }
}

/**
 * Extracts relevant message data from a Twilio webhook
 */
export function extractMessageData(body: any) {
  const {
    From: from,
    Body: textBody,
    NumMedia: numMediaStr,
    MediaContentType0: mediaType,
    MediaUrl0: mediaUrl,
    SmsMessageSid: messageSid,
  } = body;

  const numMedia = parseInt(numMediaStr || "0", 10);

  // Extract the phone number without the WhatsApp prefix
  const phoneNumber = from.replace("whatsapp:", "");

  return {
    from: phoneNumber,
    body: textBody || "",
    messageSid,
    hasMedia: numMedia > 0,
    mediaType: mediaType || null,
    mediaUrl: mediaUrl || null,
    numMedia,
  };
}

/**
 * Determines the message type based on the Twilio webhook data
 */
export function determineMessageType(webhookData: any): MessageType {
  if (!webhookData.hasMedia) {
    if (webhookData.body?.toLowerCase() === "clear") {
      return MessageType.COMMAND;
    }
    return MessageType.TEXT;
  }

  const mediaType = webhookData.mediaType?.toLowerCase() || "";

  if (mediaType.startsWith("image/")) {
    return MessageType.IMAGE;
  } else if (
    mediaType.startsWith("audio/") ||
    mediaType.includes("ogg") ||
    mediaType.includes("voice")
  ) {
    return MessageType.AUDIO;
  }

  return MessageType.TEXT;
}
