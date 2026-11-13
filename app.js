const SUPABASE_URL = 'https://roeibtcsrgegskslvlbd.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_4g7D5_4SCj2GiEgue6fbgg_veUSxtmq';

// Safely initialize Supabase to prevent duplicate declaration errors
window.supabaseClient = window.supabaseClient || window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const supabase = window.supabaseClient;

// Global array to store fetched stories for local search filtering
let allStories = [];


// ==========================================
// 2. DOM CONTENT LOADED & INITIAL FETCH
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  // Fetch and display stories as soon as the page loads
  fetchStories();

  // Set up real-time search input listener matching your HTML input ID (#searchInput)
  const searchInput = document.getElementById('searchInput');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      filterStories(e.target.value);
    });
  }
});


// ==========================================
// 3. DATABASE OPERATIONS (FETCHING DATA)
// ==========================================

/**
 * Fetches all story records from the Supabase 'stories' table.
 */
async function fetchStories() {
  try {
    const { data, error } = await supabase
      .from('stories')
      .select('*')
      .order('created_at', { ascending: false }); // Newest stories first

    if (error) {
      console.error('Error fetching stories:', error.message);
      showErrorState('Failed to load stories. Please try again later.');
      return;
    }

    // Save data globally and render everything initially
    allStories = data || [];
    renderStories(allStories);
  } catch (err) {
    console.error('An unexpected error occurred:', err);
    showErrorState('An unexpected error occurred while loading stories.');
  }
}


// ==========================================
// 4. RENDERING & FILTERING FUNCTIONS
// ==========================================

/**
 * Filters stories based on the search query across title, author, and content.
 */
function filterStories(query) {
  const searchTerm = query.toLowerCase().trim();

  const filtered = allStories.filter(story => {
    const title = (story.title || '').toLowerCase();
    const author = (story.author || '').toLowerCase();
    const content = (story.content || '').toLowerCase();

    return title.includes(searchTerm) || 
           author.includes(searchTerm) || 
           content.includes(searchTerm);
  });

  renderStories(filtered);
}

/**
 * Renders an array of story objects into the webpage DOM.
 * @param {Array} stories - List of story records to render
 */
function renderStories(stories) {
  const container = document.getElementById('stories-container') || document.getElementById('app');
  if (!container) return;

  // Clear previous content or create container if missing
  let targetContainer = document.getElementById('stories-container');
  if (!targetContainer) {
    targetContainer = document.createElement('div');
    targetContainer.id = 'stories-container';
    container.appendChild(targetContainer);
  }

  targetContainer.innerHTML = '';

  // Handle empty state
  if (!stories || stories.length === 0) {
    targetContainer.innerHTML = `<p class="no-results">No stories found matching your search.</p>`;
    return;
  }

  // Loop through each story and create a visual card
  stories.forEach(story => {
    const card = document.createElement('div');
    card.className = 'story-card';

    // Format tags array nicely if available
    const tagsHtml = story.tags && story.tags.length > 0 
      ? `<p class="story-tags"><strong>Tags:</strong> ${story.tags.join(', ')}</p>` 
      : '';

    card.innerHTML = `
      <h3 class="story-title">${escapeHtml(story.title)}</h3>
      <p class="story-author"><strong>Author:</strong> ${escapeHtml(story.author || 'Anonymous')}</p>
      <p class="story-date"><strong>Published:</strong> ${formatDate(story.created_at)}</p>
      <p class="story-excerpt">${escapeHtml(story.content ? story.content.substring(0, 150) + '...' : '')}</p>
      ${tagsHtml}
    `;

    targetContainer.appendChild(card);
  });
}

/**
 * Displays an error message inside the container if the fetch fails.
 */
function showErrorState(message) {
  const container = document.getElementById('stories-container') || document.getElementById('app');
  if (container) {
    container.innerHTML = `<p class="error-message">${escapeHtml(message)}</p>`;
  }
}


// ==========================================
// 5. HELPER UTILITIES
// ==========================================

/**
 * Formats a timestamp into a clean, readable date string.
 */
function formatDate(dateString) {
  if (!dateString) return 'Recently';
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
