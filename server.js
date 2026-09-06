const express = require('express');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const { chromium } = require('playwright');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Ensure downloads directory exists
const DOWNLOAD_DIR = path.join(__dirname, 'downloads');
if (!fs.existsSync(DOWNLOAD_DIR)) {
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}

// Store active browser instance
let browser = null;
let browserInitPromise = null;

// Initialize browser
async function initBrowser() {
  if (browser) return browser;
  
  if (browserInitPromise) {
    return browserInitPromise;
  }

  browserInitPromise = (async () => {
    try {
      console.log('🚀 Launching browser...');
      
      // Try to find Chromium path
      const basePath = path.join(process.env.USERPROFILE || process.env.HOME, 'AppData', 'Local', 'ms-playwright');
      let executablePath = null;
      
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

      browser = await chromium.launch({
        headless: true,
        executablePath: executablePath || undefined,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu',
          '--disable-web-security'
        ]
      });

      console.log('✅ Browser launched successfully');
      return browser;
    } catch (error) {
      console.error('❌ Failed to launch browser:', error.message);
      browserInitPromise = null;
      throw error;
    }
  })();

  return browserInitPromise;
}

// Download video function
async function downloadVideo(instagramUrl) {
  let page = null;
  
  try {
    const browserInstance = await initBrowser();
    page = await browserInstance.newPage();
    await page.setViewportSize({ width: 1366, height: 768 });
    page.setDefaultTimeout(30000);

    console.log(`📥 Processing: ${instagramUrl}`);

    // Navigate to snapsave.app
    await page.goto('https://snapsave.app/', { 
      waitUntil: 'domcontentloaded',
      timeout: 15000 
    });
    await page.waitForTimeout(2000);

    // Handle ads
    await handleAds(page);

    // Enter URL
    const urlInput = page.getByRole('textbox', { name: 'Url' });
    await urlInput.fill(instagramUrl);
    await page.waitForTimeout(500);

    // Click download button
    const downloadBtn = page.getByRole('button', { name: 'Download' });
    await downloadBtn.click();
    await page.waitForTimeout(3000);

    // Handle ads after click
    await handleAds(page);

    // Wait for download link
    console.log('⏳ Waiting for download link...');
    
    const downloadLinkSelector = 'a[onclick*="showAd"][href*="rapidcdn"]';
    const downloadVideoSelector = 'a:has-text("Download video")';
    
    let downloadLink = null;
    
    try {
      const linkWithOnclick = page.locator(downloadLinkSelector).first();
      if (await linkWithOnclick.isVisible({ timeout: 5000 })) {
        downloadLink = linkWithOnclick;
        console.log('✅ Found download link with onclick handler');
      }
    } catch {}

    if (!downloadLink) {
      try {
        const linkWithText = page.locator(downloadVideoSelector).first();
        if (await linkWithText.isVisible({ timeout: 3000 })) {
          downloadLink = linkWithText;
          console.log('✅ Found download link with text "Download video"');
        }
      } catch {}
    }

    if (!downloadLink) {
      throw new Error('Download link not found');
    }

    // Get the download URL
    let downloadUrl = await downloadLink.getAttribute('href');
    if (!downloadUrl) {
      throw new Error('Download URL not found');
    }

    console.log('✅ Download URL found');

    // Get suggested filename
    let filename = 'video.mp4';
    try {
      const filenameMatch = downloadUrl.match(/filename=([^&]+)/);
      if (filenameMatch) {
        filename = decodeURIComponent(filenameMatch[1]);
      }
    } catch {}

    // Clean filename
    filename = filename.replace(/[^a-zA-Z0-9.-]/g, '_');
    if (!filename.endsWith('.mp4')) {
      filename = `video_${Date.now()}.mp4`;
    }

    const filepath = path.join(DOWNLOAD_DIR, filename);

    // Download the video
    console.log('📥 Downloading video...');
    
    // Set up download listener
    const downloadPromise = page.waitForEvent('download', { timeout: 30000 });

    // Click the download link
    await downloadLink.click();

    // Wait for download
    const download = await downloadPromise;
    await download.saveAs(filepath);

    const stats = fs.statSync(filepath);
    const fileSizeMB = stats.size / (1024 * 1024);

    console.log(`✅ Video downloaded: ${filename} (${fileSizeMB.toFixed(2)} MB)`);

    // Return the download URL (for direct access)
    const fileUrl = `/downloads/${filename}`;

    return {
      success: true,
      filename: filename,
      downloadUrl: fileUrl,
      fileSize: `${fileSizeMB.toFixed(2)} MB`,
      originalUrl: instagramUrl
    };

  } catch (error) {
    console.error('❌ Download error:', error.message);
    throw error;
  } finally {
    if (page) {
      await page.close();
    }
  }
}

// Handle ads function
async function handleAds(page) {
  try {
    const adCloseMethods = [
      async () => {
        try {
          const closeBtn = page.getByRole('button', { name: 'Close' });
          if (await closeBtn.isVisible({ timeout: 2000 })) {
            await closeBtn.click();
            return true;
          }
        } catch {}
        return false;
      },
      async () => {
        try {
          const closeBtn = page.locator('button:has-text("Close"), button:has-text("close"), button:has-text("×"), button:has-text("X")');
          if (await closeBtn.isVisible({ timeout: 2000 })) {
            await closeBtn.first().click();
            return true;
          }
        } catch {}
        return false;
      },
      async () => {
        try {
          await page.keyboard.press('Escape');
          return true;
        } catch {}
        return false;
      }
    ];

    for (const method of adCloseMethods) {
      try {
        if (await method()) {
          await page.waitForTimeout(1000);
          return true;
        }
      } catch {}
    }
  } catch (error) {
    console.log('Ad handling completed');
  }
}

// API Routes
app.post('/api/download', async (req, res) => {
  try {
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({ error: 'URL is required' });
    }

    // Validate Instagram URL
    if (!url.includes('instagram.com')) {
      return res.status(400).json({ error: 'Please provide a valid Instagram URL' });
    }

    console.log(`📥 Download request for: ${url}`);
    
    const result = await downloadVideo(url);
    
    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to download video'
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
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 Visit http://localhost:${PORT}`);
});

// Cleanup on exit
process.on('SIGINT', async () => {
  if (browser) {
    await browser.close();
    console.log('Browser closed');
  }
  process.exit();
});