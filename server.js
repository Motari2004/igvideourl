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

// ============== REQUEST LOGGING ==============
let requestLog = [];
const MAX_LOG_ENTRIES = 100;

function logRequest(level, message, data = null) {
    const entry = {
        timestamp: new Date().toISOString(),
        level: level,
        message: message,
        data: data
    };
    requestLog.push(entry);
    if (requestLog.length > MAX_LOG_ENTRIES) {
        requestLog.shift();
    }
    
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${level}: ${message}`);
    if (data) {
        console.log(`  └─ ${JSON.stringify(data, null, 2)}`);
    }
}

// ============== BROWSER SETUP ==============

const { chromium } = require('playwright');

let browser = null;
let browserInitPromise = null;
let isBrowserReady = false;

function findChromePath() {
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
        logRequest('INFO', `Found browser at: ${path}`);
        return path;
      }
    } catch (e) {}
  }
  
  logRequest('WARN', 'No browser found, using Playwright default');
  return null;
}

const isRender = process.env.RENDER === 'true' || !!process.env.RENDER;

async function initBrowser() {
  if (browser && isBrowserReady && !isShuttingDown) {
    logRequest('INFO', 'Browser already ready, reusing instance');
    return browser;
  }
  if (browserInitPromise) {
    logRequest('INFO', 'Browser initialization in progress, waiting...');
    return browserInitPromise;
  }

  browserInitPromise = (async () => {
    try {
      logRequest('INFO', '🚀 Launching browser...');
      
      const executablePath = findChromePath();

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
          '--window-size=1366,768',
          '--disable-background-timer-throttling',
          '--disable-backgrounding-occluded-windows',
          '--disable-renderer-backgrounding',
          '--disable-ipc-flooding-protection'
        ]
      });

      isBrowserReady = true;
      logRequest('INFO', '✅ Browser launched successfully (headless)');
      return browser;
    } catch (error) {
      logRequest('ERROR', `❌ Failed to launch browser: ${error.message}`);
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

// ============== SEND VIDEO URL TO VERCEL WEBHOOK WITH PIPELINE & POST ID ==============

async function sendVideoUrlToVercel(instagramUrl, videoUrl, pipelineId = null, postId = null, profileUsername = null) {
    try {
        logRequest('INFO', `📤 Sending video URL to Vercel webhook...`, { 
            instagramUrl: instagramUrl.substring(0, 50) + '...',
            videoUrl: videoUrl.substring(0, 50) + '...',
            pipelineId: pipelineId || 'None',
            postId: postId || 'None',
            profileUsername: profileUsername || 'None'
        });
        
        const payload = {
            reel_url: instagramUrl,
            video_url: videoUrl,
            pipeline_id: pipelineId,           // ✅ Forward pipeline_id
            post_id: postId,                   // ✅ Forward post_id
            profile_username: profileUsername, // ✅ Forward profile username
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
            logRequest('INFO', `✅ Successfully sent video URL to Vercel webhook`, { status: response.status });
            return true;
        } else {
            logRequest('WARN', `⚠️ Vercel webhook returned ${response.status}`);
            return false;
        }
    } catch (error) {
        logRequest('ERROR', `⚠️ Failed to send to Vercel: ${error.message}`);
        return false;
    }
}

// ============== DOWNLOAD VIDEO URL ONLY (NO CAPTION) ==============

async function downloadVideoUrlOnly(instagramUrl) {
  logRequest('INFO', `📥 Processing video URL only for: ${instagramUrl.substring(0, 60)}...`);
  
  let page = null;
  const startTime = Date.now();
  let downloadUrl = null;
  let stepTimings = {};
  let stepStart = Date.now();
  
  try {
    if (isShuttingDown) {
      throw new Error('Server is shutting down');
    }
    
    // Step 1: Initialize browser
    stepStart = Date.now();
    logRequest('INFO', '🔧 Step 1: Initializing browser...');
    const browserInstance = await initBrowser();
    stepTimings.browserInit = ((Date.now() - stepStart) / 1000).toFixed(1) + 's';
    logRequest('INFO', `✅ Browser initialized in ${stepTimings.browserInit}`);
    
    // Step 2: Create new page
    stepStart = Date.now();
    logRequest('INFO', '📄 Step 2: Creating new page...');
    page = await browserInstance.newPage();
    await page.setViewportSize({ width: 1366, height: 768 });
    page.setDefaultTimeout(60000);
    stepTimings.pageCreate = ((Date.now() - stepStart) / 1000).toFixed(1) + 's';
    logRequest('INFO', `✅ Page created in ${stepTimings.pageCreate}`);

    // Step 3: Enable network interception
    stepStart = Date.now();
    logRequest('INFO', '🔍 Step 3: Setting up network interception for video URLs...');
    await page.route('**/*', async (route) => {
      const url = route.request().url();
      
      if (url.includes('fitydown.onrender.com/download_file/')) {
        downloadUrl = url;
        logRequest('INFO', `✅ Intercepted video URL: ${downloadUrl.substring(0, 60)}...`);
      }
      
      if (url.includes('.mp4') || url.includes('video')) {
        if (!downloadUrl) {
          downloadUrl = url;
          logRequest('INFO', `✅ Intercepted video URL: ${downloadUrl.substring(0, 60)}...`);
        }
      }
      
      await route.continue();
    });
    stepTimings.networkSetup = ((Date.now() - stepStart) / 1000).toFixed(1) + 's';
    logRequest('INFO', `✅ Network interception setup in ${stepTimings.networkSetup}`);

    // Step 4: Navigate to fitydown
    stepStart = Date.now();
    logRequest('INFO', '🌐 Step 4: Navigating to instadl.fitydown.com...');
    await page.goto('https://instadl.fitydown.com/', { 
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    stepTimings.navigate = ((Date.now() - stepStart) / 1000).toFixed(1) + 's';
    logRequest('INFO', `✅ Navigation completed in ${stepTimings.navigate}`);
    
    await page.waitForTimeout(2000);
    logRequest('INFO', '⏳ Waited 2s for page to stabilize');

    // Step 5: Handle ads
    stepStart = Date.now();
    logRequest('INFO', '🛡️ Step 5: Handling ads...');
    await handleAds(page);
    stepTimings.adHandling = ((Date.now() - stepStart) / 1000).toFixed(1) + 's';
    logRequest('INFO', `✅ Ads handled in ${stepTimings.adHandling}`);

    // Step 6: Enter URL
    stepStart = Date.now();
    logRequest('INFO', '✏️ Step 6: Entering URL...');
    const urlInput = page.getByRole('textbox', { name: 'Instagram video URL' });
    await urlInput.fill(instagramUrl);
    await page.waitForTimeout(500);
    stepTimings.urlEntry = ((Date.now() - stepStart) / 1000).toFixed(1) + 's';
    logRequest('INFO', `✅ URL entered in ${stepTimings.urlEntry}`);

    // Step 7: Click Download
    stepStart = Date.now();
    logRequest('INFO', '🔄 Step 7: Clicking Download button...');
    const downloadBtn = page.locator('#downloadBtn').getByText('Download');
    await downloadBtn.click();
    stepTimings.downloadClick = ((Date.now() - stepStart) / 1000).toFixed(1) + 's';
    logRequest('INFO', `✅ Download button clicked in ${stepTimings.downloadClick}`);

    // Step 8: Wait for MP4 button
    stepStart = Date.now();
    logRequest('INFO', '⏳ Step 8: Waiting for MP4 download option...');
    await page.waitForTimeout(3000);
    stepTimings.mp4Wait = ((Date.now() - stepStart) / 1000).toFixed(1) + 's';
    logRequest('INFO', `✅ MP4 option wait completed in ${stepTimings.mp4Wait}`);
    
    // Step 9: Click MP4
    stepStart = Date.now();
    logRequest('INFO', '🔍 Step 9: Looking for Download MP4 button...');
    const mp4Btn = page.locator('#btn-mp4').getByText('Download MP4 (Video)');
    
    if (await mp4Btn.isVisible({ timeout: 10000 })) {
      logRequest('INFO', '✅ Found MP4 button, clicking...');
      await mp4Btn.click();
      stepTimings.mp4Click = ((Date.now() - stepStart) / 1000).toFixed(1) + 's';
      logRequest('INFO', `✅ MP4 download clicked in ${stepTimings.mp4Click}`);
    } else {
      logRequest('WARN', '⚠️ MP4 button not found, trying alternative...');
      const altBtn = page.locator('button:has-text("MP4"), a:has-text("Download MP4")').first();
      if (await altBtn.isVisible({ timeout: 3000 })) {
        await altBtn.click();
        stepTimings.mp4Click = ((Date.now() - stepStart) / 1000).toFixed(1) + 's';
        logRequest('INFO', `✅ Alternative MP4 button clicked in ${stepTimings.mp4Click}`);
      } else {
        stepTimings.mp4Click = 'failed';
        logRequest('ERROR', '❌ No MP4 button found');
      }
    }

    // Step 10: Wait for URL interception
    stepStart = Date.now();
    logRequest('INFO', '⏳ Step 10: Waiting for video URL to be intercepted...');
    let attempts = 0;
    while (!downloadUrl && attempts < 30) {
      await page.waitForTimeout(1000);
      attempts++;
      if (attempts % 5 === 0) {
        logRequest('INFO', `⏳ Waiting for video URL... (${attempts}s)`);
      }
    }
    stepTimings.urlWait = ((Date.now() - stepStart) / 1000).toFixed(1) + 's';
    
    if (downloadUrl) {
      logRequest('INFO', `✅ Video URL intercepted in ${stepTimings.urlWait}`);
    } else {
      logRequest('WARN', `⚠️ No URL intercepted after ${attempts}s`);
    }

    // Step 11: Fallback - Check page content
    if (!downloadUrl) {
      stepStart = Date.now();
      logRequest('WARN', '⚠️ Step 11: URL not intercepted, checking page content...');
      
      try {
        const html = await page.content();
        const matches = html.match(/https:\/\/fitydown\.onrender\.com\/download_file\/[a-f0-9]+/gi);
        if (matches && matches.length > 0) {
          downloadUrl = matches[0];
          stepTimings.htmlCheck = ((Date.now() - stepStart) / 1000).toFixed(1) + 's';
          logRequest('INFO', `✅ Found video URL in HTML: ${downloadUrl.substring(0, 60)}...`);
        } else {
          stepTimings.htmlCheck = 'no match';
          logRequest('WARN', '⚠️ No video URL found in HTML content');
        }
      } catch (error) {
        stepTimings.htmlCheck = 'error';
        logRequest('ERROR', `❌ HTML check error: ${error.message}`);
      }
    }

    // Step 12: Error if no URL
    if (!downloadUrl) {
      logRequest('ERROR', '❌ Step 12: Could not find video URL');
      try {
        const screenshotPath = path.join(DEBUG_DIR, `error_${Date.now()}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        logRequest('INFO', `📸 Saved error screenshot: ${screenshotPath}`);
      } catch (e) {
        logRequest('ERROR', `❌ Screenshot error: ${e.message}`);
      }
      throw new Error('Could not find video URL');
    }

    logRequest('INFO', `✅ Video URL captured: ${downloadUrl}`);

    // Step 13: Final wait before closing
    logRequest('INFO', '⏳ Step 13: Waiting 3 seconds before closing...');
    await page.waitForTimeout(3000);
    stepTimings.finalWait = '3s';

    // Calculate total time
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
    
    logRequest('INFO', '📊 TIMING SUMMARY:', {
      totalTime: `${totalTime}s`,
      steps: stepTimings
    });

    return {
      success: true,
      filename: `video_${Date.now()}.mp4`,
      downloadUrl: downloadUrl,
      directDownloadUrl: downloadUrl,
      fileSize: 'Unknown',
      downloadTime: `${totalTime}s`,
      originalUrl: instagramUrl,
      isDirectUrl: true,
      source: 'fitydown',
      videoUrl: downloadUrl,
      timings: stepTimings,
      logs: requestLog.slice(-20)
    };

  } catch (error) {
    logRequest('ERROR', `❌ Download error: ${error.message}`);
    logRequest('ERROR', `Stack trace: ${error.stack}`);
    throw error;
  } finally {
    if (page) {
      try {
        await page.close();
        logRequest('INFO', '🔒 Page closed');
      } catch (e) {
        logRequest('WARN', `⚠️ Page close error: ${e.message}`);
      }
    }
  }
}

