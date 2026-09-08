const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use('/api/', limiter);
app.use(express.static(path.join(__dirname, 'public')));

const DOWNLOAD_DIR = path.join(__dirname, 'downloads');
if (!fs.existsSync(DOWNLOAD_DIR)) {
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
  console.log('📁 Created downloads directory');
}

const DEBUG_DIR = path.join(__dirname, 'debug_screenshots');
if (!fs.existsSync(DEBUG_DIR)) {
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
  console.log('📸 Created debug screenshots directory');
}

// ============== VERCEL WEBHOOK URL ==============
const VERCEL_WEBHOOK_URL = 'https://fetchgram-one.vercel.app/api/webhook/caption';

// ============== CAPTURE SCREENSHOT (DISABLE FOR SPEED) ==============

let screenshotCounter = 0;
const MAX_SCREENSHOTS = 5; // Only capture first 5 screenshots for debugging

async function captureScreenshot(page, step, description) {
  // ✅ Only capture limited screenshots to save time
  if (screenshotCounter >= MAX_SCREENSHOTS) {
    return null;
  }
  
  try {
    screenshotCounter++;
    const timestamp = Date.now();
    const filename = `${timestamp}_${step}.png`;
    const filepath = path.join(DEBUG_DIR, filename);
    await page.screenshot({ 
      path: filepath,
      fullPage: true,
      type: 'png'
    });
    console.log(`📸 Screenshot saved: ${filename} (${description})`);
    return {
      filename: filename,
      filepath: filepath,
      url: `/debug-screenshots/${filename}`,
      step: step,
      description: description,
      timestamp: timestamp
    };
  } catch (e) {
    console.log(`⚠️ Could not take screenshot: ${e.message}`);
    return null;
  }
}

// ============== BROWSER SETUP ==============

const { chromium } = require('playwright');

let browser = null;
let browserInitPromise = null;
let isBrowserReady = false;

async function initBrowser() {
  if (browser && isBrowserReady) return browser;
  if (browserInitPromise) return browserInitPromise;

  browserInitPromise = (async () => {
    try {
      console.log('🚀 Launching browser...');
      
      let executablePath = null;
      if (process.env.RENDER) {
        const renderPaths = [
          '/usr/bin/google-chrome',
          '/usr/bin/chromium',
          '/usr/bin/chromium-browser'
        ];
        for (const path of renderPaths) {
          if (fs.existsSync(path)) {
            executablePath = path;
            console.log(`✅ Found Chrome at: ${path}`);
            break;
          }
        }
        if (!executablePath) {
          console.log('⚠️ No Chrome found on Render, using Playwright default');
        }
      }

      browser = await chromium.launch({
        headless: true,
        executablePath: executablePath || undefined,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-web-security',
          '--disable-features=IsolateOrigins,site-per-process',
          '--disable-blink-features=AutomationControlled',
          '--disable-infobars',
          '--window-size=1366,768'
        ]
      });

      isBrowserReady = true;
      console.log('✅ Browser launched successfully');
      return browser;
    } catch (error) {
      console.error('❌ Failed to launch browser:', error.message);
      browserInitPromise = null;
      isBrowserReady = false;
      throw error;
    }
  })();

  return browserInitPromise;
}

// ============== HANDLE ADS (SIMPLIFIED) ==============

async function handleAds(page) {
  try {
    // ✅ Only try ESC key - fastest method
    await page.keyboard.press('Escape');
    return true;
  } catch (error) {
    return false;
  }
}

// ============== SEND TO VERCEL WEBHOOK ==============

async function sendToVercel(instagramUrl, videoUrl, caption) {
    try {
        console.log(`📤 Sending to Vercel webhook...`);
        
        const payload = {
            reel_url: instagramUrl,
            video_url: videoUrl,
            caption: caption || '',
            status: 'completed',
            timestamp: new Date().toISOString(),
            source: 'snapsave_scraper'
        };
        
        const response = await fetch(VERCEL_WEBHOOK_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'IG-Reels-Scraper/1.0'
            },
            body: JSON.stringify(payload),
            timeout: 30000
        });
        
        if (response.ok) {
            console.log(`✅ Successfully sent to Vercel webhook`);
            return true;
        } else {
            console.log(`⚠️ Vercel webhook returned ${response.status}`);
            return false;
        }
    } catch (error) {
        console.log(`⚠️ Failed to send to Vercel: ${error.message}`);
        return false;
    }
}

