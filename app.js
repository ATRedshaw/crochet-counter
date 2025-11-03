// app.js: Core application logic.

document.addEventListener('DOMContentLoaded', () => {

    // --- STATE MANAGEMENT --- //
    
    let appState = {
        activeProject: null,
        savedProjects: [],
        settings: {
            theme: 'light',
            showTimer: true,
        },
        activeModal: null, // null, 'settings', 'projects', 'confirm'
        confirmationContext: { // Context for the confirmation modal
            action: null,
            data: null,
            title: '',
            message: '',
        },
        isDirty: false, // Tracks if the active project has unsaved changes
    };

    let projectTimerInterval;

    // --- DOM ELEMENT SELECTORS --- //

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
        },
        projectsList: document.getElementById('projects-list'),
        confirmTitle: document.querySelector('[data-binding="confirm-title"]'),
        confirmMessage: document.querySelector('[data-binding="confirm-message"]'),
        themeToggleBtn: document.querySelector('[data-action="toggle-theme"]'),
        showTimerToggle: document.querySelector('[data-setting="showTimer"]'),
    };


    // --- INITIALIZATION --- //

    function init() {
        loadSettings();
        registerEventListeners();
        loadInitialProject();
        startProjectTimer();
        registerServiceWorker();
    }

    async function loadInitialProject() {
        await fetchSavedProjects();
        const lastProject = appState.savedProjects[0]; // Already sorted by DB call
        if (lastProject) {
            setActiveProject(lastProject);
        } else {
            setActiveProject(createDefaultProject());
        }
        render();
    }

    function createDefaultProject() {
        return {
            id: null, // No ID means it's not saved
            name: 'New Project',
            lastModified: Date.now(),
            timer: { totalElapsedMs: 0, isPaused: false, lastTick: Date.now() },
            mainCounter: { id: 'main', name: 'Row', value: 0, target: 0 },
            subCounters: [],
            incrementHistory: [],
            notes: '',
            patternUrl: '',
        };
    }
    
    // --- STATE & PROJECT LOGIC --- //

    function setActiveProject(project) {
        appState.activeProject = project;
        appState.isDirty = false;
        // Ensure timer has a lastTick property for running timers
        if (!project.timer.isPaused) {
            project.timer.lastTick = Date.now();
        }
    }

    function markDirty() {
        if (appState.isDirty) return;
        appState.isDirty = true;
        renderSaveButton();
    }
    
    function updateAndSave(modificationFn) {
        modificationFn();
        appState.activeProject.lastModified = Date.now();
        markDirty();

        if (appState.activeProject.id) {
            // Auto-save if the project is already persisted
            saveActiveProject();
        }
        render();
    }

    function incrementCounter(counterId) {
        updateAndSave(() => {
            const project = appState.activeProject;
            const counter = findCounter(counterId);
            if (counter) {
                counter.value++;
                project.incrementHistory.push({ counterId: counterId, timestamp: Date.now() });
            }
        });
    }

    function decrementCounter(counterId) {
        updateAndSave(() => {
            const counter = findCounter(counterId);
            if (counter && counter.value > 0) {
                counter.value--;
            }
        });
    }

    function resetCounter(counterId) {
        updateAndSave(() => {
            const counter = findCounter(counterId);
            if (counter) {
                counter.value = 0;
            }
        });
    }
    
    function addSubCounter() {
        updateAndSave(() => {
            const newCounter = {
                id: `counter-${Date.now()}`,
                name: 'New Counter',
                value: 0,
                target: 0,
            };
            appState.activeProject.subCounters.push(newCounter);
        });
    }

    function deleteSubCounter(counterId) {
        updateAndSave(() => {
            const project = appState.activeProject;
            project.subCounters = project.subCounters.filter(c => c.id !== counterId);
        });
    }

    function updateCounterProperty(counterId, prop, value) {
        updateAndSave(() => {
            const counter = findCounter(counterId);
            if (counter) {
                counter[prop] = value;
            }
        });
    }
    
    async function saveActiveProject() {
        const project = appState.activeProject;
        if (!project.id) {
            project.id = `project-${Date.now()}`;
        }
        project.lastModified = Date.now();
        
        try {
            await saveProject(project);
            appState.isDirty = false;
            await fetchSavedProjects(); // Refresh the list of saved projects
            render(); // Re-render to update UI state (e.g., save button)
        } catch (error) {
            console.error("Failed to save project:", error);
            // Optionally show a user-facing error message
        }
    }
    
    async function fetchSavedProjects() {
        appState.savedProjects = await getAllProjects();
    }

    async function loadProject(projectId) {
        const projectToLoad = appState.savedProjects.find(p => p.id === projectId);
        if (projectToLoad) {
            setActiveProject(projectToLoad);
            closeModal();
            render();
        }
    }
    
    async function handleProjectDeletion(projectId) {
        await deleteProject(projectId);
        await fetchSavedProjects();
        // If the deleted project was the active one, start a new one
        if (appState.activeProject.id === projectId) {
            setActiveProject(createDefaultProject());
        }
        render();
    }


    // --- TIMER LOGIC --- //

    function startProjectTimer() {
        clearInterval(projectTimerInterval);
        projectTimerInterval = setInterval(updateTimer, 1000);
    }
    
    function updateTimer() {
        const timer = appState.activeProject?.timer;
        if (!timer || timer.isPaused) return;

        const now = Date.now();
        const elapsedSinceLastTick = now - (timer.lastTick || now);
        timer.totalElapsedMs += elapsedSinceLastTick;
        timer.lastTick = now;
        
        renderTimer();
    }

    function toggleTimerPause() {
        updateAndSave(() => {
            const timer = appState.activeProject.timer;
            timer.isPaused = !timer.isPaused;
            if (!timer.isPaused) {
                timer.lastTick = Date.now(); // Set tick time on resume
            }
        });
    }


    // --- RENDERING --- //

    function render() {
        if (!appState.activeProject) return;
        
        // Render project details
        dom.projectName.value = appState.activeProject.name;
        dom.projectNotes.value = appState.activeProject.notes;
        dom.projectPatternUrl.value = appState.activeProject.patternUrl;
        
        // Render counters
        renderMainCounter();
        renderSubCounters();
        
        // Render UI state
        renderTimer();
        renderSaveButton();
        renderTheme();
        
        // Render modals
        renderModals();
        renderProjectsList();
    }

    function renderMainCounter() {
        const counter = appState.activeProject.mainCounter;
        dom.mainCounterContainer.innerHTML = createCounterHTML(counter, true);
    }

    function renderSubCounters() {
        const counters = appState.activeProject.subCounters;
        if (counters.length === 0) {
            dom.subCountersContainer.innerHTML = '';
            return;
        }
        dom.subCountersContainer.innerHTML = counters.map(c => createCounterHTML(c, false)).join('');
    }

    function renderTimer() {
        const timer = appState.activeProject.timer;
        const showTimer = appState.settings.showTimer;

        dom.projectTimer.hidden = !showTimer;
        if (!showTimer) return;
        
        dom.timerDisplay.textContent = formatTime(timer.totalElapsedMs);
        dom.timerPauseBtn.innerHTML = timer.isPaused
            ? `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /></svg>`
            : `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 9v6m4-6v6" /></svg>`;
    }

    function renderSaveButton() {
        const project = appState.activeProject;
        if (project.id) {
            dom.saveProjectBtn.textContent = 'Saved';
            dom.saveProjectBtn.disabled = !appState.isDirty;
        } else {
            dom.saveProjectBtn.textContent = 'Save to Device';
            dom.saveProjectBtn.disabled = false;
        }
    }
    
    function renderTheme() {
        const isDark = appState.settings.theme === 'dark';
        document.documentElement.classList.toggle('dark', isDark);
        dom.themeToggleBtn.querySelector('span').classList.toggle('dark:translate-x-6', isDark);
        document.querySelector('meta[name="theme-color"]').setAttribute('content', isDark ? '#111827' : '#ffffff');
    }
    
    function renderProjectsList() {
        if (appState.savedProjects.length === 0) {
            dom.projectsList.innerHTML = `<p class="text-center text-gray-500 py-4">No projects saved yet.</p>`;
            return;
        }
        
        dom.projectsList.innerHTML = appState.savedProjects.map(p => `
            <div class="flex items-center justify-between p-3 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700">
                <div>
                    <p class="font-semibold">${p.name}</p>
                    <p class="text-sm text-gray-500 dark:text-gray-400">
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


    // --- MODAL MANAGEMENT --- //

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
        
        if (activeModal) {
            dom.modalContainer.hidden = false;
            Object.values(dom.modals).forEach(modal => modal.hidden = true);
            if (dom.modals[activeModal]) {
                dom.modals[activeModal].hidden = false;
            }
        } else {
            dom.modalContainer.hidden = true;
        }

        if (activeModal === 'confirm') {
            dom.confirmTitle.textContent = appState.confirmationContext.title;
            dom.confirmMessage.textContent = appState.confirmationContext.message;
        }

        if (activeModal === 'settings') {
            dom.showTimerToggle.checked = appState.settings.showTimer;
        }
    }


    // --- EVENT LISTENERS --- //

    function registerEventListeners() {
        // Project-level actions
        dom.projectName.addEventListener('input', (e) => updateAndSave(() => appState.activeProject.name = e.target.value));
        dom.projectNotes.addEventListener('input', (e) => updateAndSave(() => appState.activeProject.notes = e.target.value));
        dom.projectPatternUrl.addEventListener('input', (e) => updateAndSave(() => appState.activeProject.patternUrl = e.target.value));

        // Using event delegation on a container for dynamic elements
        dom.app.addEventListener('click', handleAppClick);
        dom.app.addEventListener('input', handleAppInput); // For counter name/target changes
        
        // Modal actions
        dom.modalContainer.addEventListener('click', handleModalClick);

        // Settings
        dom.showTimerToggle.addEventListener('change', (e) => {
            appState.settings.showTimer = e.target.checked;
            saveSettings();
            renderTimer();
        });
    }

    function handleAppClick(e) {
        const target = e.target.closest('[data-action]');
        if (!target) return;

        const { action, id, name } = target.dataset;

        switch (action) {
            case 'increment': incrementCounter(id); break;
            case 'decrement': decrementCounter(id); break;
            case 'reset': resetCounter(id); break;
            case 'add-sub-counter': addSubCounter(); break;
            case 'delete-sub-counter': deleteSub-counter(id); break;
            case 'save-project': saveActiveProject(); break;
            case 'clear-project':
                showConfirmation({
                    action: 'clear-project',
                    title: 'Clear Project?',
                    message: 'This will reset the name, remove all sub-counters, and set counts to zero. This cannot be undone.'
                });
                break;
            case 'load-project': loadProject(id); break;
            case 'delete-project':
                 showConfirmation({
                    action: 'delete-project',
                    data: { id },
                    title: `Delete "${name}"?`,
                    message: 'This project will be permanently removed from your device.'
                });
                break;
            case 'toggle-settings': showModal('settings'); break;
            case 'toggle-projects': showModal('projects'); break;
            case 'toggle-timer-pause': toggleTimerPause(); break;
            case 'toggle-theme': toggleTheme(); break;
            case 'start-new-project':
                setActiveProject(createDefaultProject());
                closeModal();
                render();
                break;
        }
    }

    function handleAppInput(e) {
        const target = e.target.closest('[data-property]');
        if (!target) return;
        
        const { id, property } = target.dataset;
        const value = property === 'target' ? parseInt(target.value, 10) || 0 : target.value;
        
        updateCounterProperty(id, property, value);
    }
    
    function handleModalClick(e) {
        const target = e.target.closest('[data-action]');
        if (!target) return;

        const { action } = target.dataset;
        
        switch (action) {
            case 'close-modal': closeModal(); break;
            case 'confirm-cancel': closeModal(); break;
            case 'confirm-proceed': handleConfirmationProceed(); break;
        }
        
        // Close modal if overlay is clicked
        if (e.target === dom.modalOverlay) {
            closeModal();
        }
    }
    
    function handleConfirmationProceed() {
        const { action, data } = appState.confirmationContext;
        
        switch (action) {
            case 'clear-project':
                const clearedProject = createDefaultProject();
                // Retain ID if it was a saved project, so it overwrites instead of creating a new one
                clearedProject.id = appState.activeProject.id; 
                setActiveProject(clearedProject);
                if (clearedProject.id) {
                    saveActiveProject(); // Save the cleared state
                }
                break;
            case 'delete-project':
                handleProjectDeletion(data.id);
                break;
        }

        closeModal();
        render();
    }


    // --- SETTINGS & THEME --- //
    
    function loadSettings() {
        const savedSettings = localStorage.getItem('crochetCounterSettings');
        if (savedSettings) {
            appState.settings = { ...appState.settings, ...JSON.parse(savedSettings) };
        }
    }

    function saveSettings() {
        localStorage.setItem('crochetCounterSettings', JSON.stringify(appState.settings));
    }

    function toggleTheme() {
        appState.settings.theme = appState.settings.theme === 'light' ? 'dark' : 'light';
        saveSettings();
        renderTheme();
    }


    // --- HELPERS & UTILITIES --- //

    function findCounter(counterId) {
        const project = appState.activeProject;
        if (counterId === 'main') {
            return project.mainCounter;
        }
        return project.subCounters.find(c => c.id === counterId);
    }

    function formatTime(ms) {
        const totalSeconds = Math.floor(ms / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    
    function calculateETA(counter) {
        if (!counter.target || counter.target <= counter.value) {
            return null;
        }

        const increments = appState.activeProject.incrementHistory
            .filter(h => h.counterId === counter.id)
            .sort((a, b) => a.timestamp - b.timestamp);
        
        if (increments.length < 2) return null;

        const timeDiffs = [];
        for (let i = 1; i < increments.length; i++) {
            timeDiffs.push(increments[i].timestamp - increments[i-1].timestamp);
        }

        const avgTimePerIncrement = timeDiffs.reduce((a, b) => a + b, 0) / timeDiffs.length;
        const remainingIncrements = counter.target - counter.value;
        const etaMs = remainingIncrements * avgTimePerIncrement;
        
        const minutes = Math.ceil(etaMs / 60000);
        if (minutes < 1) return "< 1m remaining";
        if (minutes < 60) return `~${minutes}m remaining`;
        const hours = Math.floor(minutes / 60);
        const remMinutes = minutes % 60;
        return `~${hours}h ${remMinutes}m remaining`;
    }

    function createCounterHTML(counter, isMain) {
        const targetHTML = `
            <span class="text-2xl text-gray-400 dark:text-gray-500">/</span>
            <input type="number" min="0" value="${counter.target || ''}" placeholder="Target" data-property="target" data-id="${counter.id}" 
                   class="bg-transparent text-2xl w-24 text-center focus:bg-gray-100 dark:focus:bg-gray-700 rounded-md">
        `;
        
        const eta = calculateETA(counter);
        const etaHTML = eta ? `<p class="text-sm text-center text-violet-500 font-medium">${eta}</p>` : '';

        const deleteBtnHTML = isMain ? '' : `
            <button data-action="delete-sub-counter" data-id="${counter.id}" class="absolute -top-2 -right-2 p-1 bg-gray-200 dark:bg-gray-600 rounded-full text-gray-500 dark:text-gray-300 hover:bg-red-500/20 hover:text-red-500 transition">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
        `;

        const containerClasses = isMain 
            ? 'flex flex-col items-center' 
            : 'relative bg-white dark:bg-gray-800 p-4 rounded-xl shadow-md flex items-center justify-between space-x-4';
            
        const nameInputClasses = isMain 
            ? 'font-semibold text-xl text-center' 
            : 'font-medium flex-grow';

        return `
            <div class="${containerClasses}">
                <div class="${isMain ? 'w-full text-center' : 'flex-grow'}">
                    <input type="text" value="${counter.name}" data-property="name" data-id="${counter.id}" class="bg-transparent ${nameInputClasses} w-full focus:bg-gray-100 dark:focus:bg-gray-700 rounded-md p-1 -m-1">
                </div>
                <div class="flex items-center justify-center space-x-2 my-2">
                    <button data-action="decrement" data-id="${counter.id}" class="w-16 h-16 md:w-20 md:h-20 text-4xl font-light rounded-full bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 transition">-</button>
                    <div class="flex items-baseline justify-center font-mono font-bold text-violet-600 dark:text-violet-400">
                        <span class="counter-value">${counter.value}</span>
                        ${counter.target > 0 ? targetHTML : ''}
                    </div>
                    <button data-action="increment" data-id="${counter.id}" class="w-16 h-16 md:w-20 md:h-20 text-4xl font-light rounded-full bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 transition">+</button>
                </div>
                <div class="flex items-center space-x-4">
                     <button data-action="reset" data-id="${counter.id}" class="text-sm text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">Reset</button>
                     ${etaHTML}
                </div>
                ${deleteBtnHTML}
            </div>
        `;
    }

    // --- PWA Service Worker --- //

    function registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('/service-worker.js')
                    .then(registration => {
                        console.log('ServiceWorker registration successful with scope: ', registration.scope);
                    })
                    .catch(err => {
                        console.log('ServiceWorker registration failed: ', err);
                    });
            });
        }
    }


    // --- RUN APP --- //
    init();

});