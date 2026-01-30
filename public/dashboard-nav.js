import { auth } from './firebase-config.js';
import { signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

document.addEventListener('DOMContentLoaded', () => {
    const sidebar = document.querySelector('.sidebar');
    if (sidebar) {
        renderSidebar(sidebar);
        
        onAuthStateChanged(auth, (user) => {
            if (user) {
                const avatar = document.getElementById('nav-user-avatar');
                const name = document.getElementById('nav-user-name');
                if (avatar) avatar.textContent = user.email ? user.email.charAt(0).toUpperCase() : 'U';
                if (name) name.textContent = user.email ? user.email : 'User';
            }
        });
    }
});

function renderSidebar(container) {
    const path = window.location.pathname.toLowerCase();
    const isActive = (route) => (path.includes(route) ? 'active bg-dark' : '');

   container.innerHTML = `
        <div class="sidebar-header p-3 fw-bold border-bottom border-secondary">
            <i class="fas fa-star text-primary me-2"></i>ReviewResQ
        </div>
        <ul class="nav-links list-unstyled p-0 m-0 my-3 flex-grow-1">
            <li><a href="/dashboard.html" class="nav-link text-white-50 p-3 text-decoration-none d-flex align-items-center ${isActive('dashboard') || isActive('overview')}"><i class="fas fa-home nav-icon me-3" style="width:20px;text-align:center;"></i> Overview</a></li>
            <li><a href="/ask-reviews.html" class="nav-link text-white-50 p-3 text-decoration-none d-flex align-items-center ${isActive('ask-reviews')}"><i class="fas fa-paper-plane nav-icon me-3" style="width:20px;text-align:center;"></i> Ask for Reviews</a></li>
            <li><a href="/customer-feedback.html" class="nav-link text-white-50 p-3 text-decoration-none d-flex align-items-center ${isActive('customer-feedback')}"><i class="fas fa-comments nav-icon me-3" style="width:20px;text-align:center;"></i> Customer Feedback</a></li>
            <li><a href="/google-reviews.html" class="nav-link text-white-50 p-3 text-decoration-none d-flex align-items-center ${isActive('google-reviews')}"><i class="fas fa-star nav-icon me-3" style="width:20px;text-align:center;"></i> Google Reviews</a></li>
            <li><a href="/customers.html" class="nav-link text-white-50 p-3 text-decoration-none d-flex align-items-center ${isActive('customers')}"><i class="fas fa-users nav-icon me-3" style="width:20px;text-align:center;"></i> Customers</a></li>
            <li><a href="/review-funnel.html" class="nav-link text-white-50 p-3 text-decoration-none d-flex align-items-center ${isActive('review-funnel')}"><i class="fas fa-filter nav-icon me-3" style="width:20px;text-align:center;"></i> Review Funnel</a></li>
            <li><a href="/settings.html" class="nav-link text-white-50 p-3 text-decoration-none d-flex align-items-center ${isActive('settings')}"><i class="fas fa-cog nav-icon me-3" style="width:20px;text-align:center;"></i> Settings</a></li>
        </ul>
        
        <div class="mt-auto border-top border-secondary p-3">
             <div class="d-flex align-items-center gap-3">
                 <div class="rounded-circle bg-primary d-flex align-items-center justify-content-center text-white fw-bold" style="width: 32px; height: 32px;" id="nav-user-avatar">U</div>
                 <div class="flex-grow-1 overflow-hidden">
                     <p class="mb-0 small text-white text-truncate fw-bold" id="nav-user-name">User</p>
                 </div>
                 <button id="nav-logout-btn" class="btn btn-link text-secondary p-0" title="Log Out">
                     <i class="fas fa-sign-out-alt"></i>
                 </button>
             </div>
        </div>
   `;

    const logoutBtn = document.getElementById('nav-logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            try {
                await signOut(auth);
                window.location.href = '/index.html';
            } catch (error) {
                console.error("Logout failed", error);
            }
        });
    }
}
