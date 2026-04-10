/**
 * Notifications Utility (notifications.js)
 * Responsible for showing toast notifications across the application.
 */

const Notifications = {
    toastElement: null,
    timeout: null,

    /**
     * Initialize the notification system
     */
    init() {
        // Find or create the toast element
        this.toastElement = document.getElementById('toast');
        if (!this.toastElement) {
            this.toastElement = document.createElement('div');
            this.toastElement.id = 'toast';
            this.toastElement.className = 'toast';
            document.body.appendChild(this.toastElement);
        }
    },

    /**
     * Show a notification
     * @param {string} message The message to display
     * @param {string} type 'success' | 'error' | 'info'
     */
    show(message, type = 'info') {
        if (!this.toastElement) this.init();

        // Clear existing timeout
        if (this.timeout) clearTimeout(this.timeout);

        // Set message and style
        this.toastElement.textContent = message;
        this.toastElement.className = `toast show ${type}`;

        // Hide after 3 seconds
        this.timeout = setTimeout(() => {
            this.toastElement.classList.remove('show');
        }, 3000);
    }
};

// Export to window
window.Notifications = Notifications;

// Auto-init on load
document.addEventListener('DOMContentLoaded', () => Notifications.init());