// ============== MAIN DOWNLOAD FUNCTION ==============

async function downloadVideo(instagramUrl, pipelineId = null, postId = null, profileUsername = null) {
  logRequest('INFO', `\n📥 Processing video URL for: ${instagramUrl.substring(0, 60)}...`);
  logRequest('INFO', `   Pipeline ID: ${pipelineId || 'None'}`);
  logRequest('INFO', `   Post ID: ${postId || 'None'}`);
  logRequest('INFO', `   Profile Username: ${profileUsername || 'None'}`);
  
  try {
    const result = await downloadVideoUrlOnly(instagramUrl);
    
    if (result && result.success) {
      logRequest('INFO', `✅ Video URL captured!`, { 
        url: result.downloadUrl.substring(0, 50) + '...',
        time: result.downloadTime
      });
      
      // ✅ Send video URL with pipeline_id, post_id, and profile_username
      await sendVideoUrlToVercel(
        instagramUrl, 
        result.downloadUrl, 
        pipelineId, 
        postId, 
        profileUsername
      );
      return result;
    }
    
    throw new Error('Download failed');
    
  } catch (error) {
    logRequest('ERROR', `❌ Download error: ${error.message}`);
    throw error;
  }
}

// ============== API ROUTES ==============

app.post('/api/download', async (req, res) => {
  const requestId = Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
  activeRequests++;
  
  logRequest('INFO', `🚀 [${requestId}] New download request received`, {
    source: req.headers['user-agent'] || 'unknown',
    ip: req.ip || req.connection.remoteAddress,
    activeRequests: activeRequests
  });
  
  try {
    const { url, pipeline_id, post_id, profile_username } = req.body;
    
    if (!url) {
      activeRequests--;
      logRequest('WARN', `[${requestId}] Missing URL parameter`);
      return res.status(400).json({ 
        success: false,
        error: 'URL is required',
        requestId: requestId
      });
    }

    if (!url.includes('instagram.com') && !url.includes('instagr.am')) {
      activeRequests--;
      logRequest('WARN', `[${requestId}] Invalid Instagram URL: ${url.substring(0, 50)}...`);
      return res.status(400).json({ 
        success: false,
        error: 'Please provide a valid Instagram URL',
        requestId: requestId
      });
    }

    logRequest('INFO', `[${requestId}] Processing URL: ${url.substring(0, 60)}...`);
    logRequest('INFO', `[${requestId}] Pipeline ID: ${pipeline_id || 'None'}`);
    logRequest('INFO', `[${requestId}] Post ID: ${post_id || 'None'}`);
    logRequest('INFO', `[${requestId}] Profile Username: ${profile_username || 'None'}`);
    
    const result = await downloadVideo(url, pipeline_id, post_id, profile_username);
    
    logRequest('INFO', `[${requestId}] ✅ Download successful`, {
      url: result.downloadUrl.substring(0, 50) + '...',
      time: result.downloadTime
    });
    
    res.json({
      success: true,
      requestId: requestId,
      data: {
        ...result,
        webhook_sent: true,
        pipeline_id: pipeline_id,
        post_id: post_id,
        profile_username: profile_username
      }
    });

  } catch (error) {
    logRequest('ERROR', `[${requestId}] ❌ API Error: ${error.message}`);
    logRequest('ERROR', `[${requestId}] Stack: ${error.stack}`);
    res.status(500).json({
      success: false,
      requestId: requestId,
      error: error.message || 'Failed to download video. Please try again.'
    });
  } finally {
    activeRequests--;
    logRequest('INFO', `[${requestId}] Request completed. Active: ${activeRequests}`);
  }
});

