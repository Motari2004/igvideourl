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

// ============== CAPTURE SCREENSHOT ==============

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

// ============== SEND TO VERCEL WEBHOOK ==============

async function sendToVercel(instagramUrl, videoUrl, caption) {
    try {
        console.log(`📤 Sending to Vercel webhook...`);
        console.log(`   URL: ${instagramUrl}`);
        console.log(`   Video: ${videoUrl ? videoUrl.substring(0, 80) + '...' : 'None'}`);
        console.log(`   Caption: ${caption ? caption.substring(0, 50) + '...' : 'None'}`);
        
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
        
        let responseData = null;
        try {
            responseData = await response.json();
            console.log(`📊 Vercel response:`, responseData);
        } catch (e) {
            console.log(`📊 Vercel response status: ${response.status}`);
        }
        
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

// ============== DOWNLOAD VIA SNAPSAVE ==============

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
    page.setDefaultTimeout(60000);

    // Step 1: Navigate to snapsave
    console.log('🌐 Navigating to snapsave.app...');
    await page.goto('https://snapsave.app/', { 
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });
    await page.waitForTimeout(3000);
    const ss1 = await captureScreenshot(page, '01_initial_page', 'Snapsave initial page');
    if (ss1) screenshots.push(ss1);

    // Step 2: Handle ads
    await handleAds(page);
    await page.waitForTimeout(1000);
    const ss2 = await captureScreenshot(page, '02_after_ads', 'After handling ads');
    if (ss2) screenshots.push(ss2);

    // Step 3: Enter URL
    console.log('✏️ Entering URL...');
    try {
      const urlInput = page.getByRole('textbox', { name: 'Url' });
      await urlInput.fill(instagramUrl);
      await page.waitForTimeout(1000);
    } catch (error) {
      const urlInput = page.locator('input[type="text"], input[placeholder*="Url"]');
      await urlInput.first().fill(instagramUrl);
      await page.waitForTimeout(1000);
    }
    const ss3 = await captureScreenshot(page, '03_url_filled', 'URL filled in input');
    if (ss3) screenshots.push(ss3);

    // Step 4: Click download
    console.log('🔄 Clicking download button...');
    try {
      const downloadBtn = page.getByRole('button', { name: 'Download' });
      await downloadBtn.click();
      console.log('✅ Download button clicked');
    } catch (error) {
      const downloadBtn = page.locator('button:has-text("Download"), input[value="Download"]');
      await downloadBtn.first().click();
      console.log('✅ Download button clicked (fallback)');
    }
    
    // ⏳ Wait for thumbnail to load
    console.log('⏳ Waiting for thumbnail to load...');
    try {
      await page.waitForSelector('img[alt*="Download"], img[alt*="SnapX"], img[src*="rapidcdn"]', { 
        timeout: 30000 
      });
      console.log('✅ Thumbnail loaded!');
    } catch (error) {
      console.log('⚠️ Thumbnail not found, continuing...');
    }
    
    await page.waitForTimeout(3000);
    const ss4 = await captureScreenshot(page, '04_after_click_wait', 'After clicking download and waiting');
    if (ss4) screenshots.push(ss4);

    // Step 5: Handle ads after click
    await handleAds(page);
    await page.waitForTimeout(1000);
    const ss5 = await captureScreenshot(page, '05_after_ads_2', 'After second ads');
    if (ss5) screenshots.push(ss5);

    // Step 6: Find the download link - INSTAGRAM ONLY
    console.log('🔍 Looking for Instagram video download link...');
    await page.waitForTimeout(2000);
    const ss6 = await captureScreenshot(page, '06_looking_for_link', 'Looking for download link');
    if (ss6) screenshots.push(ss6);
    
    let rapidCdnUrl = null;

    // ✅ METHOD 1: Instagram-specific links (exclude Facebook)
    try {
      console.log('🔍 Method 1: Looking for Instagram-specific download link...');
      const instagramSelectors = [
        'a[href*="download-video-instagram"]',
        'a[href*="instagram-reels-download"]',
        'a:has-text("Download Video Instagram")',
        'a:has-text("Instagram reels download")',
        'a[href*="rapidcdn"][onclick*="instagram"]'
      ];
      
      for (const selector of instagramSelectors) {
        try {
          const link = await page.locator(selector).first();
          if (await link.isVisible({ timeout: 3000 })) {
            const href = await link.getAttribute('href');
            if (href) {
              rapidCdnUrl = href.startsWith('http') ? href : `https://snapsave.app${href}`;
              // Make sure it's not a Facebook link
              if (rapidCdnUrl && !rapidCdnUrl.includes('facebook')) {
                console.log(`✅ Found Instagram link: ${rapidCdnUrl.substring(0, 80)}...`);
                break;
              }
            }
          }
        } catch (e) {}
      }
    } catch (error) {
      console.log('⚠️ Instagram link search failed');
    }

    // ✅ METHOD 2: Click the Instagram button
    if (!rapidCdnUrl) {
      try {
        console.log('🔍 Method 2: Clicking Instagram download button...');
        const instagramBtn = page.locator('a:has-text("Download Video Instagram")');
        if (await instagramBtn.isVisible({ timeout: 3000 })) {
          await instagramBtn.first().click();
          console.log('🔄 Clicked Instagram button...');
          await page.waitForTimeout(3000);
          
          const links = await page.$$eval('a[href*="rapidcdn"]', (elements) => 
            elements.map(el => el.href)
          );
          // Find one that's NOT Facebook
          const instagramLink = links.find(l => l && !l.includes('facebook'));
          if (instagramLink) {
            rapidCdnUrl = instagramLink;
            console.log(`✅ Found rapidcdn after Instagram click`);
          }
        }
      } catch (error) {
        console.log('⚠️ Instagram button click failed');
      }
    }

    // ✅ METHOD 3: RapidCDN links (exclude Facebook)
    if (!rapidCdnUrl) {
      try {
        console.log('🔍 Method 3: Looking for rapidcdn links (excluding Facebook)...');
        const rapidLinks = await page.$$eval('a[href*="rapidcdn"]', (links) => 
          links
            .filter(link => {
              const text = link.textContent?.toLowerCase() || '';
              const href = link.href || '';
              return !href.includes('facebook') && 
                     (text.includes('instagram') || text.includes('video') || text.includes('mp4'));
            })
            .map(link => link.href)
        );
        if (rapidLinks.length > 0) {
          rapidCdnUrl = rapidLinks[0];
          console.log(`✅ Found valid rapidcdn link: ${rapidCdnUrl.substring(0, 80)}...`);
        }
      } catch (error) {}
    }

    // ✅ METHOD 4: .mp4 links (exclude Facebook)
    if (!rapidCdnUrl) {
      try {
        console.log('🔍 Method 4: Looking for .mp4 links...');
        const videoLinks = await page.$$eval('a[href*=".mp4"]', (links) => 
          links
            .filter(link => {
              const href = link.href || '';
              return !href.includes('facebook');
            })
            .map(link => link.href)
        );
        if (videoLinks.length > 0) {
          rapidCdnUrl = videoLinks[0];
          console.log(`✅ Found .mp4 link: ${rapidCdnUrl.substring(0, 80)}...`);
        }
      } catch (error) {}
    }

    // ✅ METHOD 5: Check all links (exclude Facebook)
    if (!rapidCdnUrl) {
      try {
        console.log('🔍 Method 5: Checking all links (excluding Facebook)...');
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
        if (allLinks.length > 0) {
          rapidCdnUrl = allLinks[0];
          console.log(`✅ Found valid link from all links: ${rapidCdnUrl.substring(0, 80)}...`);
        }
      } catch (error) {}
    }

    if (!rapidCdnUrl) {
      const ssError = await captureScreenshot(page, '99_no_link_found', 'No download link found');
      if (ssError) screenshots.push(ssError);
      throw new Error('Could not find Instagram video download URL');
    }

    console.log(`✅ Instagram video URL found`);
    const ssSuccess = await captureScreenshot(page, '10_success', 'Download URL found');
    if (ssSuccess) screenshots.push(ssSuccess);

    // ========== CAPTURE CAPTION ==========
    try {
      console.log('📝 Looking for caption...');
      
      const captionSelectors = [
        '.caption',
        '.description',
        '[class*="caption"]',
        '.text-content',
        '.post-caption',
        'div[class*="caption"]',
        'p[class*="desc"]'
      ];
      
      for (const selector of captionSelectors) {
        try {
          const captionEl = await page.locator(selector).first();
          if (await captionEl.isVisible({ timeout: 2000 })) {
            const text = await captionEl.textContent();
            if (text && text.trim().length > 10 && 
                !text.includes('Error') && 
                !text.includes('facebook') &&
                !text.includes('Download') &&
                !text.includes('SnapSave')) {
              caption = text.trim();
              console.log(`✅ Caption found: ${caption.substring(0, 50)}...`);
              break;
            }
          }
        } catch (e) {}
      }
      
      // If no caption, skip
      if (!caption || caption.includes('Error')) {
        console.log('⚠️ No valid caption found, skipping');
        caption = '';
      }
    } catch (error) {
      console.log(`⚠️ Could not capture caption: ${error.message}`);
      caption = '';
    }

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
      screenshots: screenshots,
      caption: caption || ''
    };

  } catch (error) {
    if (page) {
      try {
        const ssError = await captureScreenshot(page, 'error_state', 'Error state');
        if (ssError) screenshots.push(ssError);
      } catch (e) {}
    }
    
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
  
  try {
    const result = await downloadViaSnapsave(instagramUrl);
    
    if (result && result.success) {
      console.log(`✅ Video downloaded successfully!`);
      
      // ✅ Send to Vercel webhook
      await sendToVercel(instagramUrl, result.downloadUrl, result.caption || '');
      
      return result;
    }
    
    throw new Error('Download failed');
    
  } catch (error) {
    console.error(`❌ Download error: ${error.message}`);
    throw error;
  }
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
        webhook_sent: true
      }
    });

  } catch (error) {
    console.error('❌ API Error:', error.message);
    
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
  console.log(`📍 Local: http://localhost:${PORT}`);
  console.log(`📸 Debug Screenshots: ${DEBUG_DIR}`);
  console.log(`📤 Vercel Webhook: ${VERCEL_WEBHOOK_URL}`);
  console.log(`🕐 Started: ${new Date().toISOString()}`);
  console.log('═'.repeat(60) + '\n');
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down...');
  if (browser) {
    try {
      await browser.close();
      console.log('🔒 Browser closed');
    } catch (e) {}
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Shutting down...');
  if (browser) {
    try {
      await browser.close();
      console.log('🔒 Browser closed');
    } catch (e) {}
  }
  process.exit(0);
});

module.exports = app;