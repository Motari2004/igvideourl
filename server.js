const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy - Required for rate limiting behind proxies (like Render)
app.set('trust proxy', 1);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use('/api/', limiter);

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Ensure downloads directory exists
const DOWNLOAD_DIR = path.join(__dirname, 'downloads');
if (!fs.existsSync(DOWNLOAD_DIR)) {
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
  console.log('📁 Created downloads directory');
}

// ============== DEBUG SCREENSHOTS DIRECTORY ==============
const DEBUG_DIR = path.join(__dirname, 'debug_screenshots');
if (!fs.existsSync(DEBUG_DIR)) {
  fs.mkdirSync(DEBUG_DIR, { recursive: true });
  console.log('📸 Created debug screenshots directory');
}

// ============== VIDEO URL GETTER SERVICE ==============
const VIDEO_SERVICE_URL = 'https://igvideourl.onrender.com/api/download';

// ============== CAPTURE SCREENSHOT FUNCTION ==============

async function captureScreenshot(page, step, description) {
  try {
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
    console.log(`⚠️ Could not take screenshot at step ${step}: ${e.message}`);
    return null;
  }
}

// ============== PRIMARY: DOWNLOAD VIA VIDEO URL SERVICE ==============

async function downloadViaVideoService(instagramUrl) {
  console.log('🔄 Using Instagram video URL getter service...');
  
  try {
    const response = await fetch(VIDEO_SERVICE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: instagramUrl }),
      signal: AbortSignal.timeout(30000)
    });
    
    if (!response.ok) {
      console.log(`⚠️ Service returned ${response.status}`);
      return null;
    }
    
    const data = await response.json();
    console.log('📊 Service response received');
    
    if (data.success && data.data) {
      const videoData = data.data;
      const downloadUrl = videoData.downloadUrl || videoData.directDownloadUrl;
      
      if (downloadUrl && (downloadUrl.includes('.mp4') || downloadUrl.includes('video'))) {
        console.log(`✅ Got video URL from service: ${downloadUrl.substring(0, 80)}...`);
        
        const filename = videoData.filename || `video_${Date.now()}.mp4`;
        
        console.log(`📥 Downloading video...`);
        const videoResponse = await fetch(downloadUrl);
        if (!videoResponse.ok) {
          throw new Error(`HTTP ${videoResponse.status}: ${videoResponse.statusText}`);
        }
        
        const buffer = Buffer.from(await videoResponse.arrayBuffer());
        const filepath = path.join(DOWNLOAD_DIR, filename);
        fs.writeFileSync(filepath, buffer);
        
        const stats = fs.statSync(filepath);
        const actualSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
        
        console.log(`✅ Video downloaded: ${filename} (${actualSizeMB} MB)`);
        
        return {
          success: true,
          filename: filename,
          downloadUrl: downloadUrl,
          directDownloadUrl: downloadUrl,
          fileSize: `${actualSizeMB} MB`,
          originalUrl: instagramUrl,
          isDirectUrl: true,
          source: 'igvideourl_service',
          localPath: filepath,
          screenshots: []
        };
      }
    }
    
    console.log('⚠️ Service did not return a valid video URL');
    return null;
  } catch (error) {
    console.log(`⚠️ Service error: ${error.message}`);
    return null;
  }
}

// ============== SECONDARY: DOWNLOAD VIA SNAPSAVE (FALLBACK) ==============

const { chromium } = require('playwright');

let browser = null;
let browserInitPromise = null;
let isBrowserReady = false;

