// Initialize Supabase Client
const SUPABASE_URL = 'YOUR_SUPABASE_URL';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function switchTab(tabId, btnId) {
  document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.remove('active');
    btn.setAttribute('aria-selected', 'false');
  });

  document.getElementById(tabId).classList.add('active');
  const activeBtn = document.getElementById(btnId);
  activeBtn.classList.add('active');
  activeBtn.setAttribute('aria-selected', 'true');

  if (tabId === 'tracker-tab') {
    fetchSubmissions();
  }
}

async function handleFormSubmit(event, type, alertId) {
  event.preventDefault();

  const alertBox = document.getElementById(alertId);
  const reqId = 'SCH-'+ Math.floor(1000 + Math.random() * 9000);

  let fieldOne, fieldTwo, fieldThree, description;
  
  // Map form fields based on submission type
  if (type.includes('Public') || type.includes('Scholarship')) {
    fieldOne = document.getElementById('location')?.value || document.getElementById('shelter-name')?.value;
    fieldTwo = document.getElementById('primary-need')?.value || '';
    fieldThree = 'N/A';
    description = document.getElementById('description')?.value || '';
  } else {
    fieldOne = document.getElementById('shelter-name')?.value || '';
    fieldTwo = document.getElementById('staff-role')?.value || '';
    fieldThree = document.getElementById('request-type')?.value || '';
    description = document.getElementById('details')?.value || '';
  }

  // Insert record into Supabase database table
  const { error } = await supabase.from('scholarships').insert([
    {
      request_id: reqId,
      form_type: type,
      field_one: fieldOne,
      field_two: fieldTwo,
      description: description,
      status: 'Pending Review'
    }
  ]);

  if (error) {
    console.error('Database insertion error:', error);
    alert('Submission failed. Please check your network or database configuration.');
    return;
  }

  alertBox.style.display = 'block';
  event.target.reset();

  setTimeout(() => {
    alertBox.style.display = 'none';
  }, 4000);

  fetchSubmissions();
}

async function fetchSubmissions() {
  const trackerList = document.getElementById('tracker-list');
  
  // Fetch live records from Supabase
  const { data, error } = await supabase
    .from('scholarships')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching database records:', error);
    return;
  }

  trackerList.innerHTML = '';

  data.forEach(item => {
    const card = document.createElement('div');
    card.className = 'status-card';
    
    let badgeClass = 'badge-pending';
    if (item.status === 'In Progress') badgeClass = 'badge-in-progress';
    if (item.status === 'Completed') badgeClass = 'badge-completed';

    card.innerHTML = `
      <div class="status-header">
        <span class="status-id">${item.request_id}</span>
        <span class="badge ${badgeClass}">${item.status}</span>
      </div>
      <strong class="card-title">${item.form_type}</strong>
      <p class="card-sub">Target/Source: ${item.field_one} | Field: ${item.field_two}</p>
      <p class="card-meta"><em>Details: ${item.description}</em></p>
    `;
    trackerList.appendChild(card);
  });
}

// Automatically load entries on startup
window.addEventListener('DOMContentLoaded', () => {
  fetchSubmissions();
});
