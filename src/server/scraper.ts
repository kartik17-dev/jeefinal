import axios from 'axios';
import * as cheerio from 'cheerio';
import { getStatus, updateStatus, addLog } from './db.js';
import { sendNotification } from './notifications.js';

const TARGET_URL = 'https://results.cbse.nic.in/';

// Keywords to look for (keeping these for compatibility, though any change will trigger)
const ADMIT_CARD_KEYWORDS = ['admit card', 'download admit card', 'hall ticket'];
const RESPONSE_SHEET_KEYWORDS = ['response sheet', 'answer key', 'provisional answer key', 'challenge answer key'];
const RESULT_KEYWORDS = ['result', 'score card', 'percentile', 'declared result'];

export async function checkWebsite() {
  try {
    const currentStatus = await getStatus() as any;

    // Skip if tracking is paused
    if (currentStatus.isTracking === 0) {
      // console.log('Tracking is paused. Skipping check.');
      return;
    }

    const response = await axios.get(TARGET_URL, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
      },
      timeout: 15000,
    });

    const html = response.data;
    const $ = cheerio.load(html);
    
    // Remove scripts and styles for cleaner text extraction
    $('script, style, noscript').remove();
    const textContent = $('body').text().replace(/\s+/g, ' ').trim().toLowerCase();
    
    let updates: any = {};
    let changesDetected = false;
    let notificationMessage = '';
    let shouldPauseTracking = false;

    // Baseline establishment: If we have no lastHtmlSnapshot, save current text content and exit
    if (!currentStatus.lastHtmlSnapshot) {
      await updateStatus({ lastHtmlSnapshot: textContent });
      await addLog('SYSTEM', 'Baseline established. Monitoring for any changes.', `Site length: ${textContent.length} chars.`);
      return;
    }

    // Check for any content change
    if (textContent !== currentStatus.lastHtmlSnapshot) {
      changesDetected = true;
      shouldPauseTracking = true;
      updates.lastHtmlSnapshot = textContent;
      updates.lastChangeDetectedAt = new Date().toISOString();
      updates.isTracking = false; // Stop tracking as requested
      
      // Determine what changed specifically if possible (keyword check)
      const isAdmitCard = !currentStatus.admitCardReleased && ADMIT_CARD_KEYWORDS.some(k => textContent.includes(k));
      const isResponseSheet = !currentStatus.responseSheetReleased && RESPONSE_SHEET_KEYWORDS.some(k => textContent.includes(k));
      const isResult = !currentStatus.resultReleased && RESULT_KEYWORDS.some(k => textContent.includes(k));

      if (isAdmitCard) updates.admitCardReleased = true;
      if (isResponseSheet) updates.responseSheetReleased = true;
      
      // If any change occurs, we trigger resultReleased to play the sound in the UI
      // and send a general update notification
      if (!currentStatus.resultReleased) {
        updates.resultReleased = true;
      } else {
        // If it's already true, we might want to toggle it or just keep it true
        // But the user said "once u detect any change play the sound"
        // The App.tsx checks for false -> true transition.
        // So let's reset it if it was true so it can trigger again? 
        // Or better, the UI should handle "re-triggering" if possible.
        // For now, let's just make sure it's true.
      }

      notificationMessage = `🚨 **Website Change Detected!**\n\nThe content of the monitored site has changed.\n\n`;
      
      if (isAdmitCard) notificationMessage += `🔹 Possible Admit Card update detected.\n`;
      if (isResponseSheet) notificationMessage += `🔹 Possible Response Sheet update detected.\n`;
      if (isResult) notificationMessage += `🔹 Possible Result update detected.\n`;

      await addLog('UPDATE', 'Website content change detected', `Content length changed from ${currentStatus.lastHtmlSnapshot.length} to ${textContent.length}`);
    }

    // Extract links for logging (even if no change, or as part of change info)
    const links: { text: string; href: string }[] = [];
    $('a').each((_, el) => {
      const text = $(el).text().trim().toLowerCase();
      const href = $(el).attr('href') || '';
      if (text && href && !href.startsWith('#')) {
        links.push({ text, href });
      }
    });

    // Update known links in DB
    updates.knownLinks = JSON.stringify(links);

    // Update DB
    await updateStatus(updates);
    
    // Log successful check
    if (!changesDetected) {
      await addLog('CHECK', 'Website checked successfully, no new updates.');
    } else {
      // Send notifications
      notificationMessage += `\nCheck it out here: ${TARGET_URL}`;
      await sendNotification(notificationMessage);
    }

  } catch (error: any) {
    console.error('Error checking website:', error.message);
    await addLog('ERROR', 'Failed to check website', error.message);
  }
}

function checkKeywordsSingle(link: { text: string; href: string }, keywords: string[]): boolean {
  for (const keyword of keywords) {
    if (link.text.includes(keyword)) {
      return true;
    }
  }
  return false;
}
