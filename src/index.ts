import express from 'express';
import { processMessage } from './services/message-processor.service.js';
import config from './config/index.js';

const app = express();

// Middleware to parse JSON and URL-encoded bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Twilio webhook endpoint for incoming WhatsApp messages
app.post('/webhook/whatsapp', async (req, res) => {
  // Important: Send immediate 200 OK response to Twilio
  // This prevents webhook timeouts as processing continues asynchronously
  res.status(200).send();
  
  console.log('Received webhook from Twilio');
  
  // Process the message asynchronously after responding
  try {
    processMessage(req.body)
      .then(result => {
        if (!result.success) {
          console.warn('Message processing completed with error:', result.error);
        } else {
          console.log('Message processing completed successfully');
        }
      })
      .catch(error => {
        console.error('Unhandled error in message processing:', error);
      });
  } catch (error) {
    console.error('Error starting message processing:', error);
  }
});

// Start the server
const PORT = config.port;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
  console.log(`Environment: ${config.nodeEnv}`);
  console.log(`Health check: http://localhost:${PORT}/health`);
  console.log(`Webhook URL: http://localhost:${PORT}/webhook/whatsapp`);
});