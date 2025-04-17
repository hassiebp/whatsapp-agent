import { createHash } from 'crypto';
import { MessageRole, MessageType } from '@prisma/client';
import * as dbService from './database.service.js';
import * as twilioService from './twilio.service.js';
import * as openaiService from './openai.service.js';
import { createTrace, logError } from './langfuse.service.js';

/**
 * Processes an incoming WhatsApp message asynchronously
 */
export async function processMessage(webhookData: any) {
  const messageData = twilioService.extractMessageData(webhookData);
  const messageType = twilioService.determineMessageType(messageData);
  const trace = createTrace('message_processing', { 
    phone: messageData.from,
    messageId: messageData.messageSid,
    messageType,
  });
  
  try {
    // Step 1: Find or create the user
    const user = await dbService.findOrCreateUser(messageData.from);
    
    // Step 2: Check if user is banned
    if (user.isBanned) {
      console.log(`Ignored message from banned user ${user.id}`);
      trace?.end();
      return { success: false, error: 'User is banned' };
    }
    
    // Step 3: Handle "clear" command
    if (messageType === 'command' && messageData.body.toLowerCase() === 'clear') {
      await dbService.createMessage({
        userId: user.id,
        role: 'user',
        type: 'command',
        content: 'clear',
      });
      
      await twilioService.sendWhatsAppMessage(
        user.phone, 
        'Conversation history cleared. What would you like to talk about?'
      );
      
      trace?.generation({
        name: 'command_processed',
        input: 'clear',
        output: 'Conversation cleared',
      });
      
      trace?.end();
      return { success: true };
    }
    
    // Step 4: Process media if present
    let content = messageData.body || '';
    let mediaUrl = messageData.mediaUrl;
    let mediaHash = null;
    
    if (messageData.hasMedia && mediaUrl) {
      trace?.generation({
        name: 'media_download_start',
        input: mediaUrl,
      });
      
      // Download the media
      const mediaBuffer = await twilioService.downloadMedia(mediaUrl);
      
      // Generate a hash of the media for deduplication
      mediaHash = createHash('md5').update(mediaBuffer).digest('hex');
      
      trace?.generation({
        name: 'media_download_complete',
        output: `Media downloaded: ${mediaBuffer.length} bytes, hash: ${mediaHash}`,
      });
      
      // Process based on media type
      if (messageType === 'audio') {
        trace?.generation({
          name: 'audio_transcription_start',
          input: 'Audio file',
        });
        
        // Transcribe audio
        content = await openaiService.transcribeAudio(mediaBuffer);
        
        trace?.generation({
          name: 'audio_transcription_complete',
          output: content,
        });
      }
      // For images, we keep the content as the user's message/caption
      // The image URL will be passed to the vision model later
    }
    
    // Step 5: Check content moderation
    const moderation = await openaiService.moderateContent(content);
    
    // If content is flagged, handle accordingly
    if (moderation.flagged) {
      trace?.generation({
        name: 'moderation_flagged',
        output: `Content flagged for: ${moderation.categories?.join(', ')}`,
      });
      
      // Save the flagged message
      await dbService.createMessage({
        userId: user.id,
        role: 'user',
        type: messageType as MessageType,
        content,
        mediaUrl,
        mediaHash,
        moderationFlagged: true,
        moderationReason: moderation.categories?.join(', '),
      });
      
      // Send rejection message to user
      await twilioService.sendWhatsAppMessage(
        user.phone,
        `I'm unable to respond to that message as it may contain inappropriate content. Please try a different question or message.`
      );
      
      // Consider banning users who repeatedly send flagged content
      // This would be implemented based on your specific policy
      
      trace?.end();
      return { success: false, error: 'Content moderation failed' };
    }
    
    // Step 6: Save the user message to the database
    const userMessage = await dbService.createMessage({
      userId: user.id,
      role: 'user',
      type: messageType as MessageType,
      content,
      mediaUrl,
      mediaHash,
    });
    
    trace?.generation({
      name: 'user_message_saved',
      output: `Message ID: ${userMessage.id}`,
    });
    
    // Step 7: Get conversation history
    const conversationHistory = await dbService.getConversationHistory(user.id);
    
    // Step 8: Format messages for the LLM
    const appMessages = conversationHistory.map(msg => ({
      role: msg.role,
      type: msg.type,
      content: msg.content,
      mediaUrl: msg.mediaUrl,
    }));
    
    // Step 9: Get AI response
    trace?.generation({
      name: 'llm_request_start',
      input: 'Processing message for LLM response',
    });
    
    const aiResponse = await openaiService.getChatCompletion(appMessages);
    
    trace?.generation({
      name: 'llm_response_received',
      output: aiResponse.content,
    });
    
    // Step 10: Check for newer messages before responding
    const hasNewer = await dbService.hasNewerMessages(user.id, userMessage.id);
    
    if (hasNewer) {
      trace?.generation({
        name: 'response_cancelled',
        output: 'Newer message detected, response cancelled',
      });
      
      trace?.end();
      return { success: false, error: 'Newer message detected' };
    }
    
    // Step 11: Save the assistant's response
    await dbService.createMessage({
      userId: user.id,
      role: 'assistant',
      type: 'text',
      content: aiResponse.content,
      moderationFlagged: aiResponse.flagged || false,
    });
    
    // Step 12: Send the response to the user
    await twilioService.sendWhatsAppMessage(user.phone, aiResponse.content);
    
    trace?.generation({
      name: 'response_sent',
      output: 'Response sent to user',
    });
    
    trace?.end();
    return { success: true };
  } catch (error) {
    console.error('Error processing message:', error);
    
    // Log the error to Langfuse
    logError('message_processing', 'processing_error', error as Error, {
      phone: messageData.from,
      messageId: messageData.messageSid,
    });
    
    trace?.end();
    
    try {
      // Try to send an error message to the user if possible
      await twilioService.sendWhatsAppMessage(
        messageData.from,
        `I'm sorry, I encountered an error processing your message. Please try again later.`
      );
    } catch (sendError) {
      console.error('Error sending error message:', sendError);
    }
    
    return { success: false, error: `Error processing message: ${error}` };
  }
}