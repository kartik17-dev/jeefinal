import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import cron from 'node-cron';
import { initDB, getStatus, addLog, updateStatus, getLogs, addSubscription } from './src/server/db.js';
import { checkWebsite } from './src/server/scraper.js';
import dotenv from 'dotenv';
import webpush from 'web-push';
import fs from 'fs';

dotenv.config();

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

// Web Push Setup
let vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
let vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;

const vapidPath = path.join(process.cwd(), 'data', 'vapid.json');

if (!vapidPublicKey || !vapidPrivateKey) {
  try {
    if (fs.existsSync(vapidPath)) {
      const vapidData = JSON.parse(fs.readFileSync(vapidPath, 'utf8'));
      vapidPublicKey = vapidData.publicKey;
      vapidPrivateKey = vapidData.privateKey;
      console.log('Loaded VAPID keys from data/vapid.json');
    }
  } catch (err) {
    console.error('Error reading vapid.json:', err);
  }
}

if (!vapidPublicKey || !vapidPrivateKey) {
  console.warn("\n===============================================================");
  console.warn("⚠️ VAPID KEYS NOT FOUND IN ENVIRONMENT VARIABLES OR FILE ⚠️");
  console.warn("Generating temporary keys. Push notifications will break if the server restarts!");
  const keys = webpush.generateVAPIDKeys();
  vapidPublicKey = keys.publicKey;
  vapidPrivateKey = keys.privateKey;
  
  try {
    if (!fs.existsSync(path.join(process.cwd(), 'data'))) {
      fs.mkdirSync(path.join(process.cwd(), 'data'), { recursive: true });
    }
    fs.writeFileSync(vapidPath, JSON.stringify(keys));
    console.log('Saved generated VAPID keys to data/vapid.json');
  } catch (err) {
    console.error('Failed to save vapid.json:', err);
  }

  console.warn(`\nPlease add these to your Render Environment Variables:`);
  console.warn(`VAPID_PUBLIC_KEY=${vapidPublicKey}`);
  console.warn(`VAPID_PRIVATE_KEY=${vapidPrivateKey}`);
  console.warn("===============================================================\n");
}

webpush.setVapidDetails(
  `mailto:${process.env.EMAIL_USER || 'admin@example.com'}`,
  vapidPublicKey,
  vapidPrivateKey
);

async function startServer() {
  const app = express();
  app.use(express.json());

  // Initialize database
  await initDB();

  // API Routes
  app.get('/api/status', async (req, res) => {
    try {
      const status = await getStatus();
      res.json(status);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch status' });
    }
  });

  app.get('/api/logs', async (req, res) => {
    try {
      const logs = await getLogs();
      res.json(logs);
    } catch (error) {
      res.status(500).json({ error: 'Failed to fetch logs' });
    }
  });

  app.post('/api/check', async (req, res) => {
    try {
      await checkWebsite();
      res.json({ success: true, message: 'Manual check triggered' });
    } catch (error) {
      console.error('Manual check failed:', error);
      res.status(500).json({ error: 'Manual check failed' });
    }
  });

  app.get('/api/vapidPublicKey', (req, res) => {
    res.send(vapidPublicKey);
  });

  app.post('/api/subscribe', async (req, res) => {
    try {
      const subscription = req.body;
      await addSubscription(subscription.endpoint, subscription.keys);
      res.status(201).json({ success: true });
    } catch (error) {
      console.error('Failed to save subscription:', error);
      res.status(500).json({ error: 'Failed to save subscription' });
    }
  });

  app.post('/api/test-notification', async (req, res) => {
    try {
      const { delay = 0, subscription } = req.body || {};
      const { sendNotification } = await import('./src/server/notifications.js');
      
      const realMessage = '🚨 JEE Main Admit Card may have been released!\n\nFound: "admit card"\n\nCheck the official website now: https://jeemain.nta.nic.in/';

      const sendTestPush = async () => {
        if (subscription) {
          // Send to single device
          try {
            const payload = JSON.stringify({
              title: 'JEE Main Tracker Update',
              body: realMessage.replace(/\*/g, ''),
              icon: '/vite.svg'
            });
            await webpush.sendNotification(subscription, payload);
            console.log('Single device test notification sent successfully.');
          } catch (e: any) {
            console.error('Single device test notification failed', e);
            if (e.statusCode === 410 || e.statusCode === 404 || e.statusCode === 401 || e.statusCode === 403) {
              throw new Error('SUBSCRIPTION_INVALID');
            }
            throw e;
          }
        } else {
          // Fallback to broadcast if no subscription provided
          await sendNotification(realMessage);
        }
      };

      if (delay > 0) {
        setTimeout(async () => {
          try {
            await sendTestPush();
          } catch (e) {
            console.error('Delayed test push failed:', e);
          }
        }, delay * 1000);
        res.json({ success: true, message: `Test notification scheduled in ${delay} seconds` });
      } else {
        try {
          await sendTestPush();
          res.json({ success: true, message: 'Test notification sent' });
        } catch (e: any) {
          if (e.message === 'SUBSCRIPTION_INVALID') {
            res.status(400).json({ error: 'SUBSCRIPTION_INVALID' });
          } else {
            res.status(500).json({ error: 'Failed to send test notification' });
          }
        }
      }
    } catch (error) {
      console.error('Test notification failed:', error);
      res.status(500).json({ error: 'Failed to send test notification' });
    }
  });

  // Schedule cron job to run every 10 seconds
  cron.schedule('*/10 * * * * *', async () => {
    console.log('Running scheduled website check...');
    await checkWebsite();
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    // Support Express v4
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
    // Run initial check on startup
    checkWebsite().catch(console.error);
  });
}

startServer();