// ============== SPEED OPTIMIZED DOWNLOAD ==============

async function downloadViaSnapsave(instagramUrl) {
  console.log('📥 Processing via snapsave.app...');
  
  let page = null;
  const startTime = Date.now();
  const screenshots = [];
  let caption = '';
  
  try {
    const browserInstance = await initBrowser();
    page = await browserInstance.newPage();
    await page.setViewportSize({ width: 1366, height: 768 });
    page.setDefaultTimeout(30000); // ✅ Reduced from 60s to 30s

    // ✅ Step 1: Navigate with faster wait
    console.log('🌐 Navigating to snapsave.app...');
    await page.goto('https://snapsave.app/', { 
      waitUntil: 'domcontentloaded',
      timeout: 15000 // ✅ Reduced from 30s to 15s
    });
    await page.waitForTimeout(1000); // ✅ Reduced from 3000ms to 1000ms

    // ✅ Step 2: Handle ads (fast)
    await handleAds(page);

    // ✅ Step 3: Enter URL (faster)
    console.log('✏️ Entering URL...');
    try {
      const urlInput = page.getByRole('textbox', { name: 'Url' });
      await urlInput.fill(instagramUrl);
      await page.waitForTimeout(300); // ✅ Reduced from 1000ms to 300ms
    } catch (error) {
      const urlInput = page.locator('input[type="text"], input[placeholder*="Url"]');
      await urlInput.first().fill(instagramUrl);
      await page.waitForTimeout(300);
    }

    // ✅ Step 4: Click download
    console.log('🔄 Clicking download button...');
    try {
      const downloadBtn = page.getByRole('button', { name: 'Download' });
      await downloadBtn.click();
    } catch (error) {
      const downloadBtn = page.locator('button:has-text("Download"), input[value="Download"]');
      await downloadBtn.first().click();
    }
    
    // ✅ Step 5: Wait shorter for thumbnail
    console.log('⏳ Waiting for thumbnail...');
    try {
      await page.waitForSelector('img[alt*="Download"], img[src*="rapidcdn"]', { 
        timeout: 10000 // ✅ Reduced from 30s to 10s
      });
    } catch (error) {
      console.log('⚠️ Thumbnail not found, continuing...');
    }
    
    await page.waitForTimeout(1500); // ✅ Reduced from 3000ms to 1500ms

    // ✅ Step 6: Find link with ONE combined method
    console.log('🔍 Finding video link...');
    
    let rapidCdnUrl = null;

    // ✅ Combined search - one pass only
    const allLinks = await page.$$eval('a', (links) => 
      links
        .filter(link => {
          const href = link.href || '';
          const text = link.textContent?.toLowerCase() || '';
          return (href.includes('rapidcdn') || href.includes('.mp4')) && 
                 !href.includes('facebook') &&
                 !text.includes('facebook');
        })
        .map(link => link.href)
    );
    
    // ✅ Try Instagram button if no rapidcdn found
    if (allLinks.length === 0) {
      try {
        const instagramBtn = page.locator('a:has-text("Download Video Instagram")');
        if (await instagramBtn.isVisible({ timeout: 3000 })) {
          await instagramBtn.first().click();
          await page.waitForTimeout(1500);
          
          const afterClickLinks = await page.$$eval('a[href*="rapidcdn"]', (elements) => 
            elements
              .filter(el => {
                const href = el.href || '';
                return !href.includes('facebook');
              })
              .map(el => el.href)
          );
          if (afterClickLinks.length > 0) {
            rapidCdnUrl = afterClickLinks[0];
          }
        }
      } catch (error) {}
    } else {
      // Use first valid link
      rapidCdnUrl = allLinks[0];
    }

    if (!rapidCdnUrl) {
      throw new Error('Could not find Instagram video download URL');
    }

    console.log(`✅ Instagram video URL found`);

    // ✅ Step 7: Get caption (faster)
    try {
      const captionEl = await page.locator('.caption, .description, [class*="caption"]').first();
      if (await captionEl.isVisible({ timeout: 1000 })) {
        const text = await captionEl.textContent();
        if (text && text.trim().length > 10 && 
            !text.includes('Error') && 
            !text.includes('Download') &&
            !text.includes('SnapSave')) {
          caption = text.trim();
        }
      }
    } catch (error) {}

    // ✅ Step 8: Download video
    console.log(`📥 Downloading video...`);
    const response = await fetch(rapidCdnUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const buffer = Buffer.from(await response.arrayBuffer());
    const filename = `video_${Date.now()}.mp4`;
    const filepath = path.join(DOWNLOAD_DIR, filename);
    fs.writeFileSync(filepath, buffer);

    const stats = fs.statSync(filepath);
    const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
    const downloadTime = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`✅ Video downloaded: ${filename} (${fileSizeMB} MB) in ${downloadTime}s`);

    return {
      success: true,
      filename: filename,
      downloadUrl: rapidCdnUrl,
      directDownloadUrl: rapidCdnUrl,
      fileSize: `${fileSizeMB} MB`,
      downloadTime: `${downloadTime}s`,
      originalUrl: instagramUrl,
      isDirectUrl: true,
      source: 'snapsave_app',
      localPath: filepath,
      screenshots: screenshots,
      caption: caption || ''
    };

  } catch (error) {
    if (page) {
      await page.close();
    }
    const err = new Error(error.message);
    throw err;
  } finally {
    if (page) {
      await page.close();
      console.log('🔒 Page closed');
    }
  }
}