// ============== LOGGING ENDPOINTS ==============

app.get('/api/logs', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const logs = requestLog.slice(-limit);
  res.json({
    status: 'ok',
    count: logs.length,
    total: requestLog.length,
    logs: logs
  });
});

app.get('/api/stats', (req, res) => {
  res.json({
    status: 'ok',
    activeRequests: activeRequests,
    totalRequests: requestLog.filter(log => log.level === 'INFO' && log.message.includes('New download request')).length,
    logCount: requestLog.length,
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    browserReady: isBrowserReady,
    isShuttingDown: isShuttingDown
  });
});

app.get('/health', async (req, res) => {
  const isRender = process.env.RENDER === 'true' || !!process.env.RENDER;
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    active_requests: activeRequests,
    is_shutting_down: isShuttingDown,
    is_render: isRender,
    browser_ready: isBrowserReady,
    memory: process.memoryUsage(),
    downloadDir: DOWNLOAD_DIR,
    debugDir: DEBUG_DIR,
    downloadCount: fs.existsSync(DOWNLOAD_DIR) ? fs.readdirSync(DOWNLOAD_DIR).length : 0,
    screenshotCount: fs.existsSync(DEBUG_DIR) ? fs.readdirSync(DEBUG_DIR).length : 0,
    logCount: requestLog.length
  });
});

