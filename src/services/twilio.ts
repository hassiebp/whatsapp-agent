import twilio from "twilio";
import axios from "axios";
import config from "../config/index.js";
import { MessageType } from "../types.js";
import logger from "./logger.js";

const twilioClient = twilio(config.twilio.accountSid, config.twilio.authToken);

export async function sendWhatsAppMessage(to: string, body: string) {
  try {
    const result = await twilioClient.messages.create({
      body,
      from: `whatsapp:${config.twilio.phoneNumber}`,
      to: `whatsapp:${to}`,
    });

    return { success: true, messageSid: result.sid };
  } catch (error) {
    logger.error(error, "Error sending WhatsApp message");

    return { success: false, error };
  }
}

export async function downloadMedia(mediaUrl: string) {
  try {
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
    logger.error(error, "Error downloading media");

    throw new Error("Failed to download media from Twilio");
  }
}

export function extractMessageData(body: any) {
  const {
    From: from,
    Body: textBody,
    NumMedia: numMediaStr,
    MediaContentType0: mediaType,
    MediaUrl0: mediaUrl,
    SmsMessageSid: messageSid,
    ProfileName: profileName,
    Forwarded: isFordwarded,
  } = body;

  const numMedia = parseInt(numMediaStr || "0", 10);

  // Extract the phone number without the WhatsApp prefix
  const phoneNumber = from.replace("whatsapp:", "");

  return {
    from: phoneNumber,
    body: textBody || "",
    messageSid,
    hasMedia: numMedia > 0,
    mediaContentType: mediaType || null,
    mediaTwilioUrl: mediaUrl || null,
    numMedia,
    profileName,
    isFordwarded,
  };
}

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