async function initBrowser() {
  if (browser && isBrowserReady) {
    return browser;
  }
  
  if (browserInitPromise) {
    return browserInitPromise;
  }

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

async function handleAds(page) {
  try {
    console.log('🔍 Checking for ads...');
    
    try {
      await page.keyboard.press('Escape');
      console.log('✅ Pressed ESC to dismiss ad');
    } catch {}
    
    try {
      const closeBtn = page.getByRole('button', { name: 'Close' });
      if (await closeBtn.isVisible({ timeout: 2000 })) {
        await closeBtn.click();
        console.log('✅ Ad closed via role button');
      }
    } catch {}
    
    try {
      const closeBtn = page.locator('button:has-text("Close"), button:has-text("close")');
      if (await closeBtn.isVisible({ timeout: 2000 })) {
        await closeBtn.first().click();
        console.log('✅ Ad closed via text button');
      }
    } catch {}
    
    return true;
  } catch (error) {
    return false;
  }
}

async function downloadViaSnapsave(instagramUrl) {
  console.log('🔄 Trying snapsave.app as fallback...');
  
  let page = null;
  const startTime = Date.now();
  const screenshots = [];
  
  try {
    const browserInstance = await initBrowser();
    page = await browserInstance.newPage();
    await page.setViewportSize({ width: 1366, height: 768 });
    page.setDefaultTimeout(45000);

    // Step 1: Navigate to snapsave
    console.log('🌐 Navigating to snapsave.app...');
    await page.goto('https://snapsave.app/', { 
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    await page.waitForTimeout(2000);
    const ss1 = await captureScreenshot(page, '01_initial_page', 'Snapsave initial page');
    if (ss1) screenshots.push(ss1);

    // Step 2: Handle ads
    await handleAds(page);
    const ss2 = await captureScreenshot(page, '02_after_ads', 'After handling ads');
    if (ss2) screenshots.push(ss2);

    // Step 3: Enter URL
    console.log('✏️ Entering URL...');
    try {
      const urlInput = page.getByRole('textbox', { name: 'Url' });
      await urlInput.fill(instagramUrl);
      await page.waitForTimeout(500);
    } catch (error) {
      const urlInput = page.locator('input[type="text"], input[placeholder*="Url"]');
      await urlInput.first().fill(instagramUrl);
      await page.waitForTimeout(500);
    }
    const ss3 = await captureScreenshot(page, '03_url_filled', 'URL filled in input');
    if (ss3) screenshots.push(ss3);

    // Step 4: Click download
    console.log('🔄 Clicking download button...');
    try {
      const downloadBtn = page.getByRole('button', { name: 'Download' });
      await downloadBtn.click();
      await page.waitForTimeout(3000);
    } catch (error) {
      const downloadBtn = page.locator('button:has-text("Download"), input[value="Download"]');
      await downloadBtn.first().click();
      await page.waitForTimeout(3000);
    }
    const ss4 = await captureScreenshot(page, '04_after_click', 'After clicking download');
    if (ss4) screenshots.push(ss4);

    // Step 5: Handle ads after click
    await handleAds(page);
    const ss5 = await captureScreenshot(page, '05_after_ads_2', 'After second ads');
    if (ss5) screenshots.push(ss5);

    // Step 6: Wait and find download link
    console.log('⏳ Waiting for download link...');
    await page.waitForTimeout(2000);
    const ss6 = await captureScreenshot(page, '06_waiting_for_link', 'Waiting for download link');
    if (ss6) screenshots.push(ss6);
    
    let rapidCdnUrl = null;
    
    // Try to find Instagram download link
    try {
      const instagramLinks = await page.$$eval('a', (links) => 
        links
          .filter(link => {
            const text = link.textContent?.toLowerCase() || '';
            const href = link.href || '';
            return (text.includes('instagram') || href.includes('instagram')) && 
                   (text.includes('download') || href.includes('download'));
          })
          .map(link => link.href)
      );
      
      if (instagramLinks.length > 0) {
        rapidCdnUrl = instagramLinks[0];
        console.log(`✅ Found Instagram download link: ${rapidCdnUrl?.substring(0, 80)}...`);
        const ss7 = await captureScreenshot(page, '07_instagram_link_found', 'Instagram link found');
        if (ss7) screenshots.push(ss7);
      }
    } catch (error) {}

    // If no Instagram link, try rapidcdn
    if (!rapidCdnUrl) {
      try {
        const rapidLinks = await page.$$eval('a[href*="rapidcdn"]', (links) => 
          links.map(link => link.href)
        );
        if (rapidLinks.length > 0) {
          rapidCdnUrl = rapidLinks[0];
          console.log(`✅ Found rapidcdn link: ${rapidCdnUrl?.substring(0, 80)}...`);
          const ss8 = await captureScreenshot(page, '08_rapidcdn_found', 'RapidCDN link found');
          if (ss8) screenshots.push(ss8);
        }
      } catch (error) {}
    }

    // If no link found, capture the final state
    if (!rapidCdnUrl) {
      const ssError = await captureScreenshot(page, '99_no_link_found', 'No download link found');
      if (ssError) screenshots.push(ssError);
      throw new Error('Could not find Instagram download URL');
    }

    console.log('✅ Download URL found');
    const ssSuccess = await captureScreenshot(page, '10_success', 'Download URL found');
    if (ssSuccess) screenshots.push(ssSuccess);

    // Download the video
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
      screenshots: screenshots
    };

  } catch (error) {
    // Capture error screenshot
    if (page) {
      try {
        const ssError = await captureScreenshot(page, 'error_state', 'Error state');
        if (ssError) screenshots.push(ssError);
      } catch (e) {}
    }
    
    // Include screenshots in the error
    const err = new Error(error.message);
    err.screenshots = screenshots;
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
  
  // ✅ METHOD 1: Use your existing video service (PRIMARY)
  console.log('\n🔄 Method 1: Using video URL getter service...');
  try {
    const result = await downloadViaVideoService(instagramUrl);
    if (result && result.success) {
      console.log('✅ Successfully downloaded via video service!');
      return result;
    }
    console.log('⚠️ Video service failed, trying fallback...');
  } catch (error) {
    console.log(`⚠️ Video service error: ${error.message}`);
  }
  
  // ✅ METHOD 2: Fallback to snapsave (SECONDARY)
  console.log('\n🔄 Method 2: Trying snapsave fallback...');
  try {
    const result = await downloadViaSnapsave(instagramUrl);
    if (result && result.success) {
      console.log('✅ Successfully downloaded via snapsave!');
      return result;
    }
  } catch (error) {
    console.log(`⚠️ Snapsave error: ${error.message}`);
    // Return the error with screenshots
    if (error.screenshots && error.screenshots.length > 0) {
      throw error;
    }
  }
  
  // ❌ All methods failed
  console.log('\n❌ All download methods failed');
  throw new Error('Could not download video from any source');
}

// ============== SERVE DEBUG SCREENSHOTS ==============
app.use('/debug-screenshots', express.static(DEBUG_DIR));

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
    console.log(`🕐 Time: ${new Date().toISOString()}`);
    
    const result = await downloadVideo(url);
    
    console.log(`✅ Request completed successfully`);
    
    res.json({
      success: true,
      data: {
        ...result,
        screenshots: result.screenshots || []
      }
    });

  } catch (error) {
    console.error('❌ API Error:', error.message);
    
    // Include screenshots in error response
    const response = {
      success: false,
      error: error.message || 'Failed to download video. Please try again.'
    };
    
    if (error.screenshots && error.screenshots.length > 0) {
      response.screenshots = error.screenshots;
      response.message = `Failed: ${error.message}. See screenshots for debugging.`;
    }
    
    res.status(500).json(response);
  }
});

