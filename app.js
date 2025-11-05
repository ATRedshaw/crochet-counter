// app.js: Core application logic for the Crochet Counter PWA.

document.addEventListener('DOMContentLoaded', () => {

    // --- STATE MANAGEMENT --- //

    // Holds the entire application state.
    let appState = {
        activeProject: null,
        savedProjects: [],
        settings: {
            showTimer: true,
        },
        activeModal: null, // null, 'settings', 'projects', 'confirm', 'setTarget'
        confirmationContext: { // Context for the confirmation modal
            action: null,
            data: null,
            title: '',
            message: '',
            onConfirm: null,
        },
        setTargetContext: { // Context for the set target modal
            counterId: null,
            currentValue: 0,
            onSet: null,
            message: '',
        },
        isDirty: false, // Tracks if the active project has unsaved changes
        toast: { // For showing transient messages
            message: null,
            type: 'info', // 'info', 'success', 'error'
            visible: false,
        }
    };

    // Holds the interval ID for the project timer.
    let projectTimerInterval;

    // --- DOM ELEMENT SELECTORS --- //

    // Centralized object for all DOM element references.
    const dom = {
        app: document.getElementById('app'),
        projectContainer: document.getElementById('project-container'),
        projectName: document.querySelector('[data-binding="projectName"]'),
        projectTimer: document.querySelector('[data-binding="project-timer"]'),
        timerDisplay: document.querySelector('[data-binding="timer-display"]'),
        timerPauseBtn: document.querySelector('[data-action="toggle-timer-pause"]'),
        mainCounterContainer: document.getElementById('main-counter-container'),
        subCountersContainer: document.getElementById('sub-counters-container'),
        projectNotes: document.querySelector('[data-binding="projectNotes"]'),
        projectPatternUrl: document.querySelector('[data-binding="projectPatternUrl"]'),
        saveProjectBtn: document.querySelector('[data-action="save-project"]'),
        modalContainer: document.getElementById('modal-container'),
        modalOverlay: document.querySelector('[data-modal-overlay]'),
        modals: {
            settings: document.querySelector('[data-modal="settings"]'),
            projects: document.querySelector('[data-modal="projects"]'),
            confirm: document.querySelector('[data-modal="confirm"]'),
            setTarget: document.querySelector('[data-modal="setTarget"]'),
        },
        projectsList: document.getElementById('projects-list'),
        confirmTitle: document.querySelector('[data-binding="confirm-title"]'),
        confirmMessage: document.querySelector('[data-binding="confirm-message"]'),
        setTargetMessage: document.querySelector('[data-binding="set-target-message"]'),
        setTargetInput: document.getElementById('set-target-input'),
        showTimerToggle: document.querySelector('[data-setting="showTimer"]'),
        toastContainer: document.getElementById('toast-container'),
    };

    // --- INITIALIZATION --- //

    // Main entry point for the application.
    function init() {
    loadSettings();
    registerEventListeners();
    loadInitialProject();
    startProjectTimer();
    registerServiceWorker();
    setupServiceWorkerUpdateListener();
    applyTheme(); // Apply dark theme on startup
    }

    // Fetches saved projects and loads the last active project, or creates a new default project.
    async function loadInitialProject() {
        await fetchSavedProjects();
        
        // Try to get the last active project ID from localStorage
        const lastProjectId = localStorage.getItem('lastProjectId');
        const wasLastProjectUnsaved = localStorage.getItem('lastProjectUnsaved') === 'true';
        
        if (wasLastProjectUnsaved) {
            // If last project was unsaved, start with default state
            setActiveProject(createDefaultProject());
        } else if (lastProjectId) {
            // Try to find the saved project with matching ID
            const lastProject = appState.savedProjects.find(p => p.id === lastProjectId);
            if (lastProject) {
                setActiveProject(lastProject);
            } else {
                // If project not found (might have been deleted), load default
                setActiveProject(createDefaultProject());
            }
        } else {
            // No last project stored, create default
            setActiveProject(createDefaultProject());
        }
        render();
    }

    // --- PROJECT & STATE CORE LOGIC --- //

    // Creates a blank project object.
    function createDefaultProject() {
        return {
            id: null, // No ID means it's not saved
            name: 'New Project',
            lastModified: Date.now(),
            timer: { totalElapsedMs: 0, isPaused: false, lastTick: Date.now() },
            mainCounter: { id: 'main', name: 'Row', value: 0, target: null },
            subCounters: [],
            incrementHistory: [],
            notes: '',
            patternUrl: '',
        };
    }
    
    // Sets the provided project as the active one in the application state.
    function setActiveProject(project) {
        appState.activeProject = project;
        appState.isDirty = false;
        if (project.timer && !project.timer.isPaused) {
            project.timer.lastTick = Date.now();
        }
        
        // Store the last project information
        if (project.id) {
            localStorage.setItem('lastProjectId', project.id);
            localStorage.setItem('lastProjectUnsaved', 'false');
        } else {
            localStorage.removeItem('lastProjectId');
            localStorage.setItem('lastProjectUnsaved', 'true');
        }
    }

    // Marks the current project as having unsaved changes.
    function markDirty() {
        if (appState.isDirty) return;
        appState.isDirty = true;
        renderSaveButton();
    }
    
    // A wrapper function to apply a modification, mark the project as dirty,
    // auto-save if possible, and then re-render the UI.
    function updateAndSave(modificationFn) {
        if (!appState.activeProject) return;
        modificationFn();
        appState.activeProject.lastModified = Date.now();

        // Only mark as dirty if the project isn't saved yet
        if (!appState.activeProject.id) {
            markDirty();
        } else {
            // For saved projects, auto-save silently without changing button state
            saveActiveProject(true);
        }
        render();
    }

    // Updates a property on a counter or the project itself without a full re-render.
    // Used for input fields to prevent losing focus.
    function updateProjectProperty(prop, value) {
        if (!appState.activeProject) return;
        appState.activeProject[prop] = value;
        appState.activeProject.lastModified = Date.now();
        markDirty();
        
        if (appState.activeProject.id) {
            saveActiveProject(true);
        } else {
            renderSaveButton();
        }
    }

    function updateCounterProperty(counterId, prop, value) {
        if (!appState.activeProject) return;
        const counter = findCounter(counterId);
        if (counter) {
            counter[prop] = value;
            appState.activeProject.lastModified = Date.now();
            
            // For names, only mark as dirty without auto-saving
            if (prop === 'name') {
                if (!appState.activeProject.id) {
                    markDirty();
                    renderSaveButton();
                }
            } else {
                // For other properties (like target), auto-save if the project is saved
                if (appState.activeProject.id) {
                    saveActiveProject(true);
                } else {
                    markDirty();
                    renderSaveButton();
                }
                render();
            }
        }
    }

    // --- DATABASE INTERACTIONS --- //

    // Saves the currently active project to IndexedDB.
    async function saveActiveProject(isSilent = false) {
        const project = appState.activeProject;
        if (!project.name.trim()) {
            showToast("Project name cannot be empty.", 'error');
            return;
        }
        if (!project.id) {
            project.id = `project-${Date.now()}`;
        }
        project.lastModified = Date.now();
        
        try {
            await saveProject(project);
            appState.isDirty = false;
            if (!isSilent) {
                showToast("Project saved!", 'success');
            }
            await fetchSavedProjects(); // Refresh list in case of name change
            render();
        } catch (error) {
            console.error("Failed to save project:", error);
            showToast("Error saving project.", 'error');
        }
    }
    
    // Fetches all projects from the database and updates the state.
    async function fetchSavedProjects() {
        appState.savedProjects = await getAllProjects();
    }

    // Loads a project from the saved projects list, confirming if there are unsaved changes.
    async function loadProject(projectId) {
        if (appState.isDirty) {
            showConfirmation({
                title: 'Unsaved Changes',
                message: 'You have unsaved changes. Are you sure you want to load another project and discard them?',
                onConfirm: () => performLoadProject(projectId)
            });
        } else {
            performLoadProject(projectId);
        }
    }

    // Performs the actual project loading logic.
    function performLoadProject(projectId) {
        const projectToLoad = appState.savedProjects.find(p => p.id === projectId);
        if (projectToLoad) {
            setActiveProject(projectToLoad);
            closeModal();
            render();
        }
    }
    
    // Deletes a project from the database and handles UI updates.
    async function handleProjectDeletion(projectId) {
        await deleteProject(projectId);
        await fetchSavedProjects();
        
        // If the deleted project was the active one, load the next available or a new one.
        if (appState.activeProject && appState.activeProject.id === projectId) {
            const nextProject = appState.savedProjects[0];
            setActiveProject(nextProject || createDefaultProject());
        }
        render();
        showToast('Project deleted.', 'success');
    }

    // --- COUNTER ACTIONS --- //

    function incrementCounter(counterId) {
        updateAndSave(() => {
            const counter = findCounter(counterId);
            if (counter) {
                counter.value++;
                appState.activeProject.incrementHistory.push({ counterId, timestamp: Date.now() });
            }
        });
    }

    function decrementCounter(counterId) {
        updateAndSave(() => {
            const counter = findCounter(counterId);
            if (counter && counter.value > 0) {
                counter.value--;
                // Treat a decrement as an undo for ETA calculation: remove the most recent increment record for this counter
                const history = appState.activeProject.incrementHistory;
                for (let i = history.length - 1; i >= 0; i--) {
                    if (history[i].counterId === counterId) {
                        history.splice(i, 1);
                        break;
                    }
                }
            }
        });
    }

    function resetCounter(counterId) {
        updateAndSave(() => {
            const counter = findCounter(counterId);
            if (counter) {
                counter.value = 0;
                // Remove all increment history entries for this counter to keep ETA accurate after a reset
                appState.activeProject.incrementHistory = appState.activeProject.incrementHistory.filter(h => h.counterId !== counterId);
            }
        });
    }
    
    function addSubCounter() {
        updateAndSave(() => {
            const newCounter = {
                id: `counter-${Date.now()}`,
                name: 'New Counter',
                value: 0,
                target: null,
            };
            appState.activeProject.subCounters.push(newCounter);
        });
    }

    function deleteSubCounter(counterId) {
        updateAndSave(() => {
            const project = appState.activeProject;
            project.subCounters = project.subCounters.filter(c => c.id !== counterId);
            // Remove increment history entries related to the deleted counter so ETA updates correctly
            project.incrementHistory = project.incrementHistory.filter(h => h.counterId !== counterId);
        });
    }

    // --- TIMER LOGIC --- //

    // Starts the main timer interval.
    function startProjectTimer() {
        clearInterval(projectTimerInterval);
        projectTimerInterval = setInterval(updateTimer, 1000);
    }
    
    // Updates the elapsed time for the active project.
    function updateTimer() {
        const timer = appState.activeProject?.timer;
        if (!timer || timer.isPaused) return;

        const now = Date.now();
        const elapsedSinceLastTick = now - (timer.lastTick || now);
        timer.totalElapsedMs += elapsedSinceLastTick;
        timer.lastTick = now;
        
        renderTimer();
    }

    // Toggles the paused state of the project timer.
    function toggleTimerPause() {
        updateAndSave(() => {
            const timer = appState.activeProject.timer;
            timer.isPaused = !timer.isPaused;
            if (!timer.isPaused) {
                timer.lastTick = Date.now();
            }
        });
    }

    // --- RENDERING --- //

    // Main render function to update the entire UI based on the current state.
    function render() {
        if (!appState.activeProject) return;
        
        dom.projectName.value = appState.activeProject.name;
        dom.projectNotes.value = appState.activeProject.notes;
        dom.projectPatternUrl.value = appState.activeProject.patternUrl;
        
        renderMainCounter();
        renderSubCounters();
        renderTimer();
        renderSaveButton();
        renderModals();
        renderProjectsList();
    }

    function renderMainCounter() {
        const counter = appState.activeProject.mainCounter;
        dom.mainCounterContainer.innerHTML = createCounterHTML(counter, true);
    }

    function renderSubCounters() {
        const counters = appState.activeProject.subCounters;
        dom.subCountersContainer.innerHTML = counters.map(c => createCounterHTML(c, false)).join('');
    }

    function renderTimer() {
        const timer = appState.activeProject.timer;
        const showTimer = appState.settings.showTimer;

        dom.projectTimer.hidden = !showTimer;
        if (!showTimer) return;
        
        dom.timerDisplay.textContent = formatTime(timer.totalElapsedMs);
        dom.timerPauseBtn.innerHTML = timer.isPaused
            ? `<svg xmlns="http://www.w.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" /></svg>`
            : `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM7 8a1 1 0 012 0v4a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v4a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" /></svg>`;
    }

    // Updates the save button's text and disabled state.
    function renderSaveButton() {
        const project = appState.activeProject;
        if (!project.id) {
            // Unsaved project
            dom.saveProjectBtn.textContent = 'Save to Device';
            dom.saveProjectBtn.disabled = false;
        } else {
            // For saved projects, always show as Saved
            dom.saveProjectBtn.textContent = 'Saved';
            dom.saveProjectBtn.disabled = true;
        }
    }
    
    // Sets the theme for the application (always dark).
    function applyTheme() {
        document.documentElement.classList.add('dark');
        document.querySelector('meta[name="theme-color"]').setAttribute('content', '#111827');
    }
    
    // Renders the list of saved projects in the projects modal.
    function renderProjectsList() {
        if (appState.savedProjects.length === 0) {
            dom.projectsList.innerHTML = `<p class="text-center text-gray-500 py-4">No projects saved yet.</p>`;
            return;
        }
        
        dom.projectsList.innerHTML = appState.savedProjects.map(p => `
            <div class="flex items-center justify-between p-3 rounded-md hover:bg-gray-700">
                <div>
                    <p class="font-semibold">${p.name}</p>
                    <p class="text-sm text-gray-400">
                        ${p.mainCounter.name}: ${p.mainCounter.value} &bull; Last modified: ${new Date(p.lastModified).toLocaleDateString()}
                    </p>
                </div>
                <div class="flex items-center space-x-2">
                    <button data-action="load-project" data-id="${p.id}" class="px-3 py-1 text-sm bg-violet-600 text-white rounded-md hover:bg-violet-700">Load</button>
                    <button data-action="delete-project" data-id="${p.id}" data-name="${p.name}" class="p-2 rounded-full text-gray-500 hover:bg-red-500/10 hover:text-red-500">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                </div>
            </div>
        `).join('');
    }

    // Generates the HTML string for a single counter.
    function createCounterHTML(counter, isMain) {
        const showTarget = appState.settings.showTimer && (counter.target !== null && counter.target > 0);
        const targetHTML = `
            <span class="text-2xl text-gray-500">/</span>
            <input type="number" min="0" value="${counter.target || ''}" placeholder="Target" data-property="target" data-id="${counter.id}" 
                   class="bg-transparent text-2xl w-24 text-center focus:bg-gray-700 rounded-md p-1 -m-1">
        `;
        
        const eta = appState.settings.showTimer ? calculateETA(counter) : null;
        const etaHTML = eta ? `<p class="text-xs text-center text-violet-400 font-medium mt-1">${eta}</p>` : '';

        const deleteBtnHTML = isMain ? '' : `
            <button data-action="delete-sub-counter" data-id="${counter.id}" class="absolute -top-2 -right-2 p-1 bg-gray-600 rounded-full text-gray-300 hover:bg-red-500 hover:text-white transition">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
        `;

        const containerClasses = isMain 
            ? 'flex flex-col items-center'
            : 'relative bg-gray-800 p-4 rounded-xl shadow-md flex flex-col items-center';
            
        const nameInputClasses = isMain
            ? 'font-semibold text-xl text-center'
            : 'font-medium w-full text-center';

        const counterDisplayHTML = `
            <div class="flex items-baseline justify-center font-mono font-bold text-violet-400">
                <span class="counter-value">${counter.value}</span>
                ${showTarget ? targetHTML : ''}
            </div>
            ${etaHTML}
            <div class="flex flex-col md:flex-row items-center justify-center space-y-2 md:space-y-0 md:space-x-4 mt-2">
                 <button data-action="reset" data-id="${counter.id}" class="text-sm text-gray-500 hover:text-gray-200">Reset</button>
                 ${appState.settings.showTimer ? `<button data-action="toggle-target" data-id="${counter.id}" class="text-sm text-gray-500 hover:text-gray-200">${counter.target ? 'Remove Target' : 'Set Target'}</button>` : ''}
            </div>
        `;

        return `
            <div class="${containerClasses}">
                ${deleteBtnHTML}
                <div class="${isMain ? 'w-full text-center' : 'flex-grow w-full'}">
                    <input type="text" value="${counter.name}" data-property="name" data-id="${counter.id}"
                           class="bg-transparent ${nameInputClasses} w-full focus:bg-gray-700 rounded-md p-1 -m-1">
                </div>
                <div class="flex items-center justify-center space-x-2 my-2">
                    <button data-action="decrement" data-id="${counter.id}" class="w-16 h-16 md:w-20 md:h-20 text-4xl font-light rounded-full bg-gray-700 hover:bg-gray-600 transition">-</button>
                    <div class="text-center">
                        ${counterDisplayHTML}
                    </div>
                    <button data-action="increment" data-id="${counter.id}" class="w-16 h-16 md:w-20 md:h-20 text-4xl font-light rounded-full bg-gray-700 hover:bg-gray-600 transition">+</button>
                </div>
            </div>
        `;
    }

    // --- MODAL & NOTIFICATION MANAGEMENT --- //

    function showModal(modalName) {
        appState.activeModal = modalName;
        renderModals();
    }
    
    function closeModal() {
        appState.activeModal = null;
        renderModals();
    }
    
    function showConfirmation(context) {
        appState.confirmationContext = context;
        showModal('confirm');
    }

    function renderModals() {
        const activeModal = appState.activeModal;
        dom.modalContainer.hidden = !activeModal;

        Object.values(dom.modals).forEach(modal => modal.hidden = true);
        
        if (activeModal && dom.modals[activeModal]) {
            dom.modals[activeModal].hidden = false;
        }

        if (activeModal === 'confirm') {
            dom.confirmTitle.textContent = appState.confirmationContext.title;
            dom.confirmMessage.textContent = appState.confirmationContext.message;
        }

        if (activeModal === 'settings') {
            dom.showTimerToggle.checked = appState.settings.showTimer;
        } else if (activeModal === 'setTarget') {
            const { counterId, currentValue, message } = appState.setTargetContext;
            dom.setTargetMessage.textContent = message;
            dom.setTargetInput.value = currentValue;
            dom.setTargetInput.dataset.id = counterId; // Store counterId on the input for easy access
        }
    }

    function showToast(message, type = 'info', duration = 3000) {
        appState.toast = { message, type, visible: true };
        renderToast();

        setTimeout(() => {
            appState.toast.visible = false;
            renderToast();
        }, duration);
    }

    function renderToast() {
        const { message, type, visible } = appState.toast;
        const toastElement = dom.toastContainer;

        if (visible) {
            const bgColor = {
                info: 'bg-gray-800',
                success: 'bg-green-600',
                error: 'bg-red-600'
            }[type];
            toastElement.textContent = message;
            toastElement.className = `fixed bottom-5 left-1/2 -translate-x-1/2 px-6 py-3 rounded-full text-white shadow-lg animate-slide-up-fast ${bgColor}`;
            toastElement.hidden = false;
        } else {
            toastElement.hidden = true;
        }
    }

    // --- EVENT LISTENERS & HANDLERS --- //

    function registerEventListeners() {
        dom.projectName.addEventListener('input', (e) => updateProjectProperty('name', e.target.value));
        dom.projectNotes.addEventListener('input', (e) => updateProjectProperty('notes', e.target.value));
        dom.projectPatternUrl.addEventListener('input', (e) => updateProjectProperty('patternUrl', e.target.value));

        dom.app.addEventListener('click', handleAppClick);
        dom.app.addEventListener('input', handleAppInput);
        
        dom.modalContainer.addEventListener('click', handleModalClick);

        // Dedicated listener for the dynamic list inside the projects modal
        dom.projectsList.addEventListener('click', handleProjectsListClick);

        dom.showTimerToggle.addEventListener('change', (e) => {
            appState.settings.showTimer = e.target.checked;
            saveSettings();
            render();
        });
    }

    // Main click handler using event delegation.
    function handleAppClick(e) {
        const target = e.target.closest('[data-action]');
        if (!target) return;

        const { action, id, name } = target.dataset;

        switch (action) {
            case 'increment': incrementCounter(id); break;
            case 'decrement': decrementCounter(id); break;
            case 'reset': resetCounter(id); break;
            case 'add-sub-counter': addSubCounter(); break;
            case 'delete-sub-counter':
                showConfirmation({
                    title: 'Delete Counter?',
                    message: `Are you sure you want to delete this sub-counter? This cannot be undone.`,
                    onConfirm: () => {
                        deleteSubCounter(id);
                        showToast('Sub-counter deleted.', 'success');
                    }
                });
                break;
            case 'save-project': saveActiveProject(); break;
            case 'delete-project-current':
                if (!appState.activeProject.id) {
                    setActiveProject(createDefaultProject());
                    render();
                    showToast("Project reset to default state.", "info");
                    return;
                }
                showConfirmation({
                    title: `Delete "${appState.activeProject.name}"?`,
                    message: 'This project will be permanently removed from your device.',
                    onConfirm: () => handleProjectDeletion(appState.activeProject.id)
                });
                break;
            case 'load-project': loadProject(id); break;
            case 'delete-project':
                 showConfirmation({
                    title: `Delete "${name}"?`,
                    message: 'This project will be permanently removed from your device.',
                    onConfirm: () => handleProjectDeletion(id)
                });
                break;
            case 'toggle-settings': showModal('settings'); break;
            case 'toggle-projects': showModal('projects'); break;
            case 'toggle-timer-pause': toggleTimerPause(); break;
            case 'toggle-target':
                const counterToTarget = findCounter(id);
                if (counterToTarget) {
                    if (counterToTarget.target) {
                        // If target is already set, unset it directly
                        updateAndSave(() => {
                            counterToTarget.target = null;
                        });
                    } else {
                        // Otherwise, show the custom modal to set a new target
                        showSetTargetModal({
                            counterId: id,
                            currentValue: counterToTarget.value + 10, // Suggest a value
                            message: `Set a target for "${counterToTarget.name}":`,
                            onSet: (newTarget) => {
                                updateAndSave(() => {
                                    counterToTarget.target = newTarget;
                                });
                            }
                        });
                    }
                }
                break;
            case 'start-new-project':
                if (appState.isDirty) {
                    showConfirmation({
                        title: 'Unsaved Changes',
                        message: 'You have unsaved changes. Are you sure you want to start a new project and discard them?',
                        onConfirm: () => {
                            setActiveProject(createDefaultProject());
                            closeModal();
                            render();
                        }
                    });
                } else {
                    setActiveProject(createDefaultProject());
                    closeModal();
                    render();
                }
                break;
        }
    }

    function showSetTargetModal(context) {
        appState.setTargetContext = context;
        showModal('setTarget');
    }

    function handleSetTargetProceed() {
        const { onSet, counterId } = appState.setTargetContext;
        const newTargetValue = parseInt(dom.setTargetInput.value, 10);

        if (isNaN(newTargetValue) || newTargetValue < 0) {
            showToast("Please enter a valid positive number for the target.", 'error');
            return;
        }

        if (onSet && typeof onSet === 'function') {
            onSet(newTargetValue);
        }

        closeModal();
        render();
    }

    // Handles input events for dynamically created counter fields.
    function handleAppInput(e) {
        const target = e.target.closest('[data-property]');
        if (!target) return;
        
        const { id, property } = target.dataset;
        
        // For target inputs, only update on blur (when focus is lost)
        if (property === 'target') {
            target.addEventListener('blur', function onBlur() {
                const value = parseInt(target.value, 10) || null;
                updateCounterProperty(id, property, value);
                target.removeEventListener('blur', onBlur);
            }, { once: true });
            return;
        }
        
        // For other properties (like name), update immediately
        const value = target.value;
        updateCounterProperty(id, property, value);
    }
    
    // Handles clicks within the modal container (closing, confirming, etc.).
    function handleModalClick(e) {
        const target = e.target.closest('[data-action]');
        if (e.target === dom.modalOverlay) {
            closeModal();
            return;
        }
        if (!target) return;

        const { action } = target.dataset;
        
        switch (action) {
            case 'close-modal': closeModal(); break;
            case 'confirm-cancel': closeModal(); break;
            case 'start-new-project':
                if (appState.isDirty) {
                    showConfirmation({
                        title: 'Unsaved Changes',
                        message: 'You have unsaved changes. Are you sure you want to start a new project and discard them?',
                        onConfirm: () => {
                            setActiveProject(createDefaultProject());
                        }
                    });
                } else {
                    setActiveProject(createDefaultProject());
                    closeModal();
                    render();
                }
                break;
            case 'confirm-proceed': handleConfirmationProceed(); break;
            case 'set-target-cancel': closeModal(); break;
            case 'set-target-proceed': handleSetTargetProceed(); break;
        }
    }
    
    // Central handler for the "Proceed" button in the confirmation modal.
    function handleConfirmationProceed() {
        const { onConfirm } = appState.confirmationContext;

        if (onConfirm && typeof onConfirm === 'function') {
            onConfirm();
        }
        
        closeModal();
        render();
    }

    // --- SETTINGS --- //
    
    function loadSettings() {
        const savedSettings = localStorage.getItem('crochetCounterSettings');
        if (savedSettings) {
            appState.settings = { ...appState.settings, ...JSON.parse(savedSettings) };
        }
    }

    function saveSettings() {
        localStorage.setItem('crochetCounterSettings', JSON.stringify(appState.settings));
    }

    // --- HELPERS & UTILITIES --- //

    function findCounter(counterId) {
        const project = appState.activeProject;
        if (!project) return null;
        if (counterId === 'main') return project.mainCounter;
        return project.subCounters.find(c => c.id === counterId);
    }

    function formatTime(ms) {
        const totalSeconds = Math.floor(ms / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    
    // Calculates the estimated time to complete a counter's target based on increment history.
    function calculateETA(counter) {
        if (!counter.target || counter.target <= counter.value) return null;

        const project = appState.activeProject;
        if (!project || !project.incrementHistory || project.incrementHistory.length === 0) return null;

        // Increments specific to this counter (sorted oldest->newest)
        const incrementsForCounter = project.incrementHistory
            .filter(h => h.counterId === counter.id)
            .sort((a, b) => a.timestamp - b.timestamp);

        // Global increments across the project as a fallback (sorted oldest->newest)
        const globalIncrements = project.incrementHistory.slice().sort((a, b) => a.timestamp - b.timestamp);

        // Compute average time per increment given a sorted array of increment records.
        const computeAvgTimePerIncrement = (incArr) => {
            if (!incArr || incArr.length === 0) return null;

            const totalTime = appState.activeProject.timer.totalElapsedMs;
            const totalIncrements = incArr.length;

            if (totalTime > 0 && totalIncrements > 0) {
                return totalTime / totalIncrements;
            }

            return null; // Not enough data to compute an average
        };

        // Prefer counter-specific average when available, otherwise fall back to global average
        let avgTimePerIncrement = computeAvgTimePerIncrement(incrementsForCounter);
        if (avgTimePerIncrement === null) {
            avgTimePerIncrement = computeAvgTimePerIncrement(globalIncrements);
        }
        if (avgTimePerIncrement === null) return null;

        const remainingIncrements = counter.target - counter.value;
        const etaMs = remainingIncrements * avgTimePerIncrement;

        const minutes = Math.ceil(etaMs / 60000);
        if (minutes < 1) return "ETA: < 1 min";
        if (minutes < 60) return `ETA: ~${minutes} min`;
        const hours = Math.floor(minutes / 60);
        const remMinutes = minutes % 60;
        return `ETA: ~${hours}h ${remMinutes}m`;
    }

    // --- PWA SERVICE WORKER --- //

    function registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('/service-worker.js')
                    .then(reg => console.log('Service Worker registered.', reg))
                    .catch(err => console.log('Service Worker registration failed: ', err));
            });
        }
    }

    // Listens for when a new service worker takes control.
    function setupServiceWorkerUpdateListener() {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.addEventListener('controllerchange', () => {
                // This event fires when the new service worker has successfully activated.
                showUpdateToast();
            });
        }
    }

    // Creates and injects a toast notification to prompt the user to reload.
    function showUpdateToast() {
        // Create banner element
        const banner = document.createElement('div');
        banner.id = 'update-banner';
        banner.textContent = 'A new version is available!';

        // Style the banner
        banner.style.position = 'fixed';
        banner.style.bottom = '20px';
        banner.style.left = '50%';
        banner.style.transform = 'translateX(-50%)';
        banner.style.padding = '12px 20px';
        banner.style.backgroundColor = '#1f2937'; // dark-gray consistent with theme
        banner.style.color = '#e5e7eb'; // light-gray text
        banner.style.borderRadius = '9999px';
        banner.style.boxShadow = '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)';
        banner.style.zIndex = '10000';
        banner.style.display = 'flex';
        banner.style.alignItems = 'center';
        banner.style.gap = '12px';

        // Create reload button
        const reloadButton = document.createElement('button');
        reloadButton.textContent = 'Reload';

        // Style the button
        reloadButton.style.border = 'none';
        reloadButton.style.backgroundColor = '#7c3aed'; // violet-600
        reloadButton.style.color = 'white';
        reloadButton.style.padding = '8px 16px';
        reloadButton.style.borderRadius = '9999px';
        reloadButton.style.cursor = 'pointer';
        reloadButton.style.fontWeight = '500';

        // Add event listener to the button
        reloadButton.addEventListener('click', () => {
            window.location.reload();
        });

        // Append button to banner and banner to body
        banner.appendChild(reloadButton);
        document.body.appendChild(banner);
    }

    function handleProjectsListClick(e) {
        const target = e.target.closest('[data-action]');
        if (!target) return;

        const { action, id, name } = target.dataset;

        if (action === 'load-project') {
            loadProject(id);
        } else if (action === 'delete-project') {
            showConfirmation({
                title: `Delete "${name}"?`,
                message: 'This project will be permanently removed from your device.',
                onConfirm: () => handleProjectDeletion(id)
            });
        }
    }

    // --- RUN APP --- //
    init();

});