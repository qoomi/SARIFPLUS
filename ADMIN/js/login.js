/**
 * Login Functionality for Admin Panel
 * Handles secure authentication via Supabase Edge Functions.
 */

document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('login-form');
    const btnLogin = document.getElementById('btn-login');
    const btnText = document.getElementById('btn-text');
    const btnLoader = document.getElementById('btn-loader');
    const usernameInput = document.getElementById('email'); // Corrected ID to match login.html
    const passwordInput = document.getElementById('password');
    let loginAttempts = 0;
    let isLocked = false;
    let lockoutSeconds = 0;

    // Auto-Redirect if session already exists
    async function checkExistingSession() {
        if (!window.supabaseClient) return;
        
        const { data: { session } } = await window.supabaseClient.auth.getSession();
        if (session) {
            window.location.href = 'index.html';
        }
    }
    checkExistingSession();

    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const emailInput = document.getElementById('email');
            const email = emailInput ? emailInput.value.trim() : '';
            const password = passwordInput.value.trim();

            // Point 10 & 12: Input Validation & Rate Limiting
            if (isLocked) {
                showToast(`Too many attempts. Try again in ${lockoutSeconds}s.`, 'error');
                return;
            }

            if (password.length < 6) {
                showToast('Password must be at least 6 characters.', 'error');
                return;
            }

            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                showToast('Please enter a valid email address.', 'error');
                return;
            }

            // UI State: Loading
            setLoading(true);

            // Point 7: Get Captcha Token
            const captchaToken = typeof turnstile !== 'undefined' ? turnstile.getResponse() : null;
            if (!captchaToken && typeof turnstile !== 'undefined') {
                showToast('Please complete the CAPTCHA.', 'error');
                setLoading(false);
                return;
            }

            loginAttempts++;
            if (loginAttempts >= 5) {
                isLocked = true;
                lockoutSeconds = 10;
                
                const countdown = setInterval(() => {
                    lockoutSeconds--;
                    if (lockoutSeconds <= 0) {
                        clearInterval(countdown);
                        isLocked = false;
                        loginAttempts = 0;
                    }
                }, 1000);
            }

            try {
                if (!window.supabaseClient) {
                    throw new Error('Supabase client not initialized!');
                }

                // Official Supabase Auth Call with Captcha
                const { data, error } = await window.supabaseClient.auth.signInWithPassword({
                    email: email,
                    password: password,
                    options: {
                        captchaToken: captchaToken
                    }
                });

                if (error) {
                    throw error;
                }

                if (data.session) {
                    showToast('Login successful! Welcome back.', 'success');
                    
                    // Delay redirect slightly for toast visibility
                    setTimeout(() => {
                        window.location.href = 'index.html';
                    }, 1000);
                }
            } catch (err) {
                // Point 13 & 5: Sanitized error reporting (Error Whitelisting)
                // We show the same message regardless of whether the email exists or the password is wrong
                const userFriendlyMessage = 'Invalid email or password.';
                
                showToast(userFriendlyMessage, 'error');
                setLoading(false);

                // Reset Turnstile on failure for retry
                if (typeof turnstile !== 'undefined') {
                    turnstile.reset();
                }
            }
        });
    }

    function setLoading(isLoading) {
        if (isLoading) {
            btnLogin.classList.add('btn-loading');
            btnText.style.display = 'none';
            btnLoader.style.display = 'block';
        } else {
            btnLogin.classList.remove('btn-loading');
            btnText.style.display = 'block';
            btnLoader.style.display = 'none';
        }
    }

    function showToast(message, type = 'info') {
        if (window.Notifications) {
            window.Notifications.show(message, type);
        } else {
            console.warn('Notifications not ready. Message:', message);
            const toast = document.getElementById('toast');
            if (toast) {
                toast.textContent = message;
                toast.className = `toast show ${type}`;
                setTimeout(() => toast.className = 'toast', 3000);
            }
        }
    }
});