// Serve downloaded files
app.use('/downloads', express.static(DOWNLOAD_DIR));

// Serve frontend
app.get('/', (req, res) => {
  const indexPath = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.sendFile(path.join(__dirname, 'index.html'));
  }
});

// Health check endpoint
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
  console.log('🚀 Instagram Video Downloader Server');
  console.log('═'.repeat(60));
  console.log(`🌐 Server running on port ${PORT}`);
  console.log(`📍 Local: http://localhost:${PORT}`);
  console.log(`📤 Video Service: ${VIDEO_SERVICE_URL}`);
  console.log(`📸 Debug Screenshots: ${DEBUG_DIR}`);
  console.log(`🕐 Started: ${new Date().toISOString()}`);
  console.log('═'.repeat(60) + '\n');
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Received SIGINT. Shutting down gracefully...');
  if (browser) {
    try {
      await browser.close();
      console.log('🔒 Browser closed');
    } catch (e) {
      console.error('Error closing browser:', e.message);
    }
  }
  console.log('👋 Goodbye!');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Received SIGTERM. Shutting down gracefully...');
  if (browser) {
    try {
      await browser.close();
      console.log('🔒 Browser closed');
    } catch (e) {
      console.error('Error closing browser:', e.message);
    }
  }
  console.log('👋 Goodbye!');
  process.exit(0);
});

module.exports = app;