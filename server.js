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

// ============== ACTIVE REQUESTS TRACKING ==============
let activeRequests = 0;
let isShuttingDown = false;

// ============== BROWSER SETUP ==============

const { chromium } = require('playwright');

let browser = null;
let browserInitPromise = null;
let isBrowserReady = false;

function findChromePath() {
  // Render-specific paths
  const renderPaths = [
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/opt/render/.cache/ms-playwright/chromium-1234/chrome-linux/chrome',
    '/opt/render/.cache/ms-playwright/chromium-1200/chrome-linux/chrome'
  ];
  
  const localPaths = [
    'C:\\Users\\PC\\AppData\\Local\\ms-playwright\\chromium-1234\\chrome-win\\chrome.exe',
    'C:\\Users\\PC\\AppData\\Local\\ms-playwright\\chromium-1200\\chrome-win\\chrome.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ];
  
  const isRender = process.env.RENDER === 'true' || !!process.env.RENDER;
  const paths = isRender ? renderPaths : localPaths;
  
  for (const path of paths) {
    try {
      if (fs.existsSync(path)) {
        console.log(`✅ Found browser at: ${path}`);
        return path;
      }
    } catch (e) {}
  }
  
  console.log('⚠️ No browser found, using Playwright default');
  return null;
}

const isRender = process.env.RENDER === 'true' || !!process.env.RENDER;

async function initBrowser() {
  if (browser && isBrowserReady && !isShuttingDown) return browser;
  if (browserInitPromise) return browserInitPromise;

  browserInitPromise = (async () => {
    try {
      console.log('🚀 Launching browser...');
      
      const executablePath = findChromePath();

      browser = await chromium.launch({
        headless: true, // Always headless on Render
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
          '--window-size=1366,768',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--disable-ipc-flooding-protection'
        ]
      });

      isBrowserReady = true;
      console.log('✅ Browser launched successfully (headless)');
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

async function handleAds(page) {
  try {
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
            source: 'fitydown_scraper'
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

// ============== DOWNLOAD VIA INSTADL.FITYDOWN.COM ==============

async function downloadViaFitydown(instagramUrl) {
  console.log('📥 Processing via instadl.fitydown.com...');
  
  let page = null;
  const startTime = Date.now();
  let caption = '';
  let downloadUrl = null;
  
  try {
    if (isShuttingDown) {
      throw new Error('Server is shutting down');
    }
    
    const browserInstance = await initBrowser();
    page = await browserInstance.newPage();
    await page.setViewportSize({ width: 1366, height: 768 });
    page.setDefaultTimeout(60000);

    // Enable network interception
    await page.route('**/*', async (route) => {
      const url = route.request().url();
      
      if (url.includes('fitydown.onrender.com/download_file/')) {
        downloadUrl = url;
        console.log(`✅ Intercepted FityDown URL: ${downloadUrl}`);
      }
      
      if (url.includes('.mp4') || url.includes('video')) {
        if (!downloadUrl) {
          downloadUrl = url;
          console.log(`✅ Intercepted video URL: ${downloadUrl.substring(0, 60)}...`);
        }
      }
      
      await route.continue();
    });

    // 1. Navigate
    console.log('🌐 Navigating to instadl.fitydown.com...');
    await page.goto('https://instadl.fitydown.com/', { 
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    await page.waitForTimeout(2000);

    // 2. Handle ads
    await handleAds(page);

    // 3. Enter URL
    console.log('✏️ Entering URL...');
    const urlInput = page.getByRole('textbox', { name: 'Instagram video URL' });
    await urlInput.fill(instagramUrl);
    await page.waitForTimeout(500);

    // 4. Click Download
    console.log('🔄 Clicking Download button...');
    const downloadBtn = page.locator('#downloadBtn').getByText('Download');
    await downloadBtn.click();
    console.log('✅ Download initiated');

    // 5. Wait for MP4 button
    console.log('⏳ Waiting for MP4 download option...');
    await page.waitForTimeout(3000);
    
    // 6. Click MP4
    console.log('🔍 Looking for Download MP4 button...');
    const mp4Btn = page.locator('#btn-mp4').getByText('Download MP4 (Video)');
    
    if (await mp4Btn.isVisible({ timeout: 10000 })) {
      console.log('✅ Found MP4 button, clicking...');
      await mp4Btn.click();
      console.log('✅ MP4 download clicked!');
    } else {
      console.log('⚠️ MP4 button not found, trying alternative...');
      const altBtn = page.locator('button:has-text("MP4"), a:has-text("Download MP4")').first();
      if (await altBtn.isVisible({ timeout: 3000 })) {
        await altBtn.click();
        console.log('✅ Alternative MP4 button clicked!');
      }
    }

    // 7. Wait for URL interception
    console.log('⏳ Waiting for download URL to be intercepted...');
    let attempts = 0;
    while (!downloadUrl && attempts < 30) {
      await page.waitForTimeout(1000);
      attempts++;
      if (attempts % 5 === 0) {
        console.log(`⏳ Waiting for download URL... (${attempts}s)`);
      }
    }

    // 8. Fallback: Check page content
    if (!downloadUrl) {
      console.log('⚠️ URL not intercepted, checking page content...');
      
      try {
        const html = await page.content();
        const matches = html.match(/https:\/\/fitydown\.onrender\.com\/download_file\/[a-f0-9]+/gi);
        if (matches && matches.length > 0) {
          downloadUrl = matches[0];
          console.log(`✅ Found FityDown URL in HTML: ${downloadUrl.substring(0, 60)}...`);
        }
      } catch (error) {}
    }

    if (!downloadUrl) {
      try {
        await page.screenshot({ path: path.join(DEBUG_DIR, 'error_no_url.png'), fullPage: true });
        console.log('📸 Saved error screenshot: error_no_url.png');
      } catch (e) {}
      throw new Error('Could not find download URL');
    }

    console.log(`✅ Download URL captured: ${downloadUrl}`);

    // 9. Get caption
    try {
      const captionEl = await page.locator('.caption, .description, [class*="caption"]').first();
      if (await captionEl.isVisible({ timeout: 2000 })) {
        const text = await captionEl.textContent();
        if (text && text.trim().length > 10 && 
            !text.includes('Error') && 
            !text.includes('Download')) {
          caption = text.trim();
          console.log(`✅ Caption found: ${caption.substring(0, 50)}...`);
        }
      }
    } catch (error) {}

    console.log('⏳ Waiting 5 seconds before closing...');
    await page.waitForTimeout(5000);

    return {
      success: true,
      filename: `video_${Date.now()}.mp4`,
      downloadUrl: downloadUrl,
      directDownloadUrl: downloadUrl,
      fileSize: 'Unknown',
      downloadTime: `${((Date.now() - startTime) / 1000).toFixed(1)}s`,
      originalUrl: instagramUrl,
      isDirectUrl: true,
      source: 'fitydown',
      caption: caption || '',
      videoUrl: downloadUrl
    };

  } catch (error) {
    console.error(`❌ Download error: ${error.message}`);
    throw error;
  } finally {
    if (page) {
      try {
        await page.close();
        console.log('🔒 Page closed');
      } catch (e) {}
    }
  }
}

// ============== MAIN DOWNLOAD FUNCTION ==============

async function downloadVideo(instagramUrl) {
  console.log(`\n📥 Processing: ${instagramUrl}`);
  
  try {
    const result = await downloadViaFitydown(instagramUrl);
    
    if (result && result.success) {
      console.log(`✅ Video URL captured!`);
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
  activeRequests++;
  
  try {
    const { url } = req.body;
    
    if (!url) {
      activeRequests--;
      return res.status(400).json({ 
        success: false,
        error: 'URL is required' 
      });
    }

    if (!url.includes('instagram.com') && !url.includes('instagr.am')) {
      activeRequests--;
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
  } finally {
    activeRequests--;
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
    active_requests: activeRequests,
    is_shutting_down: isShuttingDown,
    is_render: isRender,
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

// ============== GRACEFUL SHUTDOWN ==============

async function gracefulShutdown(signal) {
  console.log(`\n🛑 Received ${signal}. Shutting down gracefully...`);
  isShuttingDown = true;
  
  let waitCount = 0;
  while (activeRequests > 0 && waitCount < 30) {
    console.log(`⏳ Waiting for ${activeRequests} active requests to complete...`);
    await new Promise(resolve => setTimeout(resolve, 1000));
    waitCount++;
  }
  
  if (activeRequests > 0) {
    console.log(`⚠️ ${activeRequests} requests still active, forcing shutdown...`);
  }
  
  if (browser) {
    try {
      await browser.close();
      console.log('🔒 Browser closed');
    } catch (e) {
      console.log('⚠️ Error closing browser:', e.message);
    }
  }
  
  console.log('👋 Goodbye!');
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection:', reason);
});

// Start server
app.listen(PORT, () => {
  console.log('\n' + '═'.repeat(60));
  console.log('🚀 Instagram Video Downloader (instadl.fitydown.com)');
  console.log('═'.repeat(60));
  console.log(`🌐 Server running on port ${PORT}`);
  console.log(`📡 Mode: ${isRender ? 'Render (headless)' : 'Local (visible)'}`);
  console.log(`🕐 Started: ${new Date().toISOString()}`);
  console.log('═'.repeat(60) + '\n');
});

module.exports = app;