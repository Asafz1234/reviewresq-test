import { doc, getDoc, collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";
import { db } from "./firebase-config.js";

const loader = document.getElementById("loader");
const reviewPanel = document.getElementById("review-panel");
const errorState = document.getElementById("error-state");

const businessLogoEl = document.getElementById("business-logo");
const businessNameEl = document.getElementById("business-name");
const starContainer = document.getElementById("star-rating-container");

const initialStep = document.getElementById("step-initial");
const happyStep = document.getElementById("step-happy");
const unhappyStep = document.getElementById("step-unhappy");
const finalStep = document.getElementById("step-final");

const googleReviewBtn = document.getElementById("google-review-btn");
const feedbackForm = document.getElementById("feedback-form");
const feedbackMessageEl = document.getElementById("feedback-message");
const submitFeedbackBtn = document.getElementById("submit-feedback-btn");

let businessId = null;
let businessData = null;
let selectedRating = 0;

document.addEventListener("DOMContentLoaded", async () => {
  try {
    const urlParams = new URLSearchParams(window.location.search);
    businessId = urlParams.get('id');

    if (!businessId) {
      showError("No business ID provided.");
      return;
    }

    const businessDocRef = doc(db, "businesses", businessId);
    const businessDocSnap = await getDoc(businessDocRef);

    if (!businessDocSnap.exists()) {
      showError("Business not found.");
      return;
    }

    businessData = businessDocSnap.data();
    renderBusinessInfo();
    renderStars();
    showPanel();

  } catch (error) {
    console.error("Error initializing review panel:", error);
    showError("Could not load review panel.");
  }
});

function renderBusinessInfo() {
  businessNameEl.textContent = businessData.businessName || 'Leave a Review';
  if (businessData.logoUrl) {
    businessLogoEl.src = businessData.logoUrl;
    businessLogoEl.style.display = 'block';
  }
}

function renderStars() {
  starContainer.innerHTML = '';
  for (let i = 1; i <= 5; i++) {
    const star = document.createElement('span');
    star.classList.add('star');
    star.dataset.value = i;
    star.innerHTML = '&#9733;'; // HTML entity for a star
    star.addEventListener('click', handleStarClick);
    star.addEventListener('mouseover', handleStarHover);
    star.addEventListener('mouseout', handleStarMouseout);
    starContainer.appendChild(star);
  }
}

function handleStarHover(e) {
  const hoverValue = parseInt(e.target.dataset.value, 10);
  const stars = starContainer.querySelectorAll('.star');
  stars.forEach(star => {
    const starValue = parseInt(star.dataset.value, 10);
    star.classList.toggle('active', starValue <= hoverValue);
  });
}

function handleStarMouseout() {
    const stars = starContainer.querySelectorAll('.star');
    stars.forEach(star => {
        const starValue = parseInt(star.dataset.value, 10);
        star.classList.toggle('active', starValue <= selectedRating);
    });
}

function handleStarClick(e) {
  selectedRating = parseInt(e.target.dataset.value, 10);
  
  // Make selection permanent on click
  const stars = starContainer.querySelectorAll('.star');
  stars.forEach(star => {
      star.removeEventListener('mouseout', handleStarMouseout);
      star.removeEventListener('mouseover', handleStarHover);
  });

  setTimeout(() => {
    if (selectedRating >= 4) {
      // Happy path
      document.getElementById('happy-headline').textContent = `Thank you for the ${selectedRating}-star review!`;
      document.getElementById('happy-prompt').textContent = 'Help us spread the word by sharing your experience on Google. It only takes a minute!';
      googleReviewBtn.textContent = 'Post Review on Google';
      if(businessData.googleReviewUrl) {
          googleReviewBtn.href = businessData.googleReviewUrl;
      } else {
          googleReviewBtn.style.display = 'none'; // Hide button if no URL
      }
      showStep(happyStep);
    } else {
      // Unhappy path
      document.getElementById('unhappy-headline').textContent = 'We\'re sorry to hear that.';
      document.getElementById('unhappy-prompt').textContent = 'Your feedback is important. Please let us know what we can do to improve.';
      showStep(unhappyStep);
    }
  }, 400);
}

feedbackForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const message = feedbackMessageEl.value.trim();

    if (!message) return;

    submitFeedbackBtn.disabled = true;
    submitFeedbackBtn.textContent = 'Submitting...';

    try {
        await addDoc(collection(db, 'feedback'), {
            businessId: businessId,
            rating: selectedRating,
            message: message,
            customerContact: null, // We aren't collecting this yet
            status: 'new',
            createdAt: serverTimestamp()
        });
        showStep(finalStep);
    } catch (error) {
        console.error("Error submitting feedback:", error);
        showError("Failed to submit your feedback. Please try again.");
        // Restore the form if submission fails
        showStep(unhappyStep);
    } finally {
        submitFeedbackBtn.disabled = false;
        submitFeedbackBtn.textContent = 'Submit Feedback';
    }
});

function showStep(stepToShow) {
  [initialStep, happyStep, unhappyStep, finalStep].forEach(step => {
    step.style.display = 'none';
  });
  stepToShow.style.display = 'block';
}

function showPanel() {
  loader.style.display = 'none';
  reviewPanel.style.display = 'flex';
}

function showError(message) {
  console.error(message);
  loader.style.display = 'none';
  reviewPanel.style.display = 'flex'; // Show the panel to display the error inside it
  [initialStep, happyStep, unhappyStep, finalStep].forEach(step => {
    step.style.display = 'none';
  });
  errorState.style.display = 'block';
}
