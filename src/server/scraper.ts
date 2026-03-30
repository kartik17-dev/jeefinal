import axios from 'axios';
import * as cheerio from 'cheerio';
import { getStatus, updateStatus, addLog } from './db.js';
import { sendNotification } from './notifications.js';

const JEE_MAIN_URL = 'https://jeemain.nta.nic.in/';

// Keywords to look for
const ADMIT_CARD_KEYWORDS = ['admit card', 'download admit card', 'hall ticket'];
const RESPONSE_SHEET_KEYWORDS = ['response sheet', 'answer key', 'provisional answer key', 'challenge answer key'];
const RESULT_KEYWORDS = ['result', 'score card', 'percentile', 'declared result'];

export async function checkWebsite() {
  try {
    const response = await axios.get(JEE_MAIN_URL, {
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
    const textContent = $('body').text().toLowerCase();
    
    // Extract all links
    const links: { text: string; href: string }[] = [];
    $('a').each((_, el) => {
      const text = $(el).text().trim().toLowerCase();
      const href = $(el).attr('href') || '';
      if (text && href && !href.startsWith('#')) {
        links.push({ text, href });
      }
    });

    const currentStatus = await getStatus() as any;
    let updates: any = {
      lastHtmlSnapshot: html.substring(0, 10000) // Store a snapshot for diffing if needed
    };
    let changesDetected = false;
    let notificationMessage = '';

    // Parse known links
    let knownLinks: { text: string; href: string }[] = [];
    try {
      if (currentStatus.knownLinks) {
        knownLinks = JSON.parse(currentStatus.knownLinks);
      }
    } catch (e) {
      console.error('Failed to parse knownLinks', e);
    }

    // Baseline establishment: If we have no known links, save current links and exit
    if (knownLinks.length === 0 && links.length > 0) {
      updates.knownLinks = JSON.stringify(links);
      await updateStatus(updates);
      await addLog('SYSTEM', 'Baseline established. Monitoring for new links.', `Saved ${links.length} initial links.`);
      return;
    }

    // Find new links that were not in the baseline
    const newLinks = links.filter(cl => 
      !knownLinks.some(kl => kl.href === cl.href && kl.text === cl.text)
    );

    if (newLinks.length > 0) {
      // We have new links! Let's check them.
      for (const link of newLinks) {
        let snippet = 'Snippet unavailable.';
        try {
          // Resolve relative URLs to absolute
          const absoluteUrl = new URL(link.href, JEE_MAIN_URL).href;
          link.href = absoluteUrl;

          if (absoluteUrl.startsWith('http') && !absoluteUrl.toLowerCase().endsWith('.pdf')) {
            const linkRes = await axios.get(absoluteUrl, { 
              timeout: 5000,
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
              }
            });
            
            const contentType = linkRes.headers['content-type'] || '';
            if (contentType.includes('text/html')) {
              const $linkPage = cheerio.load(linkRes.data);
              $linkPage('script, style, noscript').remove();
              
              let desc = $linkPage('meta[name="description"]').attr('content');
              if (!desc) {
                desc = $linkPage('p').first().text().trim();
              }
              if (!desc) {
                desc = $linkPage('body').text().replace(/\s+/g, ' ').trim();
              }
              if (desc) {
                snippet = desc.substring(0, 200) + (desc.length > 200 ? '...' : '');
              }
            } else {
              snippet = `File type: ${contentType}`;
            }
          } else if (absoluteUrl.toLowerCase().endsWith('.pdf')) {
            snippet = 'PDF Document';
          }
        } catch (err: any) {
          snippet = `Could not fetch page content.`;
        }

        const details = `URL: ${link.href}\nSnippet: ${snippet}`;
        await addLog('INFO', `New link detected: ${link.text}`, details);

        // Check Admit Card
        if (!currentStatus.admitCardReleased && checkKeywordsSingle(link, ADMIT_CARD_KEYWORDS)) {
          updates.admitCardReleased = true;
          changesDetected = true;
          notificationMessage += `🚨 **Admit Card Released!**\n[${link.text}](${link.href})\nSnippet: ${snippet}\n\n`;
          await addLog('UPDATE', 'Admit Card release detected', details);
        }

        // Check Response Sheet
        if (!currentStatus.responseSheetReleased && checkKeywordsSingle(link, RESPONSE_SHEET_KEYWORDS)) {
          updates.responseSheetReleased = true;
          changesDetected = true;
          notificationMessage += `🚨 **Response Sheet / Answer Key Released!**\n[${link.text}](${link.href})\nSnippet: ${snippet}\n\n`;
          await addLog('UPDATE', 'Response Sheet release detected', details);
        }

        // Check Result
        if (!currentStatus.resultReleased && checkKeywordsSingle(link, RESULT_KEYWORDS)) {
          updates.resultReleased = true;
          changesDetected = true;
          notificationMessage += `🚨 **JEE Main Result Declared!**\n[${link.text}](${link.href})\nSnippet: ${snippet}\n\n`;
          await addLog('UPDATE', 'Result declaration detected', details);
        }
      }

      // Update known links with the newly discovered ones
      const updatedKnownLinks = [...knownLinks, ...newLinks];
      updates.knownLinks = JSON.stringify(updatedKnownLinks);
    }

    // Update DB
    await updateStatus(updates);
    
    // Log successful check
    if (!changesDetected && newLinks.length === 0) {
      await addLog('CHECK', 'Website checked successfully, no new updates.');
    } else if (changesDetected) {
      // Send notifications
      notificationMessage += `\nCheck the official website: ${JEE_MAIN_URL}`;
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
