console.log("✅ UIRenderer Module Loaded");

export const UIRenderer = {
    renderStats(stats) {
        if (!stats) return;
        const els = { t: document.getElementById('stat-total'), r: document.getElementById('stat-rating'), i: document.getElementById('stat-invites') };
        if(els.t) els.t.innerText = stats.totalReviews;
        if(els.r) els.r.innerText = stats.avgRating;
        if(els.i) els.i.innerText = stats.invitesSent;
    },
    renderSettings(settings) {
        if (!settings) return;
        const nameInp = document.getElementById('inp-biz-name');
        const linkInp = document.getElementById('inp-biz-link');
        if(nameInp) nameInp.value = settings.businessName || "";
        if(linkInp) linkInp.value = settings.googleLink || "";
        if(settings.logo) {
            const prev = document.getElementById('preview-logo');
            if(prev) prev.innerHTML = `<img src="${settings.logo}">`;
        }
    },
    renderCustomers(customers) {
        const tbody = document.getElementById('customers-list');
        if (!tbody) return;
        tbody.innerHTML = (customers.length === 0) ? '<tr><td colspan="4" style="text-align:center; padding:20px;">No customers.</td></tr>' : 
        [...customers].reverse().map(c => `<tr><td>${c.name}</td><td>${c.email}</td><td><span class="badge badge-success">${c.status}</span></td><td>${c.date}</td></tr>`).join('');
    },
    renderFeedback(list) {
        const container = document.querySelector('#sec-feedback .content-card');
        if (!container) return;
        container.innerHTML = `<h3>Customer Feedback (${list.length})</h3>`;
        const div = document.createElement('div');
        div.style.marginTop = '20px';
        list.forEach(item => {
            const stars = '⭐'.repeat(item.rating || 1);
            const box = document.createElement('div');
            box.style.cssText = `padding:15px; border:1px solid #e5e7eb; border-radius:8px; margin-bottom:10px; background:${item.rating >= 4 ? '#f0fdf4' : '#fef2f2'}`;
            box.innerHTML = `<div style="display:flex; justify-content:space-between"><strong>${stars} ${item.customerName || "Anonymous"}</strong><small>${item.date || "Recent"}</small></div><p style="margin:5px 0 0">"${item.message || "No comment"}"</p>`;
            div.appendChild(box);
        });
        container.appendChild(div);
    },
    renderPlans(current) {
        const container = document.getElementById('billing-plans-container');
        if (!container) return;
        const plans = [
            { id: 'starter', name: 'Starter', price: '$0' },
            { id: 'growth', name: 'Growth', price: '$49' },
            { id: 'ai_suite', name: 'AI Suite', price: '$99' }
        ];
        container.innerHTML = `<div class="pricing-grid" style="display:grid; grid-template-columns:repeat(3,1fr); gap:15px">` + 
        plans.map(p => {
            const active = (p.id === (current || 'starter'));
            return `<div class="plan-card ${active ? 'active' : ''}" style="border:1px solid #eee; padding:20px; text-align:center; border-radius:10px; background:${active ? '#f0f7ff' : '#fff'}">
                <h3>${p.name}</h3><h2>${p.price}</h2>
                <button class="btn-${active ? 'secondary' : 'primary'}" ${active ? 'disabled' : ''} onclick="app.switchPlan('${p.id}')">${active ? 'Active' : 'Upgrade'}</button>
            </div>`;
        }).join('') + `</div>`;
    }
};