// ============== MAIN DOWNLOAD FUNCTION ==============

async function downloadVideo(instagramUrl) {
  console.log(`\n📥 Processing: ${instagramUrl}`);
  
  try {
    const result = await downloadViaSnapsave(instagramUrl);
    
    if (result && result.success) {
      console.log(`✅ Video downloaded successfully!`);
      
      await sendToVercel(instagramUrl, result.downloadUrl, result.caption || '');
      
      return result;
    }
    
    throw new Error('Download failed');
    
  } catch (error) {
    console.error(`❌ Download error: ${error.message}`);
    throw error;
  }
}

// ============== API ROUTES ==============

app.post('/api/download', async (req, res) => {
  try {
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({ 
        success: false,
        error: 'URL is required' 
      });
    }

    if (!url.includes('instagram.com') && !url.includes('instagr.am')) {
      return res.status(400).json({ 
        success: false,
        error: 'Please provide a valid Instagram URL' 
      });
    }

    console.log(`\n📥 New download request for: ${url}`);
    
    const result = await downloadVideo(url);
    
    res.json({
      success: true,
      data: {
        ...result,
        webhook_sent: true
      }
    });

  } catch (error) {
    console.error('❌ API Error:', error.message);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to download video. Please try again.'
    });
  }
});

// Serve downloaded files
app.use('/downloads', express.static(DOWNLOAD_DIR));

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check
app.get('/health', async (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    downloadDir: DOWNLOAD_DIR,
    debugDir: DEBUG_DIR,
    downloadCount: fs.existsSync(DOWNLOAD_DIR) ? fs.readdirSync(DOWNLOAD_DIR).length : 0,
    screenshotCount: fs.existsSync(DEBUG_DIR) ? fs.readdirSync(DEBUG_DIR).length : 0
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found'
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

// Start server
app.listen(PORT, () => {
  console.log('\n' + '═'.repeat(60));
  console.log('🚀 Instagram Video Downloader (Snapsave)');
  console.log('═'.repeat(60));
  console.log(`🌐 Server running on port ${PORT}`);
  console.log(`🕐 Started: ${new Date().toISOString()}`);
  console.log('═'.repeat(60) + '\n');
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down...');
  if (browser) {
    try {
      await browser.close();
    } catch (e) {}
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Shutting down...');
  if (browser) {
    try {
      await browser.close();
    } catch (e) {}
  }
  process.exit(0);
});

module.exports = app;