import { db } from "../../firebase-config.js";
import { doc, getDoc, updateDoc, arrayUnion, collection, query, where, getDocs, orderBy, setDoc } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

console.log("✅ DataService Module Loaded");

export const DataService = {
    async getDashboardData(uid) {
        try {
            const businessRef = doc(db, "businesses", uid);
            const businessSnap = await getDoc(businessRef);
            let businessData = businessSnap.exists() ? businessSnap.data() : {};

            const feedbackQuery = query(
                collection(db, "feedback"), 
                where("businessId", "==", uid),
                orderBy("createdAt", "desc")
            );
            const feedbackSnap = await getDocs(feedbackQuery);
            
            const feedbackList = [];
            let internalRatingSum = 0;
            const feedbackCustomers = [];

            feedbackSnap.forEach(doc => {
                const fb = doc.data();
                feedbackList.push({ id: doc.id, ...fb });
                internalRatingSum += (fb.rating || 0);

                if (fb.customerName || fb.customerEmail) {
                    feedbackCustomers.push({
                        name: fb.customerName || "Anonymous",
                        email: fb.customerEmail || "No Email",
                        status: `Reviewed (${fb.rating}⭐)`,
                        date: fb.createdAt?.seconds 
                            ? new Date(fb.createdAt.seconds * 1000).toLocaleDateString() 
                            : (fb.date || "Recent"),
                        source: "Feedback"
                    });
                }
            });

            let manualCustomers = businessData.customers || [];
            const mergedCustomers = [...manualCustomers];
            feedbackCustomers.forEach(fbCust => {
                const exists = manualCustomers.some(c => c.email && c.email === fbCust.email);
                if (!exists) mergedCustomers.push(fbCust);
            });

            let googleCount = businessData.totalReviews || 0;
            let googleRating = businessData.avgRating || 0;
            if (googleCount === 0 && businessData.googleBusinessProfile) {
                googleCount = businessData.googleBusinessProfile.userReviewCount || 0;
                googleRating = businessData.googleBusinessProfile.averageRating || 0;
            }

            const totalCount = googleCount + feedbackList.length;
            let finalAvg = (totalCount > 0) ? ((googleCount * googleRating) + internalRatingSum) / totalCount : 0;

            return {
                stats: { totalReviews: totalCount, avgRating: finalAvg.toFixed(1), invitesSent: businessData.invitesSent || 0 },
                settings: { businessName: businessData.businessName || "", googleLink: businessData.googleLink || "", logo: businessData.logo || null, plan: businessData.plan || "starter" },
                funnel: businessData.funnel || { headline: "How was your experience?", body: "We value your feedback!", color: "#4F46E5", threshold: "4" },
                customers: mergedCustomers,
                feedback: feedbackList
            };
        } catch (error) { console.error("DataService Error:", error); throw error; }
    },
    async addCustomer(uid, name, email) {
        const newCustomer = { name, email, status: 'Invite Sent', date: new Date().toLocaleDateString(), source: 'Manual' };
        await updateDoc(doc(db, "businesses", uid), { customers: arrayUnion(newCustomer) });
        return newCustomer;
    },
    async saveSettings(uid, settings) { await setDoc(doc(db, "businesses", uid), settings, { merge: true }); },
    async saveFunnelConfig(uid, config) { await setDoc(doc(db, "businesses", uid), { funnel: config }, { merge: true }); },
    async updatePlan(uid, plan) { await updateDoc(doc(db, "businesses", uid), { plan }); },
    async incrementInviteCount(uid, count) { await updateDoc(doc(db, "businesses", uid), { invitesSent: count + 1 }); }
};