import dotenv from 'dotenv';
import { addLog, getSubscriptions, removeSubscription } from './db.js';
import webpush from 'web-push';

dotenv.config();

export async function sendNotification(message: string) {
  if (!message) return;

  // Send Web Push Notifications
  try {
    const subscriptions = await getSubscriptions() as any[];
    
    if (subscriptions.length > 0) {
      const payload = JSON.stringify({
        title: 'JEE Main Tracker Update',
        body: message.replace(/\*/g, ''), // Strip markdown for push notification
        icon: '/vite.svg'
      });

      let successCount = 0;
      let failCount = 0;

      for (const sub of subscriptions) {
        try {
          const pushSubscription = {
            endpoint: sub.endpoint,
            keys: JSON.parse(sub.keys)
          };
          await webpush.sendNotification(pushSubscription, payload);
          successCount++;
        } catch (error: any) {
          if (error.statusCode === 410 || error.statusCode === 404) {
            // Subscription has expired or is no longer valid
            await removeSubscription(sub.id);
          }
          failCount++;
        }
      }
      
      if (successCount > 0) {
        await addLog('NOTIFICATION', `Web push sent to ${successCount} devices`);
      }
    }
  } catch (error: any) {
    console.error('Failed to send Web Push:', error);
    await addLog('ERROR', 'Failed to send Web Push', error.message);
  }
}
