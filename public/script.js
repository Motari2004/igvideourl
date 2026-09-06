async function handleDownload() {
    const urlInput = document.getElementById('urlInput');
    const downloadBtn = document.getElementById('downloadBtn');
    const errorDiv = document.getElementById('errorMessage');
    const resultSection = document.getElementById('resultSection');
    
    const url = urlInput.value.trim();
    
    // Validate URL
    if (!url) {
        showError('Please enter an Instagram video URL');
        return;
    }
    
    if (!url.includes('instagram.com')) {
        showError('Please enter a valid Instagram URL');
        return;
    }

    // Show loading state
    downloadBtn.disabled = true;
    downloadBtn.classList.add('loading');
    hideError();
    resultSection.style.display = 'none';

    try {
        const response = await fetch('/api/download', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ url })
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Download failed');
        }

        if (!data.success) {
            throw new Error(data.error || 'Download failed');
        }

        // Show result
        showResult(data.data);

    } catch (error) {
        showError(error.message || 'Failed to download video. Please try again.');
    } finally {
        // Reset button state
        downloadBtn.disabled = false;
        downloadBtn.classList.remove('loading');
    }
}

function showResult(data) {
    const resultSection = document.getElementById('resultSection');
    const filename = document.getElementById('filename');
    const fileSize = document.getElementById('fileSize');
    const downloadLink = document.getElementById('downloadLink');

    filename.textContent = data.filename;
    fileSize.textContent = data.fileSize;
    downloadLink.href = data.downloadUrl;
    
    resultSection.style.display = 'block';
    resultSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function showError(message) {
    const errorDiv = document.getElementById('errorMessage');
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
}

function hideError() {
    const errorDiv = document.getElementById('errorMessage');
    errorDiv.style.display = 'none';
}

function resetForm() {
    const urlInput = document.getElementById('urlInput');
    const resultSection = document.getElementById('resultSection');
    const errorDiv = document.getElementById('errorMessage');
    
    urlInput.value = '';
    resultSection.style.display = 'none';
    errorDiv.style.display = 'none';
    urlInput.focus();
}

// Enter key support
document.getElementById('urlInput').addEventListener('keypress', function(e) {
    if (e.key === 'Enter') {
        handleDownload();
    }
});

// Auto-focus on load
document.addEventListener('DOMContentLoaded', function() {
    document.getElementById('urlInput').focus();
});