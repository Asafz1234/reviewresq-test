import {
  db,
  collection,
  query,
  where,
  orderBy,
  onSnapshot,
  httpsCallable,
  functions,
} from "./firebase-config.js";
import { listenForUser } from "./session-data.js";

const flowForm = document.getElementById("flowForm");
const flowNameInput = document.getElementById("flowName");
const triggerSelect = document.getElementById("triggerSelect");
const stepList = document.getElementById("flowSteps");
const addStepBtn = document.getElementById("addStep");
const flowStatus = document.getElementById("flowStatus");
const flowsTableBody = document.getElementById("flowsTableBody");

let businessId = null;
let steps = [];

function renderSteps() {
  if (!steps.length) {
    stepList.innerHTML = '<p class="caption">No steps yet.</p>';
    return;
  }

  stepList.innerHTML = steps
    .map(
      (step, idx) => `
      <div class="flow-step" data-idx="${idx}">
        <div class="chip chip-muted">${step.type}</div>
        <div class="caption">${step.details || ""}</div>
        <button class="btn btn-secondary" data-remove="${idx}">Remove</button>
      </div>
    `,
    )
    .join("");
}

function addStep(type, details) {
  steps.push({ type, details });
  renderSteps();
}

function handleAddStep() {
  const type = document.getElementById("stepType").value;
  const detailInput = document.getElementById("stepDetail");
  const details = detailInput.value || "";
  if (!type) return;
  addStep(type, details);
  detailInput.value = "";
}

function handleRemoveStep(evt) {
  const idx = evt.target.getAttribute("data-remove");
  if (idx === null) return;
  steps.splice(Number(idx), 1);
  renderSteps();
}

function renderFlows(list = []) {
  if (!list.length) {
    flowsTableBody.innerHTML =
      '<tr><td colspan="4" class="caption">No flows configured.</td></tr>';
    return;
  }

  flowsTableBody.innerHTML = list
    .map(
      (flow) => `
      <tr>
        <td>${flow.name}</td>
        <td>${flow.trigger}</td>
        <td>${flow.steps?.length || 0} steps</td>
        <td>${flow.updatedAt ? new Date(flow.updatedAt).toLocaleString() : "—"}</td>
      </tr>
    `,
    )
    .join("");
}

async function loadFlows() {
  if (!businessId) return;
  const q = query(
    collection(db, "automationFlows"),
    where("businessId", "==", businessId),
    orderBy("updatedAt", "desc"),
  );
  onSnapshot(q, (snap) => {
    const rows = snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    renderFlows(rows);
  });
}

async function handleSaveFlow(evt) {
  evt.preventDefault();
  if (!businessId) return;
  if (!flowNameInput.value || !steps.length) return;

  const payload = {
    businessId,
    name: flowNameInput.value,
    trigger: triggerSelect.value,
    steps,
    updatedAt: new Date().toISOString(),
  };

  flowStatus.textContent = "Saving...";
  try {
    const saveFlow = httpsCallable(functions, "saveAutomationFlow");
    await saveFlow(payload);
    flowStatus.textContent = "Saved";
    steps = [];
    flowNameInput.value = "";
    renderSteps();
  } catch (err) {
    console.error("Failed to save flow", err);
    flowStatus.textContent = "Error";
  }
}

function init() {
  listenForUser((user) => {
    if (!user) return;
    businessId = user.uid;
    loadFlows();
  });

  addStepBtn?.addEventListener("click", handleAddStep);
  stepList?.addEventListener("click", handleRemoveStep);
  flowForm?.addEventListener("submit", handleSaveFlow);
}

init();
