// Supabase Configuration & Initialization
// IMPORTANT: Replace the placeholders with your actual Supabase credentials.

const SUPABASE_URL = 'https://nmepqkwuujlfduiexplm.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_KxiyrsPEVAScJpN4pAIUzA_Xnu6sFX0';

console.log('supabase.js: Initializing with URL:', SUPABASE_URL);

try {
    if (!SUPABASE_URL || SUPABASE_URL.includes('YOUR_SUPABASE_URL')) {
        throw new Error('Supabase URL is missing or still has placeholder value.');
    }

    // Initialize the Supabase client
    const client = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    console.log('supabase.js: Client created successfully');

    // Export for use in other files
    window.supabaseClient = client;
} catch (err) {
    console.error('supabase.js: Failed to initialize Supabase client:', err.message);
}
