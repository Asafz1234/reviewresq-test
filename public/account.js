import { setPlan } from "./plan-store.js";

// Global Switch Function
window.switchPlan = async (newPlan) => {
    console.log(`[Billing] Manually switching to: ${newPlan}`);
    
    // 1. Force Local Storage
    localStorage.setItem('rr_simulated_plan', newPlan);
    
    // 2. Update Visuals Immediately (Don't wait for reload)
    updateButtons(newPlan);
    
    // 3. Update Store logic
    setPlan(newPlan, { source: 'manual_billing_test' });

    // 4. Reload to apply changes across the app
    setTimeout(() => {
        window.location.reload();
    }, 300);
};

window.resetSimulation = () => {
    localStorage.removeItem('rr_simulated_plan');
    window.location.reload();
};

function updateButtons(activePlanId) {
    if (!activePlanId) return;
    const currentPlan = activePlanId.toLowerCase();
    
    console.log("[AccountUI] Updating buttons. Active:", currentPlan);

    const buttons = {
        'starter': "button[onclick*='starter']",
        'growth': "button[onclick*='growth']",
        'ai-suite': "button[onclick*='ai-suite']"
    };

    // Reset ALL buttons to "Available" state
    Object.values(buttons).forEach(selector => {
        const btn = document.querySelector(selector);
        if (btn) {
            btn.disabled = false;
            btn.classList.remove('bg-gray-300', 'text-gray-600', 'cursor-not-allowed', 'opacity-50');
            
            // Restore original styles & text
            if (selector.includes('starter')) {
                btn.innerText = "Switch to Starter";
                btn.classList.add('border', 'border-slate-300', 'text-slate-700', 'hover:bg-slate-50');
            }
            if (selector.includes('growth')) {
                btn.innerText = "Upgrade to Growth";
                btn.classList.add('bg-blue-600', 'text-white', 'hover:bg-blue-700');
            }
            if (selector.includes('ai')) {
                btn.innerText = "Unlock AI Suite";
                btn.classList.add('border', 'border-purple-200', 'text-purple-700', 'hover:bg-purple-50');
            }
        }
    });

    // Disable ONLY the active button
    const activeBtnSelector = buttons[currentPlan];
    const activeBtn = document.querySelector(activeBtnSelector);
    
    if (activeBtn) {
        activeBtn.disabled = true;
        activeBtn.innerText = "Current Plan";
        // Strip coloring and make it gray
        activeBtn.className = "w-full py-3 px-4 bg-gray-200 text-gray-500 font-bold rounded-xl cursor-not-allowed mb-8";
    }
}

// Run immediately on load using the Simulation Source of Truth
document.addEventListener('DOMContentLoaded', () => {
    const sim = localStorage.getItem('rr_simulated_plan');
    // If simulation exists, use it. Otherwise, wait for store/cache.
    if (sim) {
        updateButtons(sim);
    } else {
        // Fallback to reading the attribute set by nav-access-init
        const attrPlan = document.documentElement.getAttribute('data-user-plan');
        if (attrPlan) updateButtons(attrPlan);
    }
});