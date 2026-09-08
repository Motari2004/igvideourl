// ============================================
// POST TO WILDLIFE EXPLORERS
// ============================================

const WILDLIFE_ACCOUNT_ID = '6a8c73ab77555aae01fabf32';
const KEY_ID = '80458f40-cc13-49db-8a5f-9d2904cda99b';

// ✅ FULL URL - replace with your actual domain
const API_URL = 'https://fetchgram-one.vercel.app/api/zernio/publish';

const videoUrl = 'https://media.snapinst.to/fetch?token=eyJ1cmwiOiJodHRwczovL3Njb250ZW50LWhhbTMtMS5jZG5pbnN0YWdyYW0uY29tL28xL3YvdDIvZjIvbTg2L0FRT2V4NlZrNi1GMl9ua2t0ZWtKYmtJVmNvcWNoR3BvOXl2cHBINUM5YTBSTi10ZVg5NG8yaDk1MUpUQ1d5RVRwNkpJel9jc2VTTFFQc2NhdTJ6LXdLNlhVNXhpT2FaY1NYZGtjWG8ubXA0P19uY19jYXQ9MTA1Jl9uY19zaWQ9NWU5ODUxJl9uY19odD1zY29udGVudC1oYW0zLTEuY2RuaW5zdGFncmFtLmNvbSZfbmNfb2hjPXF1Z1lHWGNscDRVUTdrTnZ3RkllcWRYJmVmZz1leUoyWlc1amIyUmxYM1JoWnlJNkluaHdkbDl3Y205bmNtVnpjMmwyWlM1SlRsTlVRVWRTUVUwdVEweEpVRk11UXpNdU56SXdMbVJoYzJoZlltRnpaV3hwYm1WZk1WOTJNU0lzSW5od2RsOWhjM05sZEY5cFpDSTZNVGd6TXprek1qWXpNakF5TlRrek1qQXNJbUZ6YzJWMFgyRm5aVjlrWVhseklqb3dMQ0oyYVY5MWMyVmpZWE5sWDJsa0lqb3hNREE1T1N3aVpIVnlZWFJwYjI1ZmN5STZOak1zSW5WeWJHZGxibDl6YjNWeVkyVWlPaUozZDNjaWZRJTNEJTNEJmNjYj0xNy0xJnZzPTNmMmQ3ZGVmZTE4YTBmMTAmX25jX3ZzPUhCa3NGUUlZVW1sblgzaHdkbDl5WldWc2MxOXdaWEp0WVc1bGJuUmZjM0pmY0hKdlpDODNOVFJETVRsR1JqZ3pRa05HTVRkRE5URTNNVEk1TlRoR05USTRNVGRCUTE5MmFXUmxiMTlrWVhOb2FXNXBkQzV0Y0RRVkFBTElBUklBRlFJWVVXbG5YM2h3ZGw5d2JHRmpaVzFsYm5SZmNHVnliV0Z1Wlc1MFgzWXlMelU1TkRSRU5UVTFRek13TWprNE0wWTRNek5HUkVOR09VTkJSa1UyTXpnM1gyRjFaR2x2WDJSaGMyaHBibWwwTG0xd05CVUNBc2dCRWdBb0FCZ0FHd0tJQjNWelpWOXZhV3dCTVJKd2NtOW5jbVZ6YzJsMlpWOXlaV05wY0dVQk1SVUFBQ2J3dy1ucnBPR1RRUlVDS0FKRE15d1hRRV9SQmlUZEx4c1lFbVJoYzJoZlltRnpaV3hwYm1WZk1WOTJNUkVBZGY0SFplYWRBUUEmX25jX2dpZD1KTWdFcVl6Qmtnb3JVX2Q2d3JETFlBJl9uY19zcz03YTIyZSZfbmNfenQ9Mjgmb2g9MDBfQVFJWDktSlBIWW9ONFFRUXVDcVh6Tl9zMU1nekNQSERyZlFOUDB2cHhHVHFLQSZvZT02QUExRkRGNiIsInR5cGUiOiJ2aWRlbyIsImp0aSI6IjMzMGQ5MTYyNGQ1NTFlZmQiLCJpYXQiOjE3ODg4ODQzMDksImV4cCI6MTc4ODg4NjEwOX0.UZPrNuzM18j6PqC_DDPehHoO3_XXYzc0DEnKTYnWrSg';

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