// ==========================================
// 1. SUPABASE CONFIGURATION & INITIALIZATION
// ==========================================
// Replace these placeholder values with your actual Supabase Project URL and Anon Key from your dashboard settings
const SUPABASE_URL = 'YOUR_SUPABASE_PROJECT_URL';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';

// Initialize the Supabase client
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);


// ==========================================
// 2. DOM CONTENT LOADED & INITIAL FETCH
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  // Fetch and display scholarships as soon as the page loads
  fetchScholarships();

  // Optional: Set up real-time search input listener if you have a search bar in your HTML
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      filterScholarships(e.target.value);
    });
  }
});


// ==========================================
// 3. DATABASE OPERATIONS (FETCHING DATA)
// ==========================================

/**
 * Fetches all scholarship records from the Supabase database.
 */
async function fetchScholarships() {
  try {
    const { data, error } = await supabase
      .from('scholarships')
      .select('*')
      .order('deadline', { ascending: true }); // Automatically sorts by closest deadline

    if (error) {
      console.error('Error fetching scholarships:', error.message);
      showErrorState('Failed to load scholarships. Please try again later.');
      return;
    }

    // Pass the retrieved data to the rendering function
    renderScholarships(data);
  } catch (err) {
    console.error('An unexpected error occurred:', err);
  }
}


// ==========================================
// 4. RENDERING & UI FUNCTIONS
// ==========================================

/**
 * Renders an array of scholarship objects into the webpage DOM.
 * @param {Array} scholarships - List of scholarship records from Supabase
 */
function renderScholarships(scholarships) {
  const container = document.getElementById('scholarships-container');
  if (!container) {
    console.warn('Element with ID "scholarships-container" not found in index.html.');
    return;
  }

  // Clear previous content
  container.innerHTML = '';

  // Handle empty state
  if (!scholarships || scholarships.length === 0) {
    container.innerHTML = `<p class="no-results">No scholarships found at this time.</p>`;
    return;
  }

  // Loop through each scholarship and create a visual card
  scholarships.forEach(s => {
    const card = document.createElement('div');
    card.className = 'scholarship-card';

    card.innerHTML = `
      <h3>${escapeHtml(s.title)}</h3>
      <p class="scholarship-provider"><strong>Provider:</strong> ${escapeHtml(s.provider || 'N/A')}</p>
      <p class="scholarship-amount"><strong>Amount:</strong> ${escapeHtml(s.amount || 'Varies')}</p>
      <p class="scholarship-deadline"><strong>Deadline:</strong> ${formatDate(s.deadline)}</p>
      <p class="scholarship-description">${escapeHtml(s.description || '')}</p>
      ${s.link ? `<a href="${escapeHtml(s.link)}" class="apply-btn" target="_blank" rel="noopener noreferrer">Apply Now</a>` : ''}
    `;

    container.appendChild(card);
  });
}

/**
 * Displays an error message inside the container if the fetch fails.
 */
function showErrorState(message) {
  const container = document.getElementById('scholarships-container');
  if (container) {
    container.innerHTML = `<p class="error-message">${escapeHtml(message)}</p>`;
  }
}


// ==========================================
// 5. HELPER UTILITIES
// ==========================================

/**
 * Formats a date string into a clean, readable format.
 */
function formatDate(dateString) {
  if (!dateString) return 'Open / TBD';
  const options = { year: 'numeric', month: 'short', day: 'numeric' };
  return new Date(dateString).toLocaleDateString(undefined, options);
}

/**
 * Basic HTML sanitizer to prevent unintended script injection.
 */
function escapeHtml(str) {
  if (typeof str !== 'string') return str;
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
