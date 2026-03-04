const form = document.getElementById('buildForm');
const msg = document.getElementById('formMessage');
const progressBar = document.getElementById('progressBar');

function setMessage(text, type = 'info') {
  msg.textContent = text;
  msg.style.color = type === 'error' ? '#fca5a5' : type === 'success' ? '#86efac' : '#cbd5e1';
}

function updateProgress(value) {
  progressBar.style.width = `${Math.max(0, Math.min(100, value))}%`;
}

async function pollJob(jobId) {
  let attempts = 0;
  while (attempts < 240) {
    await new Promise((resolve) => setTimeout(resolve, 2500));
    const res = await fetch(`/api/build/${jobId}`);
    const data = await res.json();

    if (data.status === 'completed') {
      updateProgress(100);
      const links = (data.result?.artifacts || [])
        .map((a) => `${a.platform.toUpperCase()}: ${a.downloadUrl}`)
        .join(' | ');
      setMessage(`Build completed! ${links}`, 'success');
      return;
    }
    if (data.status === 'failed') {
      setMessage(`Build failed: ${data.error || 'Unknown error'}`, 'error');
      return;
    }

    attempts += 1;
    updateProgress(Math.min(95, 10 + attempts));
    setMessage(`Build status: ${data.status}`);
  }

  setMessage('Build is taking longer than expected. Please check status endpoint.', 'error');
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  updateProgress(5);

  const formData = new FormData(form);
  const platforms = [...form.querySelectorAll("input[name='platforms']:checked")].map((x) => x.value);
  if (platforms.length === 0) {
    setMessage('Select at least one platform.', 'error');
    return;
  }

  const zip = form.querySelector("input[name='appZip']").files[0];
  if (!zip || !zip.name.toLowerCase().endsWith('.zip')) {
    setMessage('Please upload a valid ZIP file.', 'error');
    return;
  }

  formData.set('platforms', platforms.join(','));
  formData.set('camera', formData.get('camera') ? 'true' : 'false');
  formData.set('push', formData.get('push') ? 'true' : 'false');
  formData.set('analytics', formData.get('analytics') ? 'true' : 'false');

  setMessage('Uploading and queueing build...');

  try {
    const res = await fetch('/api/build', { method: 'POST', body: formData });
    const data = await res.json();

    if (!res.ok) {
      setMessage(data.error || 'Request failed.', 'error');
      return;
    }

    updateProgress(15);
    setMessage(`Build queued. Job ID: ${data.jobId}`);
    await pollJob(data.jobId);
  } catch (error) {
    setMessage(`Network error: ${error.message}`, 'error');
  }
});
