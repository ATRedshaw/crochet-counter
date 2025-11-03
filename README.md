Crochet Counter PWA - Software Design Document

1. Overview

This document outlines the design for a simple, modern, and accessible web application to be used as a crochet (or knitting) counter. The primary goal is to create a tool that is fast, reliable, intuitive, and works offline, addressing the common need for crafters to keep track of multiple counts (rows, stitches, repeats) simultaneously.

The application will be built as a Progressive Web App (PWA) using only client-side technologies (HTML, CSS, JavaScript), making it hostable on static platforms like GitHub Pages. It will be designed to be "offline-first" and will offer optional persistence via IndexedDB, allowing users to choose between ephemeral (single-session) use or saving their projects on their device. The UI will be clean, easy to use, and prioritize a non-intrusive user experience.

2. Core Problem & Target Audience

Problem: Crocheters and knitters often work from complex patterns that require tracking multiple, simultaneous counts (e.g., total rows, stitches in a row, pattern repeats, increases/decreases). Physical row counters are often singular, and pen-and-paper is cumbersome. Mobile apps exist but can be overly complex or require installation.

Solution: A clean, simple, browser-based counter that can be "installed" on a user's home screen, works offline, and supports multiple projects and counters with helpful, optional enhancements.

Target Audience: Crocheters, knitters, weavers, and any hobbyist who needs a simple, multi-faceted tally counter.

3. Core Features & Requirements

Features are broken down into "Must-Haves" (Minimum Viable Product) and "Nice-to-Haves" (future enhancements).

3.1. Must-Haves (MVP)

These features define the core "ephemeral" counter that works in a single session.

R1.1: Project Container: The app will center around a "Project." A user can have one active project on the screen at a time.

R1.2: Project Naming: The user must be able to set a name for their active project (e.g., "Granny Square Blanket").

R1.3: Primary Counter: Each project must have one main, prominent counter (e.g., "Row Count").

R1.4: Increment/Decrement: The primary counter must have large, easy-to-tap buttons to increment (+) and decrement (-) the count.

R1.5: Secondary Counters: The user must be able to add multiple, named "sub-counters" (e.g., "Stitch Count," "Pattern Repeats").

R1.6: Sub-Counter Management: Each sub-counter must have its own increment, decrement, and delete (x) buttons.

R1.7: Reset Counters: The user must be able to reset any individual counter to zero.

R1.8: Reset Project: The user must be able to "Clear Project," which resets the name, removes all sub-counters, and sets the main counter to zero. This action must use a custom modal for confirmation.

R1.9: Ephemeral Mode: The app must be fully functional without saving. All project data is held in JavaScript memory and is lost on a hard refresh or browser close. This is the default, zero-friction behavior.

R1.10: Responsive Design: The layout must be mobile-first, ensuring large tap targets and a clean, readable interface on all screen sizes.

3.2. Nice-to-Haves (PWA & Persistence)

These features enhance the app, making it more powerful and "native-like."

R2.1: PWA - Offline Access: A Service Worker will cache all core assets (HTML, CSS, JS) so the app loads and works even without an internet connection.

R2.2: PWA - Add to Home Screen: A Web App Manifest (manifest.json) will be provided, allowing users on supported browsers (mobile and desktop) to "install" the app, running it in its own-frameless window.

R2.3: Project Persistence (IndexedDB):

The user will have an optional "Save Project" button.

This will save the current project state (name, counters, timer state) to the browser's IndexedDB.

If a project is saved, any changes to its counters will auto-save to IndexedDB.

R2.4: Multiple Project Management:

An interface (e.g., a modal or side panel) to "Load Projects."

This view will list all projects saved in IndexedDB.

The user can load any saved project, making it the active one.

The user can delete saved projects from this view (using a custom confirmation modal).

R2.5: Project Notes: A simple text area associated with each project where the user can store notes (e.g., "Using 5.5mm hook," "Brand: Red Heart Super Saver," "Pattern: Row 12-18").

R2.6: Link to Pattern: A simple text field to paste a URL to an online pattern or PDF for quick reference.

R2.7: Settings Panel: A modal or panel (toggled by a settings icon) that contains app-level preferences.

R2.8: Project Time Tracker:

An automatic timer that starts tracking elapsed time as soon as a project is active.

The timer state (total elapsed time, paused status) is saved with the project.

The user can pause and resume the timer.

The timer's visibility can be toggled in the Settings Panel.

R2.9: Dark/Light Mode: A toggle within the Settings Panel to switch between a light and dark color theme.