app.use('/downloads', express.static(DOWNLOAD_DIR));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use((req, res) => {
  logRequest('WARN', `404: ${req.method} ${req.url}`);
  res.status(404).json({
    success: false,
    error: 'Route not found'
  });
});

app.use((err, req, res, next) => {
  logRequest('ERROR', `Server error: ${err.message}`);
  logRequest('ERROR', `Stack: ${err.stack}`);
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

// ============== GRACEFUL SHUTDOWN ==============

async function gracefulShutdown(signal) {
  logRequest('INFO', `\n🛑 Received ${signal}. Shutting down gracefully...`);
  isShuttingDown = true;
  
  let waitCount = 0;
  while (activeRequests > 0 && waitCount < 30) {
    logRequest('INFO', `⏳ Waiting for ${activeRequests} active requests to complete...`);
    await new Promise(resolve => setTimeout(resolve, 1000));
    waitCount++;
  }
  
  if (activeRequests > 0) {
    logRequest('WARN', `⚠️ ${activeRequests} requests still active, forcing shutdown...`);
  }
  
  if (browser) {
    try {
      await browser.close();
      logRequest('INFO', '🔒 Browser closed');
    } catch (e) {
      logRequest('WARN', `⚠️ Error closing browser: ${e.message}`);
    }
  }
  
  logRequest('INFO', '👋 Goodbye!');
  process.exit(0);
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

process.on('unhandledRejection', (reason, promise) => {
  logRequest('ERROR', `❌ Unhandled Rejection: ${reason}`);
  if (reason && reason.stack) {
    logRequest('ERROR', `Stack: ${reason.stack}`);
  }
});

process.on('uncaughtException', (error) => {
  logRequest('ERROR', `❌ Uncaught Exception: ${error.message}`);
  logRequest('ERROR', `Stack: ${error.stack}`);
});

app.listen(PORT, () => {
  console.log('\n' + '═'.repeat(60));
  console.log('🚀 Instagram Video URL Service');
  console.log('═'.repeat(60));
  console.log(`🌐 Server running on port ${PORT}`);
  console.log(`📡 Mode: ${isRender ? 'Render (headless)' : 'Local (visible)'}`);
  console.log(`🕐 Started: ${new Date().toISOString()}`);
  console.log(`📋 Logging enabled - ${MAX_LOG_ENTRIES} entries retained`);
  console.log('═'.repeat(60) + '\n');
});

module.exports = app;