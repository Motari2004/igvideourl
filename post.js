// ============================================
// POST TO WILDLIFE EXPLORERS
// ============================================

const WILDLIFE_ACCOUNT_ID = '6a8c73ab77555aae01fabf32';
const KEY_ID = '80458f40-cc13-49db-8a5f-9d2904cda99b';

// ✅ FULL URL - replace with your actual domain
const API_URL = 'https://fetchgram-one.vercel.app/api/zernio/publish';

const videoUrl = 'https://fitydown.onrender.com/download_file/890ab831b6bd450b822d355b70254b9d';

const caption = '🦁 Wildlife Explorers - Check out this amazing video! 🌍';

// ============================================
// POST IT
// ============================================

async function postToWildlife() {
  console.log('📤 Posting to Wildlife Explorers...');
  console.log(`📎 Video URL: ${videoUrl.substring(0, 60)}...`);
  console.log(`📝 Caption: ${caption}`);
  
  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'User-Agent': 'IG-Reels-Scraper/1.0'
      },
      body: JSON.stringify({
        video_url: videoUrl,
        text: caption,
        account_id: WILDLIFE_ACCOUNT_ID,
        publish_now: true,
        key_id: KEY_ID
      })
    });
    
    const data = await response.json();
    
    if (response.ok) {
      console.log('✅ Posted to Wildlife Explorers!');
      console.log('📊 Response:', JSON.stringify(data, null, 2));
    } else {
      console.log('❌ Failed to post:', data);
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

// Run it
postToWildlife();