R2.10: Counter Targets:

For the main counter and each sub-counter, the user can optionally set a target value (a positive integer).

The UI will display progress towards this target (e.g., "24 / 100").

R2.11: Estimated Time to Completion:

If a counter has a target, the app will calculate an estimated time to completion.

This requires storing a timestamp for each increment.

The calculation would be: (Target Value - Current Value) * (Average Time Per Increment).

The average time is calculated from the stored increment timestamps.

This estimate is displayed to the user ("Est. 1h 15m remaining").

If the target is 0 or less than the current value, this message is hidden or shows "Complete!".

4. Technical Stack

HTML5: A single index.html file for semantic structure.

CSS3 (Tailwind CSS): We will use Tailwind CSS (loaded via CDN) for rapid, utility-first styling and responsiveness.

JavaScript (ES6+): All application logic, DOM manipulation, and state management will be in a single app.js file.

IndexedDB: For client-side storage of saved projects. We will use a lightweight wrapper library (like idb) or simple vanilla JS wrappers to manage the database.

Service Worker API: A service-worker.js file to manage caching for offline functionality.

Web App Manifest: A manifest.json file to define PWA properties.

5. Architecture & Data Model

5.1. Application Architecture

The application will be a Single Page Application (SPA).

State Management:

A global JavaScript object, appState, will hold the entire state of the application.

appState.activeProject will contain the data for the project currently on screen.

appState.savedProjects will hold a list of project stubs loaded from IndexedDB for the "Load Project" modal.

UI Rendering:

A central render() function will be responsible for updating the DOM based on the current appState.

Event listeners on buttons (e.g., +, -) will call functions (e.g., incrementCounter()). These functions will first update appState and then call render() to reflect the change.

This simple State -> Render -> UI loop avoids complex data binding.

Custom Modals:

The application must not use native browser alert(), confirm(), or prompt() dialogs.

All notifications, confirmations (e.g., "Delete Project?"), and inputs (e.g., "Set Counter Name") will be handled by custom-built, non-blocking modal components.

Database Interaction:

A db.js helper module (or section of app.js) will abstract all IndexedDB operations (e.g., db.saveProject(projectObject), db.getAllProjects(), db.deleteProject(projectId)).

Database actions will be asynchronous.

5.2. Data Model (IndexedDB)

Database Name: crochetCounterDB

Object Store: projects

Key: id (a UUID or timestamp-based string generated by the app)

Project Object Schema (Updated):

{
  "id": "project-1678886400000",
  "name": "Baby Blanket",
  "lastModified": 1678886400000,
  "timer": {
    "totalElapsedMs": 7200000,
    "isPaused": true
  },
  "mainCounter": {
    "name": "Row",
    "value": 24,
    "target": 100
  },
  "subCounters": [
    { "id": "counter-1", "name": "Shell Repeats", "value": 6, "target": 40 },
    { "id": "counter-2", "name": "Increases", "value": 12, "target": 0 }
  ],
  "incrementHistory": [
    { "counterId": "main", "timestamp": 1678886400000 },
    { "counterId": "main", "timestamp": 1678886480000 },
    { "counterId": "counter-1", "timestamp": 1678886495000 }
  ],
  "notes": "Using 4.0mm hook, Bernat Softee Baby yarn.",
  "patternUrl": "[https://www.example.com/patterns/baby-blanket](https://www.example.com/patterns/baby-blanket)"
}


6. User Flow

First Visit (Ephemeral User):

User opens the app.

The UI displays a default, unsaved project: "New Project," with one "Row" counter at 0. The project timer starts counting.

User can rename the project, increment/decrement counters, and add/remove sub-counters.

The user sees a "Save to Device" button.

User closes the browser. All data is lost. This flow is simple and requires no commitment.

Saving a Project:

User clicks "Save to Device."

The app generates an ID for the activeProject, saves it to IndexedDB, and updates the UI to show it's "Saved."

Now, any change to this project (e.g., incrementing a counter, pausing the timer) automatically triggers an update to IndexedDB.

Returning User (With Saved Projects):

User opens the app.

The app checks IndexedDB on load.

If saved projects exist, it loads the last modified project as the activeProject. The timer resumes from its saved state (or stays paused if it was saved as paused).

A "My Projects" button is visible.

User clicks "My Projects." A modal opens.

The modal lists all saved projects.

User can click "Load" on any project to make it the activeProject, or "Delete" to remove it.

User can click "Start New Project" to return to the default ephemeral state.