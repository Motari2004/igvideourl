const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { chromium } = require('playwright');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy - Required for rate limiting behind proxies (like Render)
app.set('trust proxy', 1);

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 requests per windowMs
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

// Clean up old downloads (files older than 1 hour)
setInterval(() => {
  try {
    const files = fs.readdirSync(DOWNLOAD_DIR);
    const now = Date.now();
    let deletedCount = 0;
    files.forEach(file => {
      const filepath = path.join(DOWNLOAD_DIR, file);
      try {
        const stats = fs.statSync(filepath);
        if (now - stats.mtimeMs > 3600000) { // 1 hour
          fs.unlinkSync(filepath);
          deletedCount++;
          console.log(`🗑️ Deleted old file: ${file}`);
        }
      } catch (err) {
        // File might have been deleted already
      }
    });
    if (deletedCount > 0) {
      console.log(`🧹 Cleaned up ${deletedCount} old files`);
    }
  } catch (error) {
    console.error('Cleanup error:', error.message);
  }
}, 3600000); // Run every hour

// Store active browser instance
let browser = null;
let browserInitPromise = null;
let isBrowserReady = false;

// Initialize browser
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
      
      // Check if we're on Render
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
      } else {
        // Local development - try to find Chromium
        const basePath = path.join(process.env.USERPROFILE || process.env.HOME, 'AppData', 'Local', 'ms-playwright');
        if (fs.existsSync(basePath)) {
          const dirs = fs.readdirSync(basePath)
            .filter(dir => dir.startsWith('chromium-'))
            .sort((a, b) => {
              const numA = parseInt(a.split('-')[1]);
              const numB = parseInt(b.split('-')[1]);
              return numB - numA;
            });

          for (const dir of dirs) {
            const chromePath = path.join(basePath, dir, 'chrome-win64', 'chrome.exe');
            if (fs.existsSync(chromePath)) {
              executablePath = chromePath;
              console.log(`✅ Found Chromium: ${dir}`);
              break;
            }
          }
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

// Handle ads function
async function handleAds(page) {
  try {
    console.log('🔍 Checking for ads...');
    let adClosed = false;
    
    const adCloseMethods = [
      // Method 1: Role-based close button
      async () => {
        try {
          const closeBtn = page.getByRole('button', { name: 'Close' });
          if (await closeBtn.isVisible({ timeout: 2000 })) {
            await closeBtn.click();
            console.log('✅ Ad closed via role button');
            return true;
          }
        } catch {}
        return false;
      },
      // Method 2: Text-based close button
      async () => {
        try {
          const closeBtn = page.locator('button:has-text("Close"), button:has-text("close"), button:has-text("×"), button:has-text("X")');
          if (await closeBtn.isVisible({ timeout: 2000 })) {
            await closeBtn.first().click();
            console.log('✅ Ad closed via text button');
            return true;
          }
        } catch {}
        return false;
      },
      // Method 3: Click outside ad
      async () => {
        try {
          const adContent = page.locator('#ad-content, .ad-container, [class*="ad-"], [id*="ad-"]');
          if (await adContent.isVisible({ timeout: 2000 })) {
            await page.click('body', { position: { x: 10, y: 10 } });
            console.log('✅ Ad dismissed by clicking outside');
            return true;
          }
        } catch {}
        return false;
      },
      // Method 4: ESC key
      async () => {
        try {
          await page.keyboard.press('Escape');
          console.log('✅ Pressed ESC to dismiss ad');
          return true;
        } catch {}
        return false;
      }
    ];

    for (const method of adCloseMethods) {
      try {
        if (await method()) {
          adClosed = true;
          await page.waitForTimeout(1000);
          break;
        }
      } catch (error) {
        // Continue to next method
      }
    }

    if (!adClosed) {
      console.log('ℹ️ No ads detected or ads already closed');
    }
    
    return adClosed;
  } catch (error) {
    console.log('ℹ️ Ad handling completed');
    return false;
  }
}

// Download video function
// Download video function with screenshot debugging
async function downloadVideo(instagramUrl) {
  let page = null;
  const startTime = Date.now();
  const debugDir = path.join(__dirname, 'debug_screenshots');
  
  // Ensure debug directory exists
  if (!fs.existsSync(debugDir)) {
    fs.mkdirSync(debugDir, { recursive: true });
    console.log('📁 Created debug screenshots directory');
  }
  
  try {
    console.log(`📥 Processing: ${instagramUrl}`);
    
    const browserInstance = await initBrowser();
    page = await browserInstance.newPage();
    await page.setViewportSize({ width: 1366, height: 768 });
    page.setDefaultTimeout(30000);

    // Generate unique filename for this request
    const timestamp = Date.now();
    const urlHash = Buffer.from(instagramUrl).toString('base64').substring(0, 16);
    const screenshotBase = `${timestamp}_${urlHash}`;
    
    // Take screenshot after each step
    async function takeScreenshot(step, description) {
      try {
        const filename = `${screenshotBase}_${step}.png`;
        const filepath = path.join(debugDir, filename);
        await page.screenshot({ 
          path: filepath,
          fullPage: true,
          type: 'png'
        });
        console.log(`📸 Screenshot saved: ${filename} (${description})`);
        return filepath;
      } catch (e) {
        console.log(`⚠️ Could not take screenshot at step ${step}: ${e.message}`);
        return null;
      }
    }

    // Navigate to snapsave.app
    console.log('🌐 Navigating to snapsave.app...');
    await page.goto('https://snapsave.app/', { 
      waitUntil: 'domcontentloaded',
      timeout: 30000 
    });
    await page.waitForTimeout(2000);
    await takeScreenshot('01_initial_page', 'Initial snapsave.app page');

    // Handle initial ads
    await handleAds(page);
    await takeScreenshot('02_after_ads', 'After handling ads');

    // Enter URL
    console.log('✏️ Entering URL...');
    const urlInput = page.getByRole('textbox', { name: 'Url' });
    await urlInput.fill(instagramUrl);
    await page.waitForTimeout(500);
    await takeScreenshot('03_url_filled', 'URL filled in input');

    // Click download button
    console.log('🔄 Clicking download button...');
    const downloadBtn = page.getByRole('button', { name: 'Download' });
    await downloadBtn.click();
    await page.waitForTimeout(3000);
    await takeScreenshot('04_after_click', 'After clicking download button');

    // Handle ads after click
    await handleAds(page);
    await takeScreenshot('05_after_ads_2', 'After handling second set of ads');

    // Wait for download link
    console.log('⏳ Waiting for download link...');
    
    // Take a screenshot to see the current state
    await takeScreenshot('06_waiting_for_link', 'Waiting for download link');

    // Log all links on the page for debugging
    try {
      const allLinks = await page.$$eval('a', (links) => 
        links.map(link => ({
          text: link.textContent?.trim() || '',
          href: link.href,
          onclick: link.onclick?.toString() || '',
          className: link.className || '',
          id: link.id || ''
        }))
      );
      console.log(`🔗 Found ${allLinks.length} links on page`);
      
      // Log links that might be relevant
      const downloadLinks = allLinks.filter(l => 
        l.text?.toLowerCase().includes('download') ||
        l.href?.includes('rapidcdn') ||
        l.onclick?.includes('rapidcdn')
      );
      
      if (downloadLinks.length > 0) {
        console.log(`📌 Found ${downloadLinks.length} potential download links:`);
        downloadLinks.forEach((link, i) => {
          console.log(`  ${i+1}. Text: "${link.text}", Href: ${link.href?.substring(0, 80)}...`);
        });
      } else {
        console.log('⚠️ No download links found in page');
        // Save full page HTML for debugging
        try {
          const html = await page.content();
          const htmlPath = path.join(debugDir, `${screenshotBase}_page.html`);
          fs.writeFileSync(htmlPath, html);
          console.log(`📄 HTML saved: ${htmlPath}`);
        } catch (e) {}
      }
    } catch (e) {
      console.log(`⚠️ Could not analyze links: ${e.message}`);
    }
    
    const downloadLinkSelectors = [
      'a[onclick*="showAd"][href*="rapidcdn"]',
      'a:has-text("Download video")',
      'a:has-text("Download")',
      'a[download]',
      '.download-link',
      '[class*="download"] a'
    ];
    
    let downloadLink = null;
    let usedSelector = null;
    let rapidCdnUrl = null;
    
    // First try to find the link with rapidcdn in href
    for (const selector of downloadLinkSelectors) {
      try {
        const element = page.locator(selector).first();
        if (await element.isVisible({ timeout: 3000 })) {
          downloadLink = element;
          usedSelector = selector;
          console.log(`✅ Found download link using selector: ${selector}`);
          
          // Take screenshot when link is found
          await takeScreenshot('07_link_found', `Found link with selector: ${selector}`);
          
          // Get the href which contains the rapidcdn URL
          const href = await downloadLink.getAttribute('href');
          console.log(`📎 Href: ${href?.substring(0, 100)}...`);
          if (href && href.includes('rapidcdn')) {
            rapidCdnUrl = href;
            console.log('✅ Found rapidcdn URL in href');
            await takeScreenshot('08_rapidcdn_found', 'RapidCDN URL found');
            break;
          }
        }
      } catch (e) {}
    }

    // If we didn't find it with the selectors, try a more generic approach
    if (!downloadLink) {
      console.log('🔍 Trying generic link search...');
      try {
        const allLinks = await page.$$eval('a', (links) => 
          links.map(link => ({
            element: link,
            href: link.href,
            text: link.textContent?.trim() || '',
            onclick: link.getAttribute('onclick') || ''
          }))
        );
        
        for (const linkData of allLinks) {
          if (linkData.href && linkData.href.includes('rapidcdn')) {
            rapidCdnUrl = linkData.href;
            usedSelector = 'generic link search';
            console.log('✅ Found rapidcdn URL via generic search');
            await takeScreenshot('09_generic_found', 'Found via generic search');
            break;
          }
          if (linkData.onclick && linkData.onclick.includes('rapidcdn')) {
            const match = linkData.onclick.match(/https?:\/\/[^"']+/);
            if (match) {
              rapidCdnUrl = match[0];
              usedSelector = 'onclick attribute';
              console.log('✅ Found rapidcdn URL in onclick attribute');
              await takeScreenshot('10_onclick_found', 'Found via onclick');
              break;
            }
          }
        }
      } catch (e) {}
    }

    // If still no link, try to get URL from onclick attribute
    if (!rapidCdnUrl && downloadLink) {
      try {
        const onclickAttr = await downloadLink.getAttribute('onclick');
        console.log(`📎 Onclick: ${onclickAttr?.substring(0, 100)}...`);
        if (onclickAttr) {
          const urlMatch = onclickAttr.match(/https?:\/\/[^"']+/);
          if (urlMatch) {
            rapidCdnUrl = urlMatch[0];
            console.log('✅ Found rapidcdn URL in onclick attribute');
            await takeScreenshot('11_onclick_match', 'Found via onclick match');
          }
        }
      } catch (e) {}
    }

    // If still no URL, try to find any link with rapidcdn in the page
    if (!rapidCdnUrl) {
      console.log('🔍 Searching for rapidcdn in page content...');
      try {
        const rapidLinks = await page.$$eval('a[href*="rapidcdn"]', (links) => 
          links.map(link => link.href)
        );
        if (rapidLinks.length > 0) {
          rapidCdnUrl = rapidLinks[0];
          console.log('✅ Found rapidcdn URL via direct link search');
          await takeScreenshot('12_direct_rapidcdn', 'Found via direct rapidcdn search');
        }
      } catch (e) {}
    }

    // If still no URL, check if the page has any download link
    if (!rapidCdnUrl) {
      console.log('🔍 Checking for any download link...');
      try {
        const downloadLinks = await page.$$eval('a', (links) => 
          links
            .filter(link => {
              const text = link.textContent?.toLowerCase() || '';
              return text.includes('download') || text.includes('mp4') || text.includes('video');
            })
            .map(link => ({
              href: link.href,
              text: link.textContent?.trim() || ''
            }))
        );
        
        if (downloadLinks.length > 0) {
          console.log(`📌 Found ${downloadLinks.length} download-related links:`);
          downloadLinks.forEach((link, i) => {
            console.log(`  ${i+1}. "${link.text}" -> ${link.href?.substring(0, 60)}...`);
          });
          // Use the first one
          if (downloadLinks[0].href) {
            rapidCdnUrl = downloadLinks[0].href;
            console.log('✅ Using first download link');
            await takeScreenshot('13_download_link_used', 'Using first download link');
          }
        }
      } catch (e) {}
    }

    if (!rapidCdnUrl) {
      // Take final screenshot before error
      await takeScreenshot('99_failure', 'FAILED - No rapidcdn URL found');
      throw new Error('Could not find rapidcdn download URL');
    }

    console.log('✅ RapidCDN URL found');
    console.log(`📎 URL: ${rapidCdnUrl.substring(0, 100)}...`);
    
    await takeScreenshot('14_success', 'SUCCESS - RapidCDN URL found');

    // Get suggested filename from the URL
    let filename = 'video.mp4';
    try {
      const filenameMatch = rapidCdnUrl.match(/filename=([^&]+)/);
      if (filenameMatch) {
        filename = decodeURIComponent(filenameMatch[1]);
      }
    } catch (e) {}

    // Clean filename
    filename = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
    if (!filename.endsWith('.mp4')) {
      filename = `video_${Date.now()}.mp4`;
    }

    const filepath = path.join(DOWNLOAD_DIR, filename);

    // Download the video using the rapidcdn URL
    console.log(`📥 Downloading video from rapidcdn...`);
    
    // Use fetch to download the video
    const response = await fetch(rapidCdnUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const buffer = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(filepath, buffer);

    const stats = fs.statSync(filepath);
    const fileSizeMB = stats.size / (1024 * 1024);
    const downloadTime = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log(`✅ Video downloaded: ${filename} (${fileSizeMB.toFixed(2)} MB) in ${downloadTime}s`);

    return {
      success: true,
      filename: filename,
      downloadUrl: rapidCdnUrl,
      directDownloadUrl: rapidCdnUrl,
      fileSize: `${fileSizeMB.toFixed(2)} MB`,
      downloadTime: `${downloadTime}s`,
      originalUrl: instagramUrl,
      isDirectUrl: true,
      localPath: filepath,
      screenshot: `${screenshotBase}_14_success.png`
    };

  } catch (error) {
    console.error('❌ Download error:', error.message);
    // Take error screenshot
    if (page) {
      try {
        const timestamp = Date.now();
        const errorPath = path.join(__dirname, 'debug_screenshots', `ERROR_${timestamp}.png`);
        await page.screenshot({ path: errorPath, fullPage: true });
        console.log(`📸 Error screenshot saved: ${errorPath}`);
      } catch (e) {}
    }
    throw error;
  } finally {
    if (page) {
      await page.close();
      console.log('🔒 Page closed');
    }
  }
}

// API Routes
app.post('/api/download', async (req, res) => {
  try {
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({ 
        success: false,
        error: 'URL is required' 
      });
    }

    // Validate Instagram URL
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
      data: result
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
  const indexPath = path.join(__dirname, 'public', 'index.html');
  if (fs.existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Instagram Video Downloader</title>
          <style>
            body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
            .container { background: #f5f5f5; padding: 30px; border-radius: 10px; }
            input, button { padding: 10px; margin: 10px 0; width: 100%; }
            button { background: #4CAF50; color: white; border: none; cursor: pointer; }
            button:hover { background: #45a049; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>📱 Instagram Video Downloader</h1>
            <p>Enter an Instagram video URL to download</p>
            <input type="text" id="urlInput" placeholder="https://www.instagram.com/p/...">
            <button onclick="downloadVideo()">Download</button>
            <div id="result"></div>
          </div>
          <script>
            async function downloadVideo() {
              const url = document.getElementById('urlInput').value;
              const resultDiv = document.getElementById('result');
              if (!url) { resultDiv.innerHTML = 'Please enter a URL'; return; }
              resultDiv.innerHTML = '⏳ Downloading...';
              try {
                const response = await fetch('/api/download', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ url })
                });
                const data = await response.json();
                if (data.success) {
                  resultDiv.innerHTML = \`
                    ✅ Download ready!<br>
                    <a href="\${data.data.downloadUrl}" target="_blank">Download Video</a><br>
                    Size: \${data.data.fileSize}<br>
                    Filename: \${data.data.filename}<br>
                    <button onclick="navigator.clipboard.writeText('\${data.data.downloadUrl}')">Copy URL</button>
                  \`;
                } else {
                  resultDiv.innerHTML = '❌ Error: ' + data.error;
                }
              } catch (error) {
                resultDiv.innerHTML = '❌ Error: ' + error.message;
              }
            }
          </script>
        </body>
      </html>
    `);
  }
});

// Health check endpoint
app.get('/health', async (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    browserReady: isBrowserReady,
    downloadDir: DOWNLOAD_DIR,
    downloadCount: fs.existsSync(DOWNLOAD_DIR) ? fs.readdirSync(DOWNLOAD_DIR).length : 0
  };
  
  try {
    if (browser) {
      const version = await browser.version();
      health.browserVersion = version;
    }
  } catch (e) {
    health.browserVersion = 'unavailable';
  }
  
  res.json(health);
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

// Unhandled rejection handler
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
});

module.exports = app;